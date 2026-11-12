// A stand-in for api.sender.net, for the newsletter edge harness
// (run-newsletter-edge-tests.sh). It runs in a container reachable as
// api.sender.net on the harness's docker network, serves HTTPS on 443 with a
// throwaway certificate chain, and records every request it receives.
//
// Control (plain HTTP on 8080, published to the host's loopback only):
//   GET  /requests      every request received since the last reset, as JSON
//   POST /reset         forget them
//   POST /mode/<mode>   how to answer from now on:
//     200 201 401 422 429 500   answer with that status and a body that echoes
//                               the address, the way Sender does
//     hang                      accept, read, never answer
//     down                      stop listening on 443 (connection refused)
//     wrong-ca                  present a certificate from an untrusted CA
//     wrong-name                trusted CA, but issued to another host name
//
// Every body and header it sends carries LEAK_MARKER, so the harness can prove
// none of it reaches the browser.

import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const CERTS = process.env.CERTS_DIR || '/certs';
const LEAK_MARKER = 'FAKE-SENDER-LEAK';

const contexts = {
  good: { key: readFileSync(`${CERTS}/leaf.key`), cert: readFileSync(`${CERTS}/leaf-chain.pem`) },
  'wrong-ca': { key: readFileSync(`${CERTS}/rogue-leaf.key`), cert: readFileSync(`${CERTS}/rogue-leaf.pem`) },
  'wrong-name': { key: readFileSync(`${CERTS}/wrong-name.key`), cert: readFileSync(`${CERTS}/wrong-name-chain.pem`) },
};

let mode = process.env.FAKE_SENDER_MODE || '201';
let requests = [];
const hanging = new Set();

const BODIES = {
  200: (email) => ({ success: true, message: [LEAK_MARKER], data: { id: 'sub-1', email, firstname: null, status: { email: 'active' } } }),
  201: (email) => ({ success: true, message: [LEAK_MARKER], data: { id: 'sub-1', email, firstname: null, status: { email: 'active' } } }),
  401: () => ({ message: `Unauthenticated. ${LEAK_MARKER}` }),
  422: (email) => ({ message: `The given data was invalid. ${LEAK_MARKER}`, errors: { email: [`${email} is invalid`] } }),
  429: () => ({ message: `Too Many Attempts. ${LEAK_MARKER}` }),
  500: (email) => ({ message: `Server Error ${LEAK_MARKER} ${email}` }),
};

function emailOf(body) {
  try { return JSON.parse(body).email ?? ''; } catch { return ''; }
}

const api = https.createServer(contexts.good, (req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, headers: req.headers, body, mode });
    console.log(`[fake-sender] ${mode} ${req.method} ${req.url} ${body}`);
    if (mode === 'hang') {
      hanging.add(res);
      res.on('close', () => hanging.delete(res));
      return;
    }
    const status = Number(mode) || 201;
    const headers = { 'content-type': 'application/json', 'x-fake-sender': LEAK_MARKER };
    if (status === 401) headers['www-authenticate'] = `Bearer realm="${LEAK_MARKER}"`;
    if (status === 429) headers['retry-after'] = '60';
    res.writeHead(status, headers);
    res.end(JSON.stringify((BODIES[status] || BODIES[500])(emailOf(body))));
  });
});

let listening = false;
function listen() {
  if (listening) return Promise.resolve();
  listening = true;
  return new Promise((resolve) => api.listen(443, '0.0.0.0', resolve));
}
function unlisten() {
  if (!listening) return Promise.resolve();
  listening = false;
  return new Promise((resolve) => {
    api.close(() => resolve());
    api.closeAllConnections();
  });
}

async function setMode(next) {
  mode = next;
  for (const res of hanging) res.destroy();
  if (mode === 'down') return unlisten();
  api.setSecureContext(contexts[mode] || contexts.good);
  return listen();
}

const control = http.createServer(async (req, res) => {
  // Connection: close, so the harness's fetch never reuses a socket this
  // server is about to time out, which fails the call with "fetch failed".
  const reply = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify(value));
  };
  if (req.method === 'GET' && req.url === '/requests') return reply(200, requests);
  if (req.method === 'POST' && req.url === '/reset') { requests = []; return reply(200, { ok: true }); }
  const m = req.method === 'POST' && req.url.match(/^\/mode\/([a-z0-9-]+)$/);
  if (m) { await setMode(m[1]); return reply(200, { mode }); }
  return reply(404, { error: 'unknown control route' });
});

await setMode(mode);
control.listen(8080, '0.0.0.0', () => console.log(`[fake-sender] ready, mode ${mode}`));
