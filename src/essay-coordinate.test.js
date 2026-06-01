import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinate, formatCoordinate } from './essay-coordinate.js';

const PUBKEY = 'a'.repeat(64); // 32-byte pubkey as 64 lowercase hex chars

test('parseCoordinate splits a well-formed kind:pubkey:identifier', () => {
  const c = parseCoordinate(`30023:${PUBKEY}:my-first-essay`);
  assert.deepEqual(c, { kind: 30023, pubkey: PUBKEY, identifier: 'my-first-essay' });
});

test('parseCoordinate rejects malformed input', () => {
  assert.equal(parseCoordinate(''), null);
  assert.equal(parseCoordinate('not-a-coordinate'), null);
  assert.equal(parseCoordinate('30023:onlyonepart'), null); // no second colon
  assert.equal(parseCoordinate(null), null);
  assert.equal(parseCoordinate(undefined), null);
  assert.equal(parseCoordinate(123), null);
});

test('parseCoordinate rejects a non-numeric kind', () => {
  assert.equal(parseCoordinate(`notakind:${PUBKEY}:slug`), null);
  assert.equal(parseCoordinate(`30.5:${PUBKEY}:slug`), null);
});

test('parseCoordinate rejects a pubkey that is not 64 lowercase hex chars', () => {
  assert.equal(parseCoordinate('30023:tooshort:slug'), null);
  assert.equal(parseCoordinate(`30023:${'A'.repeat(64)}:slug`), null); // uppercase
  assert.equal(parseCoordinate(`30023:${'g'.repeat(64)}:slug`), null); // non-hex
});

test('parseCoordinate preserves an identifier containing colons and slashes', () => {
  const c = parseCoordinate(`30023:${PUBKEY}:2026:05:the-slime/files`);
  assert.deepEqual(c, { kind: 30023, pubkey: PUBKEY, identifier: '2026:05:the-slime/files' });
});

test('formatCoordinate round-trips with parseCoordinate', () => {
  const original = `30023:${PUBKEY}:essay-with:colons`;
  const parsed = parseCoordinate(original);
  assert.equal(formatCoordinate(parsed), original);
});

test('formatCoordinate returns null for an invalid coordinate object', () => {
  assert.equal(formatCoordinate(null), null);
  assert.equal(formatCoordinate({}), null);
  assert.equal(formatCoordinate({ kind: 30023, pubkey: 'short', identifier: 'x' }), null);
});
