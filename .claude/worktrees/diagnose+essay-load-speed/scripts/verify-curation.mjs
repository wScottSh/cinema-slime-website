// End-to-end verification for issue #29 (curated Essays via Nostr).
//
// Publishes, under a DISPOSABLE ephemeral key, to public relays:
//   1. an official Essay        (kind:30023) — listed on the curation list
//   2. an "other writing" Essay (kind:30023) — NOT on the curation list
//   3. the brand curation list  (kind:30001) — names the brand + lists #1 only
//
// Then reads them back off the relays and runs the real wire events through the
// project's pure modules (parseLongFormEvent / getLatestByCoordinate /
// getLatestCurationList / selectCuratedEssay) to prove the official gate:
//   - the curated Essay resolves as official, with the brand-approved name
//   - the non-curated Essay is rejected (null)
//
// Run: node scripts/verify-curation.mjs
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { getLatestByCoordinate } from '../src/essay-data.js';
import { getLatestCurationList, selectCuratedEssay } from '../src/essay-curation.js';
import { CURATION_LIST_KIND, CURATION_LIST_IDENTIFIER } from '../src/brand.js';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const BRAND_NAME = 'Cinema Slime Test Brand';

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const now = Math.floor(Date.now() / 1000);

const officialD = `cs-test-official-${now}`;
const otherD = `cs-test-other-${now}`;
const officialCoord = `30023:${pubkey}:${officialD}`;
const otherCoord = `30023:${pubkey}:${otherD}`;

const officialEssay = finalizeEvent({
  kind: 30023, created_at: now,
  tags: [['d', officialD], ['title', 'An Official Cinema Slime Essay'], ['published_at', String(now)]],
  content: 'This Essay is on the curation list. It should render as official.',
}, sk);

const otherEssay = finalizeEvent({
  kind: 30023, created_at: now,
  tags: [['d', otherD], ['title', "The Author's Other Writing"], ['published_at', String(now)]],
  content: 'This long-form post is NOT on the curation list. It must be gated out.',
}, sk);

const curationList = finalizeEvent({
  kind: CURATION_LIST_KIND, created_at: now,
  tags: [
    ['d', CURATION_LIST_IDENTIFIER],
    ['a', officialCoord],          // only the official Essay is curated
    ['p', pubkey, '', BRAND_NAME], // brand-approved display name
  ],
  content: '',
}, sk);

const pool = new SimplePool();

async function publish(event, label) {
  const results = await Promise.allSettled(pool.publish(RELAYS, event));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`  published ${label} (${event.kind}) → ${ok}/${RELAYS.length} relays accepted`);
  if (ok === 0) throw new Error(`No relay accepted ${label}`);
}

async function main() {
  console.log(`\nDisposable test pubkey:\n  ${pubkey}\n`);
  console.log('Publishing test events...');
  await publish(officialEssay, 'official Essay');
  await publish(otherEssay, 'other Essay');
  await publish(curationList, 'curation list');

  // Give relays a moment to index, then read everything back.
  await new Promise((r) => setTimeout(r, 2500));
  console.log('\nReading back from relays...');

  const listEvents = await pool.querySync(RELAYS, {
    kinds: [CURATION_LIST_KIND], authors: [pubkey], '#d': [CURATION_LIST_IDENTIFIER],
  }, { maxWait: 6000 });
  const essayEvents = await pool.querySync(RELAYS, {
    kinds: [30023], authors: [pubkey], '#d': [officialD, otherD],
  }, { maxWait: 6000 });
  pool.close(RELAYS);

  const curation = getLatestCurationList(listEvents);
  const essays = getLatestByCoordinate(essayEvents);
  const official = essays.find((e) => e.coordinateString === officialCoord);
  const other = essays.find((e) => e.coordinateString === otherCoord);

  console.log(`  curation coordinates: ${[...curation.coordinates].length}, names: ${[...curation.names].length}`);
  console.log(`  fetched essays: ${essays.length}`);

  const gatedOfficial = selectCuratedEssay(official, curation);
  const gatedOther = selectCuratedEssay(other, curation);

  const checks = [
    ['curation list read back', curation.coordinates.has(officialCoord)],
    ['curated Essay resolves as official', !!gatedOfficial],
    ['official Essay carries brand name', gatedOfficial?.authorName === BRAND_NAME],
    ['non-curated Essay was fetched', !!other],
    ['non-curated Essay is gated out (null)', gatedOther === null],
  ];

  console.log('\nResults:');
  let pass = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${label}`);
    if (!ok) pass = false;
  }
  console.log(`\n${pass ? '✅ END-TO-END PASS' : '❌ END-TO-END FAIL'}\n`);

  // Handy for a manual browser check: point BRAND_PUBKEY at this disposable key
  // and open the deep-links below.
  console.log('To eyeball it in a browser, temporarily set in src/brand.js:');
  console.log(`  export const BRAND_PUBKEY = '${pubkey}';`);
  console.log('Then open:');
  console.log(`  official  → #/essay/${encodeURIComponent(officialCoord)}`);
  console.log(`  not-official → #/essay/${encodeURIComponent(otherCoord)}\n`);

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Verification errored:', err.message);
  pool.close(RELAYS);
  process.exit(2);
});
