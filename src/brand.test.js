import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARANTEE_RELAY,
  GUARANTEE_RELAY_PLACEHOLDER,
  BRAND_RELAYS,
  WRITER_RELAYS,
  READER_RELAYS,
  BRAND_PUBKEY,
  CURATION_LIST_KIND,
  CURATION_LIST_IDENTIFIER,
  curationListFilter,
  __testables,
} from './brand.js';
import { DEFAULT_RELAYS as SITE_READER_RELAYS } from './nostr-pool.js';
import { RELAYS as PUBLISH_SCRIPT_RELAYS } from '../scripts/publish-curation.mjs';

const { withGuaranteeRelay } = __testables;

// ─── The brand-controlled guarantee relay (#161) ───────────────────────────
//
// The guarantee relay is the durable presence anchor behind Guaranteed
// Presence: unlike every public relay in these sets, it's one the brand
// itself controls, so an Official Essay stays openable even if every public
// relay drops it. It only does that job once it's actually a member of BOTH
// relay sets — a brand relay nobody writes to, or nobody reads from, isn't a
// guarantee at all. But an un-provisioned placeholder is not a real relay
// either (it never resolves, never sends EOSE), so it must NOT appear in
// either set until the human-only provisioning wizard
// (scripts/provision-guarantee-relay.ps1) has replaced it with a real URL.

test('GUARANTEE_RELAY is a non-empty wss:// URL', () => {
  assert.equal(typeof GUARANTEE_RELAY, 'string');
  assert.match(GUARANTEE_RELAY, /^wss:\/\/\S+$/);
});

test('withGuaranteeRelay excludes the placeholder from the built set', () => {
  const base = ['wss://a.test', 'wss://b.test'];
  assert.deepEqual(withGuaranteeRelay(base, GUARANTEE_RELAY_PLACEHOLDER), base);
});

test('withGuaranteeRelay includes a real (non-placeholder) guarantee relay', () => {
  const base = ['wss://a.test', 'wss://b.test'];
  const real = 'wss://relay.cinemaslime.com';
  assert.deepEqual(withGuaranteeRelay(base, real), [...base, real]);
});

test('withGuaranteeRelay does not duplicate a guarantee relay already in the public list', () => {
  const base = ['wss://a.test', 'wss://relay.cinemaslime.com'];
  const real = 'wss://relay.cinemaslime.com';
  assert.deepEqual(withGuaranteeRelay(base, real), base);
});

test('withGuaranteeRelay never mutates the input array', () => {
  const base = ['wss://a.test'];
  withGuaranteeRelay(base, 'wss://relay.cinemaslime.com');
  assert.deepEqual(base, ['wss://a.test']);
});

// Pins the CURRENT, honest state: as long as GUARANTEE_RELAY is still the
// placeholder, neither exported relay set should contain it. Once the
// wizard has run for real and GUARANTEE_RELAY holds a live URL, this test
// keeps passing unchanged — withGuaranteeRelay's own tests above cover the
// "provisioned" branch, so nothing here needs to be revisited when that day
// comes.
test('an un-provisioned GUARANTEE_RELAY never appears in WRITER_RELAYS/READER_RELAYS', () => {
  if (GUARANTEE_RELAY === GUARANTEE_RELAY_PLACEHOLDER) {
    assert.ok(!WRITER_RELAYS.includes(GUARANTEE_RELAY_PLACEHOLDER));
    assert.ok(!READER_RELAYS.includes(GUARANTEE_RELAY_PLACEHOLDER));
  } else {
    assert.ok(WRITER_RELAYS.includes(GUARANTEE_RELAY), 'WRITER_RELAYS must mirror every capture to a provisioned guarantee relay');
    assert.ok(READER_RELAYS.includes(GUARANTEE_RELAY), 'READER_RELAYS must read back from a provisioned guarantee relay');
  }
});

test('WRITER_RELAYS and READER_RELAYS have no duplicate entries', () => {
  assert.equal(new Set(WRITER_RELAYS).size, WRITER_RELAYS.length);
  assert.equal(new Set(READER_RELAYS).size, READER_RELAYS.length);
});

test('every relay in WRITER_RELAYS/READER_RELAYS is a non-empty wss:// URL', () => {
  for (const relay of [...WRITER_RELAYS, ...READER_RELAYS]) {
    assert.equal(typeof relay, 'string');
    assert.match(relay, /^wss:\/\/\S+$/);
  }
});

// ─── One brand relay set (#168) ─────────────────────────────────────────────
//
// The site reader (src/nostr-pool.js, src/production-vault.js), the Curation
// publish script (scripts/publish-curation.mjs), and the Curation check
// (scripts/check-curation.mjs) all draw their relays from this one set now —
// WRITER_RELAYS and READER_RELAYS are no longer two lists that can drift
// apart, they are the SAME list. This test is the guard against that drift
// ever silently returning.

test('WRITER_RELAYS and READER_RELAYS are the same brand relay set', () => {
  assert.deepEqual(WRITER_RELAYS, READER_RELAYS);
  assert.deepEqual(WRITER_RELAYS, BRAND_RELAYS);
  assert.deepEqual(READER_RELAYS, BRAND_RELAYS);
});

// The check above only proves the three brand.js exports agree with each
// other — they're literally the same array reference today, so that alone
// can't catch one of the three CONSUMERS drifting back onto its own list
// (e.g. scripts/publish-curation.mjs hardcoding RELAYS again). This asserts
// against what the site reader (src/nostr-pool.js) and the Curation publish
// script (scripts/publish-curation.mjs) actually import and export, so it
// fails if either stops drawing from BRAND_RELAYS even if brand.js itself
// still looks unified.
test('the site reader and the Curation publish script draw from the same brand relay set', () => {
  assert.deepEqual(SITE_READER_RELAYS, BRAND_RELAYS);
  assert.deepEqual(PUBLISH_SCRIPT_RELAYS, BRAND_RELAYS);
});

test('curationListFilter selects the brand Curation by default, or a given author', () => {
  assert.deepEqual(curationListFilter(), { kinds: [CURATION_LIST_KIND], authors: [BRAND_PUBKEY], '#d': [CURATION_LIST_IDENTIFIER] });
  assert.deepEqual(curationListFilter('ab'.repeat(32)).authors, ['ab'.repeat(32)]);
});
