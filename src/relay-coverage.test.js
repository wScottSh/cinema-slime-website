import test from 'node:test';
import assert from 'node:assert/strict';
import { runRelayCoverageAudit, MIN_RELAY_COVERAGE } from './relay-coverage.js';

// ─── runRelayCoverageAudit — the shared brand relay coverage rule ──────────
//
// Reports, per brand relay, whether that relay holds the audited thing (the
// live Curation in check:curation, #168; an Official Essay in
// check:coverage, #169), and fails when fewer than `minCoverage` do — the
// check ADR 0014's open question (the Curation was found on only one relay
// during the July outage) asked for. `queryRelay` is injected so this is
// driven deterministically without any real relay I/O (ADR 0002).

test('the brand relay coverage threshold is 2 (#165)', () => {
  assert.equal(MIN_RELAY_COVERAGE, 2);
});

test('runRelayCoverageAudit rejects malformed input before querying anything', async () => {
  await assert.rejects(() => runRelayCoverageAudit({ queryRelay: async () => true }), /relays must be a non-empty array/);
  await assert.rejects(() => runRelayCoverageAudit({ relays: [] }), /relays must be a non-empty array/);
  await assert.rejects(() => runRelayCoverageAudit({ relays: ['wss://a.test'] }), /queryRelay must be a function/);
});

test('runRelayCoverageAudit passes when every relay holds the Curation', async () => {
  const relays = ['wss://a.test', 'wss://b.test', 'wss://c.test'];
  const audit = await runRelayCoverageAudit({ relays, queryRelay: async () => true });

  assert.equal(audit.ok, true);
  assert.equal(audit.coverage, 3);
  assert.deepEqual(
    audit.perRelay,
    relays.map((relay) => ({ relay, present: true })),
  );
});

test('runRelayCoverageAudit fails when fewer than minCoverage relays hold the Curation', async () => {
  const relays = ['wss://a.test', 'wss://b.test', 'wss://c.test'];
  const holders = new Set(['wss://a.test']); // only 1 of 3 — reproduces the July single-relay outage
  const audit = await runRelayCoverageAudit({ relays, queryRelay: async (relay) => holders.has(relay) });

  assert.equal(audit.ok, false);
  assert.equal(audit.coverage, 1);
  assert.deepEqual(audit.perRelay, [
    { relay: 'wss://a.test', present: true },
    { relay: 'wss://b.test', present: false },
    { relay: 'wss://c.test', present: false },
  ]);
});

test('runRelayCoverageAudit passes at exactly minCoverage and respects a custom minCoverage', async () => {
  const relays = ['wss://a.test', 'wss://b.test', 'wss://c.test'];
  const holders = new Set(['wss://a.test', 'wss://b.test']);
  const audit = await runRelayCoverageAudit({ relays, queryRelay: async (relay) => holders.has(relay) });

  assert.equal(audit.ok, true, '2 of 3 meets the default minCoverage of 2');
  assert.equal(audit.coverage, 2);

  const stricter = await runRelayCoverageAudit({ relays, queryRelay: async (relay) => holders.has(relay), minCoverage: 3 });
  assert.equal(stricter.ok, false, '2 of 3 does not meet a minCoverage of 3');
});
