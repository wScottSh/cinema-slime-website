import test from 'node:test';
import assert from 'node:assert/strict';
import { nip19 } from 'nostr-tools';
import { buildNostrClientUrl } from './nostr-links.js';

const PUBKEY = 'a'.repeat(64);

// Regression for #71: njump.me 404s on raw kind:pubkey:d coordinates (encoded
// or not). The client link must be the NIP-19 naddr form. This exact URL was
// verified live (HTTP 200) against the published essay.
test('buildNostrClientUrl produces the live-verified naddr URL, not the raw coordinate', () => {
  const coordinate = '30023:36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0:feeling-alive-2007-a-daft-punk-odyssey';
  const url = buildNostrClientUrl(coordinate);
  assert.equal(
    url,
    'https://njump.me/naddr1qvzqqqr4gupzqd3zpt80gqwkrtucq49kdyck4sqyttwp9errucv2w2tlgzv0lj7sqqnxvet9d35kueedv9kxjan995erqvph94sj6erpve6z6ur4de4j6mmy09ehxete60tty3',
  );
  assert.ok(!url.includes('%3A'), 'must not contain a percent-encoded coordinate');
});

test('buildNostrClientUrl encodes an identifier containing colons and slashes (round-trip via nip19)', () => {
  const url = buildNostrClientUrl(`30023:${PUBKEY}:2026:05/the-slime`);
  const naddr = url.replace('https://njump.me/', '');
  const decoded = nip19.decode(naddr);
  assert.equal(decoded.type, 'naddr');
  assert.deepEqual(
    { kind: decoded.data.kind, pubkey: decoded.data.pubkey, identifier: decoded.data.identifier },
    { kind: 30023, pubkey: PUBKEY, identifier: '2026:05/the-slime' },
  );
});

test('buildNostrClientUrl returns null for an unparseable coordinate', () => {
  assert.equal(buildNostrClientUrl('not-a-coordinate'), null);
  assert.equal(buildNostrClientUrl(''), null);
  assert.equal(buildNostrClientUrl(null), null);
});
