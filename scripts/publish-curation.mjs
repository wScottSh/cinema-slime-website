// Publish (or update) the Cinema Slime official curation list.
//
// ─── HOW TO USE ───────────────────────────────────────────────────────────────
// 1. Edit ESSAYS and NAMES below.
// 2. Run:
//      BRAND_SECRET_KEY=<64-char-hex-key> node scripts/publish-curation.mjs
//
//    Without BRAND_SECRET_KEY a throwaway ephemeral key is generated so you can
//    verify the end-to-end flow without touching the production list.
//
// See docs/curation-workflow.md for the full playbook.
// ─────────────────────────────────────────────────────────────────────────────

import { pathToFileURL } from 'node:url';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { CURATION_LIST_KIND, CURATION_LIST_IDENTIFIER } from '../src/brand.js';
import { parseCurationList } from '../src/essay-curation.js';

// ─── EDIT THIS SECTION ────────────────────────────────────────────────────────
// Each entry is a curated Essay coordinate: "30023:<author_pubkey>:<identifier>"
// Add a line to include an Essay; remove a line to remove it.
export const ESSAYS = [
  '30023:b7274d28e3e983bf720db4b4a12a31f5c7ef262320d05c25ec90489ac99628cb:Is-Nostr-Actually-Censorship-Resistant-5blu76',
];

// Each entry maps an author pubkey to the display name shown on the site.
// The brand controls these names — they do not have to match the author's
// own Nostr profile.
export const NAMES = [
  { pubkey: 'b7274d28e3e983bf720db4b4a12a31f5c7ef262320d05c25ec90489ac99628cb', name: 'Testy' },
];

export const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const keyHex = process.env.BRAND_SECRET_KEY;
  let sk;
  let testMode = false;

  if (keyHex) {
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      console.error('BRAND_SECRET_KEY must be a 64-character hex string.');
      process.exit(1);
    }
    sk = Uint8Array.from(Buffer.from(keyHex, 'hex'));
  } else {
    sk = generateSecretKey();
    testMode = true;
    console.log('No BRAND_SECRET_KEY set — using a disposable ephemeral key (test mode).');
    console.log('To publish for real, set BRAND_SECRET_KEY to the brand\'s hex secret key.\n');
  }

  const pubkey = getPublicKey(sk);
  const now = Math.floor(Date.now() / 1000);

  const tags = [
    ['d', CURATION_LIST_IDENTIFIER],
    ...ESSAYS.map((coord) => ['a', coord]),
    ...NAMES.map(({ pubkey: pk, name }) => ['p', pk, '', name]),
  ];

  const event = finalizeEvent({ kind: CURATION_LIST_KIND, created_at: now, tags, content: '' }, sk);

  console.log(`Pubkey:        ${pubkey}`);
  console.log(`Essays:        ${ESSAYS.length}`);
  console.log(`Named authors: ${NAMES.length}`);
  console.log(`\nPublishing to relays...`);

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(RELAYS, event));

  const accepted = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`Accepted by ${accepted}/${RELAYS.length} relays.`);

  if (accepted === 0) {
    console.error('No relay accepted the event. Check your network connection.');
    pool.close(RELAYS);
    process.exit(1);
  }

  // Read back to verify the list landed correctly.
  await new Promise((r) => setTimeout(r, 2500));
  const events = await pool.querySync(
    RELAYS,
    { kinds: [CURATION_LIST_KIND], authors: [pubkey], '#d': [CURATION_LIST_IDENTIFIER] },
    { maxWait: 6000 },
  );
  pool.close(RELAYS);

  const curation = parseCurationList(events[0]);
  const verified = curation.coordinates.size === ESSAYS.length;
  console.log(`\nVerification: ${curation.coordinates.size} coordinate(s), ${curation.names.size} name(s) on relay.`);
  console.log(verified ? '✅ List verified.' : '⚠️  Coordinate count mismatch — relay may still be indexing.');

  if (testMode) {
    console.log('\nTo test in the browser, temporarily set in src/brand.js:');
    console.log(`  export const BRAND_PUBKEY = '${pubkey}';`);
    if (ESSAYS.length > 0) {
      console.log('Then open any curated Essay via its #/essay/<coordinate> deep-link.');
    }
  }
}

// Only publish when run directly (e.g. `npm run publish:curation`), so that
// other scripts can import ESSAYS/NAMES/RELAYS without triggering a publish.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(2);
  });
}
