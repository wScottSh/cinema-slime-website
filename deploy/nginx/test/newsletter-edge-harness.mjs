// Proves the newsletter edge (cinemaslime-newsletter-*.conf) against real nginx.
//
// The committed confs are installed into a copy of the production vhost
// fixture by the real installer, served by nginx in docker, and pointed at a
// fake Sender (fake-sender.mjs) that docker's DNS answers for as api.sender.net.
// The fake presents a certificate from a throwaway CA, and that CA is mounted
// as nginx's whole CA bundle, so `proxy_ssl_verify on` is exercised for real.
// The one edit made to the installed config is the resolver address: docker's
// embedded DNS is 127.0.0.11, the droplet's is 127.0.0.53. (The vhost's include
// paths are also mapped from the installer's scratch dir to /etc/nginx/snippets.)
//
// Every request comes from its own client container, so each scenario has its
// own client address and the rate limit only bites where a scenario means it to.
//
//   bash deploy/nginx/test/run-newsletter-edge-tests.sh            run the assertions
//   bash deploy/nginx/test/run-newsletter-edge-tests.sh --serve    keep the stack up,
//       serving dist/ on 0.0.0.0:8744 (NEWSLETTER_EDGE_PORT) with the fake answering 201, until Ctrl-C
//
// NEWSLETTER_EDGE_NGINX_IMAGE picks the nginx (default nginx:1.24, the version
// Ubuntu 24.04 ships). NEWSLETTER_EDGE_NODE_IMAGE picks the fake's runtime.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictNewsletterRoute } from '../../../src/edge-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const NGINX_IMAGE = process.env.NEWSLETTER_EDGE_NGINX_IMAGE || 'nginx:1.24';
const NODE_IMAGE = process.env.NEWSLETTER_EDGE_NODE_IMAGE || 'node:22-bookworm';
const SERVE = process.argv.includes('--serve');
const SERVE_PORT = Number(process.env.NEWSLETTER_EDGE_PORT || 8744);

const TOKEN = 'test-token.eyJhbGciOi.JIUzI1NiJ9-x_y|42';
const GROUP = 'eZVD4w';
const P = `cs-nl-${process.pid}`;
const NET = P;
const NGINX = `${P}-nginx`;
const FAKE = `${P}-fake`;
const LEAK_MARKER = 'FAKE-SENDER-LEAK';

const tmp = mkdtempSync(join(tmpdir(), 'cs-newsletter-edge-'));
const containers = [];
let passed = 0;
let failed = 0;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}
function docker(...args) { return sh('docker', args).trim(); }
function tryDocker(...args) { return spawnSync('docker', args, { encoding: 'utf8' }); }

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

function cleanup() {
  for (const c of containers.reverse()) tryDocker('rm', '-f', c);
  tryDocker('network', 'rm', NET);
  rmSync(tmp, { recursive: true, force: true });
}

// ── certificates ────────────────────────────────────────────────────────────
function makeCerts(dir) {
  mkdirSync(dir, { recursive: true });
  const o = (...args) => sh('openssl', args, { cwd: dir });
  const ext = (name, body) => writeFileSync(join(dir, name), body);
  ext('ca.ext', 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  ext('leaf.ext', 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:api.sender.net\n');
  ext('wrong-name.ext', 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:not-sender.example\n');
  ext('site.ext', 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:cinemaslime.com,DNS:localhost,IP:127.0.0.1\n');

  const key = (name) => o('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${name}.key`);
  const selfSigned = (name, cn) => { key(name); o('req', '-x509', '-new', '-key', `${name}.key`, '-subj', `/CN=${cn}`, '-days', '2', '-out', `${name}.pem`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'); };
  const signed = (name, cn, issuer, extFile) => {
    key(name);
    o('req', '-new', '-key', `${name}.key`, '-subj', `/CN=${cn}`, '-out', `${name}.csr`);
    o('x509', '-req', '-in', `${name}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', '2', '-extfile', extFile, '-out', `${name}.pem`);
  };
  selfSigned('root', 'Newsletter Harness Root');
  // Two intermediates, so a verify depth too shallow for a cross-signed public
  // chain fails here rather than in production.
  signed('intermediate', 'Newsletter Harness Intermediate', 'root', 'ca.ext');
  signed('issuing', 'Newsletter Harness Issuing CA', 'intermediate', 'ca.ext');
  signed('leaf', 'api.sender.net', 'issuing', 'leaf.ext');
  signed('wrong-name', 'not-sender.example', 'issuing', 'wrong-name.ext');
  selfSigned('rogue-root', 'Rogue Root');
  signed('rogue-leaf', 'api.sender.net', 'rogue-root', 'leaf.ext');
  signed('site', 'cinemaslime.com', 'root', 'site.ext');
  const cat = (out, ...parts) => writeFileSync(join(dir, out), parts.map((p) => readFileSync(join(dir, p), 'utf8')).join(''));
  cat('leaf-chain.pem', 'leaf.pem', 'issuing.pem', 'intermediate.pem');
  cat('wrong-name-chain.pem', 'wrong-name.pem', 'issuing.pem', 'intermediate.pem');
  cat('site-chain.pem', 'site.pem', 'intermediate.pem');
  for (const f of readdirSync(dir)) chmodSync(join(dir, f), 0o644);
}

// ── the edge config, installed by the real installer ────────────────────────
function installEdgeConfig() {
  const box = join(tmp, 'box');
  for (const d of ['confd', 'snippets', 'backups', 'cache', 'systemd', 'bin', 'units']) mkdirSync(join(box, d), { recursive: true });
  copyFileSync(join(ROOT, 'deploy/nginx/test/fixtures/vhost-real.conf'), join(box, 'vhost'));
  const env = {
    ...process.env,
    EDGE_VHOST: join(box, 'vhost'), EDGE_CONFD: join(box, 'confd'), EDGE_SNIPPETS: join(box, 'snippets'),
    EDGE_BACKUP_ROOT: join(box, 'backups'), EDGE_SKIP_PACKAGES: '1', EDGE_CACHE_PREFIX: join(box, 'cache'),
    EDGE_NGINX_TEST_CMD: 'true', EDGE_NGINX_RELOAD_CMD: 'true',
    EDGE_SYSTEMD_DROPIN_DIR: join(box, 'systemd'), EDGE_SYSTEMCTL_DAEMON_RELOAD_CMD: 'true',
    EDGE_WATCHDOG_BIN_DIR: join(box, 'bin'), EDGE_SYSTEMD_UNIT_DIR: join(box, 'units'), EDGE_SYSTEMCTL_CMD: 'true',
  };
  const log = sh('bash', [join(ROOT, 'deploy/nginx/install-edge-config.sh'), '--payload', join(ROOT, 'deploy/nginx')], { env });
  check('installer claims both newsletter locations from the snippet',
    log.includes('location = /api/newsletter') && log.includes('location = /_newsletter/subscribe'));
  check('installer duplicate-location preflight is clean with the newsletter snippet', log.includes('duplicate-location preflight: clean'));
  const vhost = readFileSync(join(box, 'vhost'), 'utf8');
  check('vhost includes the newsletter snippet inside the managed block',
    /# >>> cinemaslime managed by CI >>>[\s\S]*include .*\/cinemaslime-newsletter-location\.conf;[\s\S]*# <<< cinemaslime managed by CI <<</.test(vhost));

  const etc = join(tmp, 'etc');
  mkdirSync(join(etc, 'conf.d'), { recursive: true });
  mkdirSync(join(etc, 'snippets'), { recursive: true });
  let rewrites = 0;
  const dockerDns = (text) => text.replace(/resolver 127\.0\.0\.53\b/g, () => { rewrites++; return 'resolver 127.0.0.11'; });
  for (const f of readdirSync(join(box, 'confd'))) writeFileSync(join(etc, 'conf.d', f), dockerDns(readFileSync(join(box, 'confd', f), 'utf8')));
  for (const f of readdirSync(join(box, 'snippets'))) writeFileSync(join(etc, 'snippets', f), dockerDns(readFileSync(join(box, 'snippets', f), 'utf8')));
  // The installer wrote includes for the EDGE_SNIPPETS dir it was given; inside
  // the container that dir is mounted at the real path.
  writeFileSync(join(etc, 'conf.d', 'zz-cinemaslime.com.conf'), vhost.split(join(box, 'snippets')).join('/etc/nginx/snippets'));
  check('the newsletter snippet carries its own resolver line (rewritten for docker DNS)',
    readFileSync(join(etc, 'snippets', 'cinemaslime-newsletter-location.conf'), 'utf8').includes('resolver 127.0.0.11 '));
  writeHarnessOnlyServer(etc);
  return { etc, rewrites };
}

// A plain-HTTP server on 8081 that only the harness writes and only the client
// containers reach. It lets real nginx evaluate the shipped address pattern on
// input no HTTP header can carry: a header line cannot end in a newline, but a
// decoded $uri can.
const PROBE_PORT = 8081;
function writeHarnessOnlyServer(etc) {
  const snippet = readFileSync(join(etc, 'snippets', 'cinemaslime-newsletter-location.conf'), 'utf8');
  const pattern = snippet.match(/if \(\$http_x_newsletter_email !~ "([^"]+)"\)/)[1];
  // A map, not `if` + `set $1`: nginx re-escapes a numbered capture taken from
  // a %-encoded URI, which would turn the newline back into %0A.
  writeFileSync(join(etc, 'conf.d', 'zz-harness-only.conf'), `map $uri $email_probe {
    "~(?s)\\A/_email/(?<probe_email>.*)\\z" $probe_email;
}
server {
    listen ${PROBE_PORT};
    location /_email/ {
        if ($email_probe !~ "${pattern}") {
            return 422;
        }
        return 204;
    }
}
`);
}

function probe(client, path) {
  return Number(docker('exec', client, 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', `http://${NGINX}:${PROBE_PORT}${path}`));
}

function imageFilterModulePath() {
  const out = tryDocker('run', '--rm', '--entrypoint', 'sh', NGINX_IMAGE, '-c',
    'ls /usr/lib/nginx/modules/ngx_http_image_filter_module.so /etc/nginx/modules/ngx_http_image_filter_module.so 2>/dev/null | head -1').stdout.trim();
  if (!out) throw new Error(`${NGINX_IMAGE} has no image_filter module; the art snippet cannot load`);
  return out;
}

function writeNginxConf(etc) {
  // The stock Ubuntu shape: default `combined` access log, conf.d inside http{}.
  // The log goes to a file because the official image links access.log to stdout.
  writeFileSync(join(etc, 'nginx.conf'), `load_module ${imageFilterModulePath()};
user www-data;
worker_processes 1;
error_log /var/log/nginx/cs-error.log info;
pid /run/nginx.pid;
events { worker_connections 256; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /var/log/nginx/cs-access.log;
    sendfile on;
    include /etc/nginx/conf.d/*.conf;
}
`);
}

function writeLetsEncrypt(certs) {
  const le = join(tmp, 'letsencrypt');
  mkdirSync(join(le, 'live/cinemaslime.com'), { recursive: true });
  copyFileSync(join(certs, 'site-chain.pem'), join(le, 'live/cinemaslime.com/fullchain.pem'));
  copyFileSync(join(certs, 'site.key'), join(le, 'live/cinemaslime.com/privkey.pem'));
  writeFileSync(join(le, 'options-ssl-nginx.conf'), 'ssl_protocols TLSv1.2 TLSv1.3;\n');
  // RFC 7919 ffdhe2048, so the harness does not spend seconds generating one.
  writeFileSync(join(le, 'ssl-dhparams.pem'), `-----BEGIN DH PARAMETERS-----
MIIBCAKCAQEA//////////+t+FRYortKmq/cViAnPTzx2LnFg84tNpWp4TZBFGQz
+8yTnc4kmz75fS/jY2MMddj2gbICrsRhetPfHtXV/WVhJDP1H18GbtCFY2VVPe0a
87VXE15/V8k1mE8McODmi3fipona8+/och3xWKE2rec1MKzKT0g6eXq8CrGCsyT7
YdEIqUuyyOP7uWrat2DX9GgdT0Kj3jlN9K5W7edjcrsZCwenyO4KbXCeAvzhzffi
7MA0BM0oNC9hkXL+nOmFg/+OTxIy7vKBg8P+OxtMb61zO7X8vC7CIAXFjvGDfRaD
ssbzSibBsu/6iGtCOGEoXJf//////////wIBAg==
-----END DH PARAMETERS-----
`);
  return le;
}

// Written the way the deploy writes it: rendered, then piped to the text of
// install-sender-secret.sh as a shell command.
function installSecret(dir, env) {
  const out = sh('bash', [join(ROOT, 'deploy/nginx/render-sender-secret.sh')], { env: { ...process.env, ...env } });
  sh('bash', ['-c', readFileSync(join(ROOT, 'deploy/nginx/install-sender-secret.sh'), 'utf8')],
    { input: out, env: { ...process.env, SENDER_SECRET_DIR: dir } });
}

// ── the stack ───────────────────────────────────────────────────────────────
function startStack({ etc, certs, le, secrets, site }) {
  docker('network', 'create', NET);
  containers.push(FAKE);
  docker('run', '-d', '--name', FAKE, '--network', NET, '--network-alias', 'api.sender.net',
    '-v', `${join(HERE, 'fake-sender.mjs')}:/fake-sender.mjs:ro`, '-v', `${certs}:/certs:ro`,
    '-p', '127.0.0.1::8080', NODE_IMAGE, 'node', '/fake-sender.mjs');
  const controlPort = docker('port', FAKE, '8080/tcp').split('\n')[0].split(':').pop();

  containers.push(NGINX);
  const publish = SERVE ? `0.0.0.0:${SERVE_PORT}:443` : '127.0.0.1::443';
  // The installer creates the cache dirs on the droplet; a tmpfs stands in.
  docker('run', '-d', '--name', NGINX, '--network', NET, '-p', publish, '--tmpfs', '/var/cache/nginx',
    '-v', `${join(etc, 'nginx.conf')}:/etc/nginx/nginx.conf:ro`,
    '-v', `${join(etc, 'conf.d')}:/etc/nginx/conf.d:ro`,
    '-v', `${join(etc, 'snippets')}:/etc/nginx/snippets:ro`,
    '-v', `${secrets}:/etc/nginx/cinemaslime-secrets:ro`,
    '-v', `${le}:/etc/letsencrypt:ro`,
    '-v', `${join(certs, 'root.pem')}:/etc/ssl/certs/ca-certificates.crt:ro`,
    '-v', `${site}:/var/www/cinemaslime/html:ro`,
    '--entrypoint', 'nginx', NGINX_IMAGE, '-g', 'daemon off;');
  return { controlPort };
}

async function waitFor(what, fn, ms = 15000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    try { if (await fn()) return; } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}\n${tryDocker('logs', NGINX).stderr}`);
}

function fakeControl(controlPort) {
  const base = `http://127.0.0.1:${controlPort}`;
  return {
    mode: async (m) => { const r = await fetch(`${base}/mode/${m}`, { method: 'POST' }); if (!r.ok) throw new Error(`mode ${m}: ${r.status}`); },
    reset: async () => { await fetch(`${base}/reset`, { method: 'POST' }); },
    requests: async () => (await fetch(`${base}/requests`)).json(),
  };
}

let clientSeq = 0;
function newClient() {
  const name = `${P}-client-${++clientSeq}`;
  containers.push(name);
  docker('run', '-d', '--name', name, '--network', NET, '--entrypoint', 'sleep', NGINX_IMAGE, 'infinity');
  return name;
}

// One HTTPS request from a client container. Returns status, headers, body and
// curl's own wall-clock time, so container start-up never pollutes a timing.
function request(client, { method = 'POST', email, extraHeaders = [], path = '/api/newsletter' } = {}) {
  const args = ['exec', client, 'curl', '-sk', '--max-time', '20', '-X', method, '-D', '/tmp/h', '-o', '/tmp/b',
    '-w', '%{http_code} %{time_total}', `https://${NGINX}${path}`];
  if (email !== undefined) args.push('-H', `X-Newsletter-Email: ${email}`);
  for (const h of extraHeaders) args.push('-H', h);
  const [status, time] = docker(...args).split(' ');
  const headers = docker('exec', client, 'cat', '/tmp/h');
  const body = docker('exec', client, 'cat', '/tmp/b');
  return { status: Number(status), seconds: Number(time), headers, body };
}

// A raw request over TLS, for header bytes curl refuses to send.
function rawRequest(client, raw) {
  const r = spawnSync('docker', ['exec', '-i', client, 'openssl', 's_client', '-quiet', '-connect', `${NGINX}:443`, '-servername', 'cinemaslime.com'],
    { input: raw, encoding: 'utf8', timeout: 15000 });
  const m = (r.stdout || '').match(/^HTTP\/1\.1 (\d{3})/m);
  return { status: m ? Number(m[1]) : 0, text: r.stdout || '' };
}

function nginxReload() {
  docker('exec', NGINX, 'nginx', '-s', 'reload');
}

// A cold start, not a reload: a reload that fails keeps the old config
// serving, which would hide a config nginx cannot start with.
async function nginxRestart() {
  tryDocker('restart', '-t', '2', NGINX);
  try {
    await waitFor('nginx to start again', () => tryDocker('exec', NGINX, 'curl', '-sk', '-o', '/dev/null', 'https://127.0.0.1/').status === 0, 10000);
    return true;
  } catch {
    return false;
  }
}

async function scenarios({ fake, secrets }) {
  const addresses = [];
  const addr = (tag) => { const a = `slime.${tag}+${process.pid}@example.com`; addresses.push(a); return a; };
  const expectBody = (email) => `{"email":"${email}","groups":["${GROUP}"]}`;

  console.log('\n## a valid address is subscribed, and only nginx speaks to Sender');
  for (const fakeStatus of ['201', '200']) {
    await fake.mode(fakeStatus); await fake.reset();
    const email = addr(`ok${fakeStatus}`);
    const res = request(newClient(), { email, extraHeaders: ['Cookie: session=visitor-cookie', 'X-Forwarded-For: 203.0.113.9'] });
    const seen = await fake.requests();
    check(`Sender ${fakeStatus}: browser gets 204`, res.status === 204, `got ${res.status}`);
    check(`Sender ${fakeStatus}: browser gets an empty body`, res.body === '', JSON.stringify(res.body));
    check(`Sender ${fakeStatus}: no Sender header reaches the browser`, !res.headers.includes(LEAK_MARKER), res.headers);
    check(`Sender ${fakeStatus}: Sender saw exactly one request`, seen.length === 1, `saw ${seen.length}`);
    const s = seen[0] || { headers: {} };
    check(`Sender ${fakeStatus}: it is POST /v2/subscribers`, s.method === 'POST' && s.url === '/v2/subscribers', `${s.method} ${s.url}`);
    check(`Sender ${fakeStatus}: the body is exactly the address and the group`, s.body === expectBody(email), s.body);
    check(`Sender ${fakeStatus}: the token is sent as a Bearer token`, s.headers.authorization === `Bearer ${TOKEN}`, s.headers.authorization);
    check(`Sender ${fakeStatus}: JSON content type and accept`, s.headers['content-type'] === 'application/json' && s.headers.accept === 'application/json');
    check(`Sender ${fakeStatus}: Host is api.sender.net`, s.headers.host === 'api.sender.net', s.headers.host);
    check(`Sender ${fakeStatus}: no visitor header is forwarded (cookie, address header, X-Forwarded-For)`,
      !('cookie' in s.headers) && !('x-newsletter-email' in s.headers) && !('x-forwarded-for' in s.headers), JSON.stringify(s.headers));
  }

  console.log('\n## malformed or hostile addresses never reach Sender');
  await fake.mode('201');
  const hostile = [
    ['a double quote', 'a"b@example.com'],
    ['a backslash', 'a\\b@example.com'],
    ['a JSON breakout', 'x@example.com","groups":["x'],
    ['a space', 'a b@example.com'],
    ['no domain dot', 'slime@localhost'],
    ['a lone dot local part (.@a.b)', '.@a.b'],
    ['a double dot local part (..@x.co)', '..@x.co'],
    ['hyphens only (-@-.-)', '-@-.-'],
    ['consecutive dots inside the local part', 'a..b@x.co'],
    ['a label starting with a hyphen', 'a@-x.co'],
    ['a numeric last label', 'a@x.c0'],
    ['255 characters', `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`],
  ];
  const c = newClient();
  for (const [label, email] of hostile) {
    await fake.reset();
    const res = request(c, { email });
    check(`${label}: 422`, res.status === 422, `got ${res.status}`);
    check(`${label}: Sender saw nothing`, (await fake.requests()).length === 0);
  }
  await fake.reset();
  const punctuated = "a.b-c_d+e'f@x-y.example.org";
  const punctuatedRes = request(newClient(), { email: punctuated });
  check('punctuation inside the local part and hyphens inside labels are accepted and sent as typed',
    punctuatedRes.status === 204 && (await fake.requests()).map((r) => r.body).join() === expectBody(punctuated), `got ${punctuatedRes.status}`);
  addresses.push(punctuated);
  await fake.reset();
  const longest = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
  const atCap = request(newClient(), { email: longest });
  check('a 254-character address is accepted (the cap is 254, not less)', longest.length === 254 && atCap.status === 204, `len ${longest.length}, got ${atCap.status}`);
  addresses.push(longest);

  // A CRLF ends the header line, so it cannot put bytes into the address: what
  // follows becomes a separate (here invalid, so ignored) header line.
  await fake.reset();
  const crlf = rawRequest(newClient(),
    'POST /api/newsletter HTTP/1.1\r\nHost: cinemaslime.com\r\nX-Newsletter-Email: crlf@example.com\r\n","groups":["x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  const crlfSeen = await fake.requests();
  check('a CRLF in the header splits it; nothing after the CRLF reaches Sender',
    crlfSeen.every((r) => r.body === expectBody('crlf@example.com')), JSON.stringify(crlfSeen.map((r) => r.body)));
  addresses.push('crlf@example.com');
  await fake.reset();
  const bareCr = rawRequest(newClient(),
    'POST /api/newsletter HTTP/1.1\r\nHost: cinemaslime.com\r\nX-Newsletter-Email: cr@example.com\r","groups":["x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  check('a bare CR inside the header value is refused (4xx)', bareCr.status >= 400 && bareCr.status < 500, `got ${bareCr.status}`);
  check('a bare CR inside the header value: Sender saw nothing', (await fake.requests()).length === 0);

  check('the shipped pattern, in nginx: an address passes', probe(c, '/_email/slime@example.com') === 204);
  check('the shipped pattern, in nginx: the same address with a trailing newline fails',
    probe(c, '/_email/slime@example.com%0A') === 422);

  await fake.reset();
  const missing = request(newClient(), {});
  check('missing header: 422', missing.status === 422, `got ${missing.status}`);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = request(c, { method, email: addr(`m${method}`) });
    check(`${method}: 405`, res.status === 405, `got ${res.status}`);
    check(`${method}: 405 names POST in Allow`, /^allow: POST\r?$/mi.test(res.headers), res.headers);
  }
  check('missing header and wrong methods: Sender saw nothing', (await fake.requests()).length === 0);

  const contractRes = request(c, { method: 'GET' });
  const verdict = verdictNewsletterRoute({ status: contractRes.status, headers: parseHeaders(contractRes.headers), body: contractRes.body });
  check('the edge contract verdict passes against this nginx', verdict.pass, verdict.reason);

  console.log('\n## every Sender failure is a bare 5xx');
  for (const fakeStatus of ['401', '422', '429', '500']) {
    await fake.mode(fakeStatus); await fake.reset();
    const email = addr(`f${fakeStatus}`);
    const res = request(newClient(), { email });
    check(`Sender ${fakeStatus}: browser gets a 5xx`, res.status >= 500 && res.status < 600, `got ${res.status}`);
    check(`Sender ${fakeStatus}: Sender was called once`, (await fake.requests()).length === 1);
    check(`Sender ${fakeStatus}: no byte of Sender's body or headers reaches the browser`,
      !res.body.includes(LEAK_MARKER) && !res.body.includes(email) && !res.headers.includes(LEAK_MARKER)
        && !/^www-authenticate:/mi.test(res.headers) && !/^retry-after:/mi.test(res.headers),
      `${res.headers}\n${res.body}`);
  }

  console.log('\n## a slow or dead Sender fails fast');
  await fake.mode('hang'); await fake.reset();
  const hung = request(newClient(), { email: addr('hang') });
  check('Sender hangs: 5xx', hung.status >= 500, `got ${hung.status}`);
  check('Sender hangs: answered within the 5s read timeout (+1s slack)', hung.seconds < 6, `${hung.seconds}s`);
  await fake.mode('down'); await fake.reset();
  const down = request(newClient(), { email: addr('down') });
  check('Sender down: 5xx', down.status >= 500, `got ${down.status}`);
  check('Sender down: answered in under 2s', down.seconds < 2, `${down.seconds}s`);

  console.log('\n## the certificate is verified');
  for (const m of ['wrong-ca', 'wrong-name']) {
    await fake.mode(m); await fake.reset();
    const res = request(newClient(), { email: addr(m) });
    check(`${m}: 5xx`, res.status >= 500, `got ${res.status}`);
    check(`${m}: Sender received no request (the token never left nginx)`, (await fake.requests()).length === 0);
  }

  console.log('\n## one client is rate limited');
  await fake.mode('201'); await fake.reset();
  const burster = newClient();
  const statuses = [];
  for (let i = 0; i < 8; i++) statuses.push(request(burster, { email: addr(`burst${i}`) }).status);
  check('burst: the first five are subscribed', statuses.slice(0, 5).every((s) => s === 204), statuses.join(' '));
  check('burst: the rest are 429', statuses.slice(5).every((s) => s === 429), statuses.join(' '));
  check('burst: Sender saw only the five', (await fake.requests()).length === 5);
  const other = request(newClient(), { email: addr('other-client') });
  check('burst: a different client is unaffected', other.status === 204, `got ${other.status}`);

  console.log('\n## an empty token answers 503 without calling Sender');
  writeFileSync(join(secrets, 'sender.conf'), `set $sender_token "";\nset $sender_group "${GROUP}";\n`);
  nginxReload();
  await waitFor('reload with the empty token', async () => request(c, { email: addr('probe-empty') }).status === 503);
  await fake.reset();
  const empty = request(newClient(), { email: addr('empty') });
  check('empty token: 503', empty.status === 503, `got ${empty.status}`);
  check('empty token: Sender saw nothing', (await fake.requests()).length === 0);

  console.log('\n## without the secret include, the site starts and the signup answers 503');
  const without = [
    ['sender.conf absent', () => rmSync(join(secrets, 'sender.conf'), { force: true })],
    ['sender.conf empty', () => writeFileSync(join(secrets, 'sender.conf'), '')],
  ];
  for (const [label, arrange] of without) {
    arrange();
    const started = await nginxRestart();
    check(`${label}: nginx starts`, started, tryDocker('logs', '--tail', '5', NGINX).stderr);
    if (!started) continue;
    const home = request(newClient(), { method: 'GET', path: '/' });
    check(`${label}: the rest of the site answers`, home.status === 200 && home.body.includes('spa shell'), `got ${home.status}`);
    await fake.reset();
    const signup = request(newClient(), { email: addr(label.replace(/\W/g, '')) });
    check(`${label}: the signup answers 503`, signup.status === 503, `got ${signup.status}`);
    check(`${label}: Sender saw nothing`, (await fake.requests()).length === 0);
  }
  installSecret(secrets, { SENDER_API_TOKEN: TOKEN, SENDER_GROUP_ID: GROUP });
  check('the secret installed again: nginx starts', await nginxRestart());
  await fake.mode('201'); await fake.reset();
  const restored = request(newClient(), { email: addr('restored') });
  check('the secret installed again: the signup reaches Sender', restored.status === 204 && (await fake.requests()).length === 1, `got ${restored.status}`);

  console.log('\n## logs');
  const access = docker('exec', NGINX, 'cat', '/var/log/nginx/cs-access.log');
  const errors = docker('exec', NGINX, 'cat', '/var/log/nginx/cs-error.log');
  check('access log recorded the newsletter requests (the next checks are not vacuous)', (access.match(/\/api\/newsletter/g) || []).length >= 20);
  const leaked = addresses.filter((a) => access.includes(a) || errors.includes(a));
  check('neither log holds any address', leaked.length === 0, leaked.join(', '));
  check('neither log holds the token', !access.includes(TOKEN) && !errors.includes(TOKEN.split('|')[0]));
}

function parseHeaders(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const certs = join(tmp, 'certs');
  makeCerts(certs);
  const { etc } = installEdgeConfig();
  writeNginxConf(etc);
  const le = writeLetsEncrypt(certs);
  const secrets = join(tmp, 'secrets');
  installSecret(secrets, { SENDER_API_TOKEN: TOKEN, SENDER_GROUP_ID: GROUP });
  check('the rendered secret include sets both variables', /^set \$sender_token "[^"]+";$/m.test(readFileSync(join(secrets, 'sender.conf'), 'utf8'))
    && /^set \$sender_group "eZVD4w";$/m.test(readFileSync(join(secrets, 'sender.conf'), 'utf8')));

  let site = join(ROOT, 'dist');
  if (!SERVE || !existsSync(join(site, 'index.html'))) {
    if (SERVE) throw new Error('no dist/index.html: run `npm run build` first');
    site = join(tmp, 'site');
    mkdirSync(site);
    writeFileSync(join(site, 'index.html'), '<!doctype html><title>spa shell</title>\n');
  }

  const { controlPort } = startStack({ etc, certs, le, secrets, site });
  const fake = fakeControl(controlPort);
  await waitFor('the fake Sender', async () => { await fake.requests(); return true; });
  await waitFor('nginx', () => tryDocker('exec', NGINX, 'curl', '-sk', '-o', '/dev/null', 'https://127.0.0.1/').status === 0);
  console.log(`nginx: ${NGINX_IMAGE} (${docker('exec', NGINX, 'nginx', '-v').trim() || tryDocker('exec', NGINX, 'nginx', '-v').stderr.trim()})`);

  if (SERVE) {
    await fake.mode('201');
    console.log(`
The stack is up. Ctrl-C stops it and removes every container.
  site (built dist/, self-signed cert):  https://<this host's LAN IP>:${SERVE_PORT}/
  Vite dev against it:                   NEWSLETTER_EDGE_URL=https://127.0.0.1:${SERVE_PORT} npm run dev -- --host 0.0.0.0
  what Sender received:                  curl -s http://127.0.0.1:${controlPort}/requests
  make Sender answer differently:        curl -s -X POST http://127.0.0.1:${controlPort}/mode/<200|201|401|422|429|500|hang|down|wrong-ca|wrong-name>
  the per-address rate limit applies:    5 quick signups, then 429 for 15s each
`);
    // The timer is what keeps node alive; a bare pending promise does not.
    const alive = setInterval(() => {}, 1 << 30);
    await new Promise((resolveStop) => { process.on('SIGINT', resolveStop); process.on('SIGTERM', resolveStop); });
    clearInterval(alive);
    return;
  }

  await scenarios({ fake, secrets });
  console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
}

try {
  await main();
} catch (err) {
  failed++;
  console.error(err.stack || err);
} finally {
  cleanup();
}
if (failed) {
  console.log(SERVE ? 'NEWSLETTER EDGE STACK FAILED TO START' : 'NEWSLETTER EDGE TESTS FAILED');
  process.exit(1);
}
if (!SERVE) console.log('ALL NEWSLETTER EDGE TESTS PASSED');
