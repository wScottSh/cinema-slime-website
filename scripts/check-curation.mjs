// Read-only verification that the LIVE curation list on the relays matches the
// ESSAYS/NAMES currently in publish-curation.mjs.
//
// This NEVER publishes and needs no secret key — it only reads public events
// under BRAND_PUBKEY. Run it after publishing to confirm the broadcast landed.
//
// Run: node scripts/check-curation.mjs   (or `npm run check:curation`)
import { SimplePool } from 'nostr-tools/pool';
import { BRAND_PUBKEY, CURATION_LIST_KIND, CURATION_LIST_IDENTIFIER } from '../src/brand.js';
import { getLatestCurationList } from '../src/essay-curation.js';
import { ESSAYS, NAMES, RELAYS, toHexPubkey } from './publish-curation.mjs';

const PLACEHOLDER = '0'.repeat(64);

async function main() {
  if (BRAND_PUBKEY === PLACEHOLDER) {
    console.error('BRAND_PUBKEY in src/brand.js is still the all-zeros placeholder.');
    console.error('The site is fail-closed and no list is fetched. Nothing to verify.');
    process.exit(1);
  }

  console.log(`Brand pubkey: ${BRAND_PUBKEY}`);
  console.log(`Expecting:    ${ESSAYS.length} Essay(s), ${NAMES.length} name(s) (from publish-curation.mjs)`);
  console.log(`\nReading the live curation list from relays...`);

  const pool = new SimplePool();
  const events = await pool.querySync(
    RELAYS,
    { kinds: [CURATION_LIST_KIND], authors: [BRAND_PUBKEY], '#d': [CURATION_LIST_IDENTIFIER] },
    { maxWait: 8000 },
  );
  pool.close(RELAYS);

  if (events.length === 0) {
    console.error('\n❌ No curation list found on the relays for this brand pubkey.');
    console.error('   The publish may not have landed, or relays are still indexing — retry shortly.');
    process.exit(1);
  }

  const live = getLatestCurationList(events);
  const liveCoords = live.coordinates;
  const liveNames = live.names;

  const expectedCoords = new Set(ESSAYS.map((e) => e.coordinate));
  const expectedNames = new Map(NAMES.map(({ pubkey, name }) => [toHexPubkey(pubkey), name]));

  const missingCoords = [...expectedCoords].filter((c) => !liveCoords.has(c));
  const extraCoords = [...liveCoords].filter((c) => !expectedCoords.has(c));
  const nameMismatches = [...expectedNames].filter(([pk, name]) => liveNames.get(pk) !== name);

  const checks = [
    [`Essay coordinates match (${liveCoords.size} live)`, missingCoords.length === 0 && extraCoords.length === 0],
    [`Author names match (${liveNames.size} live)`, nameMismatches.length === 0],
  ];

  console.log('\nResults:');
  let pass = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${label}`);
    if (!ok) pass = false;
  }

  if (missingCoords.length) console.log(`\n  Missing from live list (expected, not found):\n    ${missingCoords.join('\n    ')}`);
  if (extraCoords.length) console.log(`\n  Extra on live list (found, not expected):\n    ${extraCoords.join('\n    ')}`);
  if (nameMismatches.length) {
    console.log('\n  Name mismatches (pubkey → expected vs live):');
    for (const [pk, name] of nameMismatches) console.log(`    ${pk} → "${name}" vs "${liveNames.get(pk) ?? '(none)'}"`);
  }

  console.log(`\n${pass ? '✅ LIVE LIST MATCHES — broadcast confirmed.' : '❌ MISMATCH — see above. If you just published, relays may still be indexing; retry shortly.'}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Check errored:', err.message);
  process.exit(2);
});
