// Runs scripts/setup-sender.sh end to end with its answers on stdin and stub
// `curl`, `gh` and `xdg-open` first on PATH, so nothing leaves this machine.
// The curl stub plays Sender: it answers GET /v2/groups and every
// POST /v2/subscribers, and logs each call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./setup-sender.sh', import.meta.url));
const TOKEN = 'tok.abc|42';

const CURL_STUB = `#!/usr/bin/env bash
cat > /dev/null
out='' write='' method=GET url=''
while (( $# )); do
  case "$1" in
    -o) out="$2"; shift ;;
    -w) write="$2"; shift ;;
    -X) method="$2"; shift ;;
    -s|-K) [[ "$1" == -K ]] && shift ;;
    *) url="$1" ;;
  esac
  shift
done
echo "$method $url" >> "$STUB_LOG"
case "$method $url" in
  "GET "*/groups) code=200; body='{"data":[{"id":"eZVD4w","title":"Website signups"}]}' ;;
  "POST "*/subscribers) code=201; body='{"data":{"id":"s1","email":"me@example.com","status":{"email":"active"}}}' ;;
  *) code=404; body='{}' ;;
esac
[[ "$out" == /dev/null ]] || printf '%s' "$body"
write="\${write//\\\\n/$'\\n'}"
printf '%s' "\${write//%\\{http_code\\}/$code}"
`;

const GH_STUB = `#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "secret set") printf '%s=%s\\n' "$3" "$(cat)" >> "$STUB_LOG" ;;
  *) exit 1 ;;
esac
`;

function runWizard(answers) {
  const dir = mkdtempSync(join(tmpdir(), 'setup-sender-test-'));
  try {
    for (const [name, body] of [['curl', CURL_STUB], ['gh', GH_STUB], ['xdg-open', '#!/bin/sh\n']]) {
      writeFileSync(join(dir, name), body);
      chmodSync(join(dir, name), 0o755);
    }
    const log = join(dir, 'calls.log');
    writeFileSync(log, '');
    const r = spawnSync('bash', [SCRIPT], {
      input: answers.join('\n') + '\n',
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_LOG: log },
      timeout: 30000,
    });
    return { status: r.status, out: r.stdout + r.stderr, calls: readFileSync(log, 'utf8').trim().split('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// banner, account, domain, token, group, run the smoke?, address, unsubscribed?
const UP_TO_SMOKE = ['', '', '', TOKEN, '1', 'y', 'me@example.com'];

test('after the human unsubscribes, the wizard signs up once more and reports the status and status.email', () => {
  const { status, out, calls } = runWizard([...UP_TO_SMOKE, 'y']);
  assert.equal(status, 0, out);
  assert.equal(calls.filter((c) => c.startsWith('POST ') && c.endsWith('/v2/subscribers')).length, 3, calls.join('\n'));
  assert.match(out, /Signup after unsubscribing: HTTP 201, status\.email: active/);
});

test('the re-subscribe check is skippable', () => {
  const { status, out, calls } = runWizard([...UP_TO_SMOKE, 'n']);
  assert.equal(status, 0, out);
  assert.equal(calls.filter((c) => c.startsWith('POST ')).length, 2, calls.join('\n'));
  assert.doesNotMatch(out, /Signup after unsubscribing/);
});

test('the wizard sets both GitHub secrets, never prints the token, and promises nothing it does not do', () => {
  const { status, out, calls } = runWizard([...UP_TO_SMOKE, 'n']);
  assert.equal(status, 0, out);
  assert.ok(calls.includes(`SENDER_API_TOKEN=${TOKEN}`), calls.join('\n'));
  assert.ok(calls.includes('SENDER_GROUP_ID=eZVD4w'), calls.join('\n'));
  assert.ok(!out.includes(TOKEN));
  assert.doesNotMatch(out, /remembers/);
});
