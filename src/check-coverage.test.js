import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPerRelayCoordinates, runEssayCoverageAudit } from '../scripts/check-coverage.mjs';

// ─── collectPerRelayCoordinates — one query per relay for ALL curated ─────
// Essays together (#169's "gentle probe volume": one connection per relay,
// not one per Essay). Builds a Map<relay, Set<"kind:pubkey:d">> from whatever
// raw events each relay's single query returns.

test('collectPerRelayCoordinates rejects malformed input before querying anything', async () => {
  await assert.rejects(
    () => collectPerRelayCoordinates({ authors: ['a'], identifiers: ['d'], queryRelay: async () => [] }),
    /relays must be a non-empty array/,
  );
  await assert.rejects(
    () => collectPerRelayCoordinates({ relays: ['wss://a.test'], identifiers: ['d'], queryRelay: async () => [] }),
    /authors must be a non-empty array/,
  );
  await assert.rejects(
    () => collectPerRelayCoordinates({ relays: ['wss://a.test'], authors: ['a'], queryRelay: async () => [] }),
    /identifiers must be a non-empty array/,
  );
  await assert.rejects(
    () => collectPerRelayCoordinates({ relays: ['wss://a.test'], authors: ['a'], identifiers: ['d'] }),
    /queryRelay must be a function/,
  );
});

test('collectPerRelayCoordinates queries each relay exactly once, forwarding authors AND the curated d-identifiers', async () => {
  const relays = ['wss://a.test', 'wss://b.test'];
  const calls = [];
  await collectPerRelayCoordinates({
    relays,
    authors: ['pk1', 'pk2', 'pk3'],
    identifiers: ['essay-1', 'essay-2'],
    queryRelay: async (relay, authors, identifiers) => {
      calls.push({ relay, authors, identifiers });
      return [];
    },
  });

  assert.equal(calls.length, relays.length, 'exactly one query per relay');
  for (const call of calls) {
    assert.deepEqual(call.authors, ['pk1', 'pk2', 'pk3']);
    assert.deepEqual(call.identifiers, ['essay-1', 'essay-2'], 'the d-identifier filter must reach queryRelay, not just live in a comment');
  }
});

test('collectPerRelayCoordinates builds a coordinate set per relay from returned events, ignoring other kinds', async () => {
  const pk1 = 'a'.repeat(64);
  const pk2 = 'b'.repeat(64);
  const events = {
    'wss://a.test': [
      { kind: 30023, pubkey: pk1, tags: [['d', 'essay-1']] },
      { kind: 30023, pubkey: pk2, tags: [['d', 'essay-2']] },
      { kind: 1, pubkey: pk1, tags: [['d', 'not-an-essay']] }, // wrong kind — must be ignored
      { kind: 30023, pubkey: pk1, tags: [] }, // no d tag — must be ignored
      { kind: 30023, pubkey: 'not-hex', tags: [['d', 'malformed-pubkey']] }, // malformed pubkey — must be ignored
    ],
    'wss://b.test': [{ kind: 30023, pubkey: pk1, tags: [['d', 'essay-1']] }],
  };

  const result = await collectPerRelayCoordinates({
    relays: ['wss://a.test', 'wss://b.test'],
    authors: [pk1, pk2],
    identifiers: ['essay-1', 'essay-2'],
    queryRelay: async (relay) => events[relay] ?? [],
  });

  assert.deepEqual(result.get('wss://a.test'), new Set([`30023:${pk1}:essay-1`, `30023:${pk2}:essay-2`]));
  assert.deepEqual(result.get('wss://b.test'), new Set([`30023:${pk1}:essay-1`]));
});

// ─── runEssayCoverageAudit — per-Essay relay coverage (#169) ───────────────
//
// Reports, per curated coordinate, how many brand relays hold it and names
// the relays, failing (ok: false) when any Essay is under minCoverage — reuses
// the SAME coverage rule (src/relay-coverage.js) as the Curation check (#168) so "count present
// relays, fail below minCoverage" is one rule everywhere.

test('runEssayCoverageAudit rejects malformed input', () => {
  assert.throws(
    () => runEssayCoverageAudit({ relays: ['wss://a.test'], perRelayCoordinates: new Map() }),
    /coordinates must be an array/,
  );
  assert.throws(
    () => runEssayCoverageAudit({ coordinates: [], relays: ['wss://a.test'], perRelayCoordinates: {} }),
    /perRelayCoordinates must be a Map/,
  );
});

test('runEssayCoverageAudit passes when every Essay is held by at least minCoverage relays', async () => {
  const coordinates = ['30023:pk1:essay-1', '30023:pk2:essay-2'];
  const relays = ['wss://a.test', 'wss://b.test', 'wss://c.test'];
  const perRelayCoordinates = new Map([
    ['wss://a.test', new Set(coordinates)],
    ['wss://b.test', new Set(coordinates)],
    ['wss://c.test', new Set()],
  ]);

  const audit = runEssayCoverageAudit({ coordinates, relays, perRelayCoordinates });

  assert.equal(audit.ok, true);
  assert.equal(audit.entries.length, 2);
  for (const entry of audit.entries) {
    assert.equal(entry.ok, true);
    assert.equal(entry.coverage, 2);
    assert.deepEqual(new Set(entry.holders), new Set(['wss://a.test', 'wss://b.test']));
  }
});

test('runEssayCoverageAudit fails and names the under-covered Essay by coordinate, reproducing "Betrayal" (0 relays)', async () => {
  const wellCovered = '30023:pk1:essay-1';
  const betrayal = '30023:pk2:betrayal';
  const coordinates = [wellCovered, betrayal];
  const relays = ['wss://a.test', 'wss://b.test', 'wss://c.test'];
  const perRelayCoordinates = new Map([
    ['wss://a.test', new Set([wellCovered])],
    ['wss://b.test', new Set([wellCovered])],
    ['wss://c.test', new Set([wellCovered])],
    // betrayal absent from every probed relay — not found anywhere
  ]);

  const audit = runEssayCoverageAudit({ coordinates, relays, perRelayCoordinates });

  assert.equal(audit.ok, false);
  const byCoord = new Map(audit.entries.map((e) => [e.coordinate, e]));
  assert.equal(byCoord.get(wellCovered).ok, true);
  assert.equal(byCoord.get(betrayal).ok, false);
  assert.equal(byCoord.get(betrayal).coverage, 0);
  assert.deepEqual(byCoord.get(betrayal).holders, []);
});

test('runEssayCoverageAudit reports every failing Essay independently, not just the first', async () => {
  const coordinates = ['30023:pk1:a', '30023:pk1:b', '30023:pk1:c'];
  const relays = ['wss://a.test', 'wss://b.test'];
  const perRelayCoordinates = new Map([
    ['wss://a.test', new Set(['30023:pk1:a'])], // held by 1
    ['wss://b.test', new Set()], // b and c held nowhere
  ]);

  const audit = runEssayCoverageAudit({ coordinates, relays, perRelayCoordinates });

  assert.equal(audit.ok, false);
  const failing = audit.entries.filter((e) => !e.ok).map((e) => e.coordinate);
  assert.deepEqual(new Set(failing), new Set(coordinates), 'all 3 are under the default minCoverage of 2');
});

test('runEssayCoverageAudit passes at exactly minCoverage and respects a custom minCoverage', async () => {
  const coordinate = '30023:pk1:essay-1';
  const relays = ['wss://a.test', 'wss://b.test', 'wss://c.test'];
  const perRelayCoordinates = new Map([
    ['wss://a.test', new Set([coordinate])],
    ['wss://b.test', new Set([coordinate])],
    ['wss://c.test', new Set()],
  ]);

  const audit = runEssayCoverageAudit({ coordinates: [coordinate], relays, perRelayCoordinates });
  assert.equal(audit.ok, true, '2 of 3 meets the default minCoverage of 2');

  const stricter = runEssayCoverageAudit({ coordinates: [coordinate], relays, perRelayCoordinates, minCoverage: 3 });
  assert.equal(stricter.ok, false, '2 of 3 does not meet a minCoverage of 3');
});
