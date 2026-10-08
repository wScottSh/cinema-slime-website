import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createPlainServer } from 'node:net';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntake, normalizeFingerprint } from './intake.js';
import { renderOutcome } from './outcome.js';

const SECRET = 'a'.repeat(64);
const COMMAND = { kind: 'intake', craig: { id: '6JPyMh5Jcb5X', key: 'sLLx9b' }, title: 'Spider-Man Noir S1E9' };
const MENTION = { messageId: 'm1', channelId: 'c', guildId: 'g', authorId: 'u' };
const EPISODE_URL = 'https://edit.cinemaslime.com/ep_1';

// A throwaway self-signed certificate with no name or IP, like the editor's.
function selfSigned(name) {
  const dir = mkdtempSync(join(tmpdir(), `intake-${name}-`));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
    '-subj', `/O=${name}`, '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
  ], { stdio: 'ignore' });
  const cert = readFileSync(join(dir, 'cert.pem'));
  return { key: readFileSync(join(dir, 'key.pem')), cert, sha256: new X509Certificate(cert).fingerprint256 };
}

const PINNED = selfSigned('editor');
const OTHER = selfSigned('impostor');

// An editor on 127.0.0.1 that answers every request with respond(req, body),
// and records what it was sent.
async function editor(respond, cert = PINNED) {
  const received = [];
  const server = createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(text) });
      const answer = respond(req);
      if (!answer) return;
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `https://127.0.0.1:${server.address().port}/api/intake`;
  return { url, received, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

async function runAgainst(answer, { cert, config = {}, timeoutMs } = {}) {
  const server = await editor(() => answer, cert);
  try {
    const intake = createIntake({ url: server.url, certSha256: PINNED.sha256, secret: SECRET, ...config }, { timeoutMs });
    const outcome = await intake.run(COMMAND, MENTION);
    assert.doesNotThrow(() => renderOutcome(outcome), `no reply for ${JSON.stringify(outcome)}`);
    return { outcome, received: server.received };
  } finally {
    await server.close();
  }
}

test('201 is a new Episode; the request carries the secret, the recording and the mention, and nothing else', async () => {
  const { outcome, received } = await runAgainst({ status: 201, body: { episodeId: 'ep_1', url: EPISODE_URL, created: true } });
  assert.deepEqual(outcome, { kind: 'episode', change: 'created', episodeId: 'ep_1', url: EPISODE_URL, title: COMMAND.title });
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].url, '/api/intake');
  assert.equal(received[0].headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual(received[0].body, {
    craig: { id: '6JPyMh5Jcb5X', key: 'sLLx9b' },
    discord: { guildId: 'g', channelId: 'c', messageId: 'm1', authorId: 'u' },
    title: 'Spider-Man Noir S1E9',
  });
});

test('200 is an Episode that already exists for that recording', async () => {
  const { outcome } = await runAgainst({ status: 200, body: { episodeId: 'ep_1', url: EPISODE_URL, created: false } });
  assert.deepEqual(outcome, { kind: 'episode', change: 'exists', episodeId: 'ep_1', url: EPISODE_URL, title: COMMAND.title });
});

test('a 2xx without an episodeId and url is not reported as an Episode', async () => {
  const { outcome } = await runAgainst({ status: 201, body: { created: true } });
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.step, 'editor-response');
});

test('each Craig code in a 422 becomes its own refusal, and an unlisted code is named', async () => {
  for (const [code, reason] of [
    ['invalid_key', 'craig-invalid-key'],
    ['no_rec', 'craig-no-rec'],
    ['recording_deleted', 'craig-recording-deleted'],
    ['rec_no_data', 'craig-rec-no-data'],
    ['invalid_rec', 'craig-invalid-rec'],
  ]) {
    const { outcome } = await runAgainst({ status: 422, body: { error: 'x', code } });
    assert.deepEqual(outcome, { kind: 'refused', reason }, code);
  }
  assert.deepEqual((await runAgainst({ status: 422, body: { error: 'x', code: 'rec_haunted' } })).outcome, { kind: 'refused', reason: 'craig-other', code: 'rec_haunted' });
  assert.deepEqual((await runAgainst({ status: 422, body: { error: 'x', code: 'craig_unreachable' } })).outcome, { kind: 'failed', step: 'craig' });
});

test('400 and 401 are the editor refusing the request, not Craig', async () => {
  assert.deepEqual((await runAgainst({ status: 400, body: { error: 'craig.id missing' } })).outcome, { kind: 'failed', step: 'editor-response', detail: 'HTTP 400: craig.id missing' });
  assert.deepEqual((await runAgainst({ status: 401, body: { error: 'unauthorized' } })).outcome, { kind: 'failed', step: 'editor-auth' });
});

test('a 5xx, a closed port, or no answer in time is the editor being unreachable', async () => {
  assert.deepEqual((await runAgainst({ status: 503, body: {} })).outcome, { kind: 'failed', step: 'editor', detail: 'HTTP 503' });

  const closed = createPlainServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));
  const refused = await createIntake({ url: `https://127.0.0.1:${port}/api/intake`, certSha256: PINNED.sha256, secret: SECRET }).run(COMMAND, MENTION);
  assert.deepEqual(refused, { kind: 'failed', step: 'editor', detail: 'ECONNREFUSED' });

  const silent = await runAgainst(null, { timeoutMs: 300 });
  assert.deepEqual(silent.outcome, { kind: 'failed', step: 'editor', detail: 'no answer within 0.3s' });
});

test('only the pinned certificate is accepted: another self-signed one never receives the request', async () => {
  const impostor = await runAgainst({ status: 201, body: { episodeId: 'ep_1', url: EPISODE_URL } }, { cert: OTHER });
  assert.equal(impostor.outcome.kind, 'failed');
  assert.equal(impostor.outcome.step, 'editor-cert');
  assert.deepEqual(impostor.received, [], 'the secret was never sent');

  const pinned = await runAgainst({ status: 201, body: { episodeId: 'ep_1', url: EPISODE_URL } }, { cert: PINNED });
  assert.equal(pinned.outcome.kind, 'episode');
});

test('the pin may be written with or without colons, in either case', async () => {
  const bare = PINNED.sha256.replace(/:/g, '').toLowerCase();
  assert.equal(normalizeFingerprint(bare), PINNED.sha256);
  const { outcome } = await runAgainst({ status: 200, body: { episodeId: 'ep_1', url: EPISODE_URL } }, { config: { certSha256: bare } });
  assert.equal(outcome.change, 'exists');
});

test('a missing URL, pin or secret answers intake-off without touching the network', async () => {
  for (const config of [
    undefined,
    { certSha256: PINNED.sha256, secret: SECRET },
    { url: 'https://127.0.0.1:1/api/intake', secret: SECRET },
    { url: 'https://127.0.0.1:1/api/intake', certSha256: 'not-a-fingerprint', secret: SECRET },
    { url: 'https://127.0.0.1:1/api/intake', certSha256: PINNED.sha256, secret: '' },
    { url: 'http://127.0.0.1:1/api/intake', certSha256: PINNED.sha256, secret: SECRET },
  ]) {
    const intake = createIntake(config);
    assert.equal(intake.configured, false, JSON.stringify(config));
    assert.deepEqual(await intake.run(COMMAND, MENTION), { kind: 'failed', step: 'intake-off' }, JSON.stringify(config));
  }
});
