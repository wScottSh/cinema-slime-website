// Starts a podcast Episode in the cs-pod-editor from a Craig recording
// (ADR 0023). The editor runs on Unicron and is reached only over the cspod
// WireGuard tunnel; it answers once, and posts everything after that to the
// channel itself.
//
//   createIntake({ url, certSha256, secret }).run(command, mention) -> Outcome
//
// The editor's certificate is self-signed and names no host, so it is pinned
// by SHA-256 fingerprint in place of CA and hostname checks. Nothing, not even
// the request line, is written until the pin matches.
import { request } from 'node:http';
import { isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export const INTAKE_TIMEOUT_MS = 20_000;
const BODY_MAX = 64 * 1024;

// Craig's own codes, passed through by the editor in a 422.
const CRAIG_REFUSALS = {
  invalid_key: 'craig-invalid-key',
  no_rec: 'craig-no-rec',
  recording_deleted: 'craig-recording-deleted',
  rec_no_data: 'craig-rec-no-data',
  invalid_rec: 'craig-invalid-rec',
};

// `37:B7:...` or `37b7...` to the colon form getPeerCertificate() reports.
export function normalizeFingerprint(text) {
  const hex = String(text ?? '').replace(/:/g, '').toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? hex.match(/../g).join(':') : null;
}

function settingsFrom({ url, certSha256, secret } = {}) {
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    return null;
  }
  const pin = normalizeFingerprint(certSha256);
  return endpoint.protocol === 'https:' && pin && secret ? { endpoint, pin, secret } : null;
}

class IntakeFailure extends Error {
  constructor(step, detail) {
    super(detail);
    this.step = step;
  }
}

// One POST over a socket whose certificate already matched the pin.
function post({ endpoint, pin, secret }, body, timeoutMs) {
  const host = endpoint.hostname.replace(/^\[|\]$/g, '');
  const port = Number(endpoint.port || 443);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    const fail = (step, detail) => finish(reject, new IntakeFailure(step, detail));
    const socket = tlsConnect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false });
    const timer = setTimeout(() => fail('editor', `no answer within ${timeoutMs / 1000}s`), timeoutMs);
    socket.on('error', (err) => fail('editor', err.code ?? err.message));
    socket.once('secureConnect', () => {
      const seen = socket.getPeerCertificate()?.fingerprint256;
      if (seen !== pin) return fail('editor-cert', `certificate ${seen ?? 'missing'}`);
      const req = request({
        createConnection: () => socket,
        method: 'POST',
        path: `${endpoint.pathname}${endpoint.search}`,
        headers: {
          host: endpoint.host,
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      });
      req.on('error', (err) => fail('editor', err.code ?? err.message));
      req.on('response', (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
          if (text.length > BODY_MAX) fail('editor-response', `HTTP ${res.statusCode} body over ${BODY_MAX} bytes`);
        });
        res.on('end', () => finish(resolve, { status: res.statusCode, text }));
        res.on('error', (err) => fail('editor', err.message));
      });
      req.end(payload);
    });
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The editor's answer, read once against the contract. Anything off-contract
// is editor-response, so no reply claims more than the editor said.
function outcomeOf({ status, text }, title) {
  const body = parseJson(text) ?? {};
  if (status === 200 || status === 201) {
    if (typeof body.episodeId !== 'string' || !/^https:\/\//.test(body.url ?? '')) {
      return { kind: 'failed', step: 'editor-response', detail: `HTTP ${status} without an episodeId and url` };
    }
    const outcome = { kind: 'episode', change: status === 201 ? 'created' : 'exists', episodeId: body.episodeId, url: body.url };
    if (title) outcome.title = title;
    return outcome;
  }
  if (status === 401) return { kind: 'failed', step: 'editor-auth' };
  if (status === 422 && typeof body.code === 'string') {
    if (body.code === 'craig_unreachable') return { kind: 'failed', step: 'craig' };
    return CRAIG_REFUSALS[body.code]
      ? { kind: 'refused', reason: CRAIG_REFUSALS[body.code] }
      : { kind: 'refused', reason: 'craig-other', code: body.code };
  }
  if (status >= 500) return { kind: 'failed', step: 'editor', detail: `HTTP ${status}` };
  return { kind: 'failed', step: 'editor-response', detail: `HTTP ${status}${body.error ? `: ${body.error}` : ''}` };
}

// Without a URL, a pin and a secret every intake gets the intake-off reply,
// and the Curator is unaffected.
export function createIntake(config, { timeoutMs = INTAKE_TIMEOUT_MS } = {}) {
  const settings = settingsFrom(config);
  return {
    configured: Boolean(settings),
    async run(command, mention) {
      if (!settings) return { kind: 'failed', step: 'intake-off' };
      const body = {
        craig: { id: command.craig.id, key: command.craig.key },
        discord: { guildId: mention.guildId, channelId: mention.channelId, messageId: mention.messageId, authorId: mention.authorId },
      };
      if (command.title) body.title = command.title;
      try {
        return outcomeOf(await post(settings, body, timeoutMs), command.title);
      } catch (err) {
        if (err instanceof IntakeFailure) return { kind: 'failed', step: err.step, detail: err.message };
        throw err;
      }
    },
  };
}
