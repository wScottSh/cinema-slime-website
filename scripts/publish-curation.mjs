// Publish (or update) the Cinema Slime official curation list.
//
// ─── HOW TO USE ───────────────────────────────────────────────────────────────
// 1. Edit ESSAYS and NAMES below.
// 2. Run:
//      `$env:BRAND_SECRET_KEY="<brand-hex-secret>"; npm run publish:curation; Remove-Item Env:\BRAND_SECRET_KEY`
//
//    Without BRAND_SECRET_KEY a throwaway ephemeral key is generated so you can
//    verify the end-to-end flow without touching the production list.
//
// See docs/curation-workflow.md for the full playbook.
// ─────────────────────────────────────────────────────────────────────────────

import { pathToFileURL } from 'node:url';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';
import { CURATION_LIST_KIND, CURATION_LIST_IDENTIFIER, READER_RELAYS, WRITER_RELAYS } from '../src/brand.js';
import { parseCurationList } from '../src/essay-curation.js';
import { isValidSlug } from '../src/essay-slug.js';
import { createEssayVault } from '../src/essay-vault.js';
import { createFileVaultStore } from '../src/vault-store.js';
import { createRelayPort } from '../src/relay-port.js';

// ─── EDIT THIS SECTION ────────────────────────────────────────────────────────
// Each entry is a curated Essay. `coordinate` is required ("30023:<pubkey>:<id>").
// `slug` is optional — when present it becomes the pretty URL (#/essay/<slug>).
// Slugs must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ and be unique in the list.
export const ESSAYS = [
  {
    coordinate: '30023:36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0:feeling-alive-2007-a-daft-punk-odyssey',
    slug: 'feeling-alive-2007',
  },
  {
    coordinate: '30023:2cfce0fc7e8f5e8e29a42427ed5903b9cd846e33ace7a7ab79f03ce28e3584e6:S03S87cLqOlX6ucZriwM6',
    slug: 'along-went-the-spider',
  },
  {
    coordinate: '30023:2cfce0fc7e8f5e8e29a42427ed5903b9cd846e33ace7a7ab79f03ce28e3584e6:FM4lzdDT9cSsuak8Nvavn',
    slug: 'tangled-web',
  },
  {
    coordinate: '30023:2cfce0fc7e8f5e8e29a42427ed5903b9cd846e33ace7a7ab79f03ce28e3584e6:oECNN73LYLcWOqWEOfTLi',
    slug: 'following-the-threads',
  },
  {
    coordinate: '30023:36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0:my-own-private-idaho-x-1991',
    slug: 'my-own-private-idaho',
  },
];

// Each entry maps an author pubkey to the display name shown on the site.
// The brand controls these names — they do not have to match the author's
// own Nostr profile. The pubkey may be given as 64-char hex or an npub… string.
export const NAMES = [
  { pubkey: 'npub1kch3wd47xfcvx6aupyv0099led6gw5ercm0al96f2v00ff3slgvqsjevlw', name: 'Scott' },
  { pubkey: 'npub1wtempvjeyecl0cp4zf8sqfw9cypryeqeyaw9s7ccwlty8h2vsqvs3g803l', name: 'Renn' },
  { pubkey: '36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0', name: 'Renn' },
  { pubkey: 'npub19n7wplr73a0gu2dyysn76kgrh8xcgm3n4nn602me7q7w9r34snnqme4rk8', name: 'Harrison' },
];

// The writer relay set is the single source of truth in src/brand.js
// (WRITER_RELAYS) — it now includes the brand's own guarantee relay (#161)
// alongside the public best-effort relays, so it broadcasts here too.
// Re-exported as RELAYS for the other scripts that already import it.
export const RELAYS = WRITER_RELAYS;
// ─────────────────────────────────────────────────────────────────────────────

// Validate all slugs in an ESSAYS manifest before signing.
// Returns { valid: true } or { valid: false, reason: string, slug: string }.
export function validateManifestSlugs(essays) {
  const seen = new Set();
  for (const { slug } of essays) {
    if (slug === undefined || slug === null) continue;
    if (!isValidSlug(slug)) {
      return { valid: false, reason: `Malformed slug: "${slug}"`, slug };
    }
    if (seen.has(slug)) {
      return { valid: false, reason: `Duplicate slug: "${slug}"`, slug };
    }
    seen.add(slug);
  }
  return { valid: true };
}

// Accept either a 64-char hex pubkey or an npub… string and return hex.
export function toHexPubkey(pubkey) {
  if (/^[0-9a-f]{64}$/i.test(pubkey)) return pubkey.toLowerCase();
  if (/^npub1[0-9a-z]+$/.test(pubkey)) {
    const { type, data } = nip19.decode(pubkey);
    if (type !== 'npub') throw new Error(`Expected an npub, got ${type}: ${pubkey}`);
    return data;
  }
  throw new Error(`Invalid pubkey (expected 64-char hex or npub…): ${pubkey}`);
}

// Guaranteed Presence gate for the publish workflow (see CONTEXT.md and #158).
//
// Publishing the kind:30001 Curation list must never declare success while an
// Official Essay's body is unreachable from the relays the site reads — the
// failure mode that silently stranded "My Own Private Idaho" while the old
// workflow only counted pointers, never fetched bodies (#156, #157).
//
// `vault` mirrors every essay's captured body to the writer relays and reads
// it back from the reader relays (EssayVault.ensurePresence — see
// src/essay-vault.js). Only when every coordinate is confirmed readable does
// this call `publishList` — a coordinate with no captured body, or one that
// never round-trips, aborts the whole publish and is named in `missing`
// (aggregated, never just the first). `publishList` is never invoked on
// failure, so a partial vault can never make the Curation list go live.
export async function runPublishWorkflow({ essays, vault, publishList } = {}) {
  if (!Array.isArray(essays)) {
    throw new Error('runPublishWorkflow: essays must be an array of { coordinate }');
  }
  if (!vault || typeof vault.ensurePresence !== 'function') {
    throw new Error('runPublishWorkflow: vault must implement { ensurePresence }');
  }
  if (typeof publishList !== 'function') {
    throw new Error('runPublishWorkflow: publishList must be a function');
  }
  const coordinates = essays.map((essay, index) => {
    if (!essay || typeof essay.coordinate !== 'string' || essay.coordinate === '') {
      throw new Error(`runPublishWorkflow: essays[${index}] has no coordinate`);
    }
    return essay.coordinate;
  });
  const presence = await vault.ensurePresence(coordinates);
  if (!presence.ok) {
    return { published: false, missing: presence.missing, presence };
  }
  const result = await publishList();
  return { published: true, missing: [], presence, result };
}

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

  const slugCheck = validateManifestSlugs(ESSAYS);
  if (!slugCheck.valid) {
    console.error(`Slug validation failed — ${slugCheck.reason}`);
    process.exit(1);
  }

  const pubkey = getPublicKey(sk);
  const now = Math.floor(Date.now() / 1000);

  const tags = [
    ['d', CURATION_LIST_IDENTIFIER],
    ...ESSAYS.map(({ coordinate, slug }) => slug ? ['a', coordinate, '', slug] : ['a', coordinate]),
    ...NAMES.map(({ pubkey: pk, name }) => ['p', toHexPubkey(pk), '', name]),
  ];

  const event = finalizeEvent({ kind: CURATION_LIST_KIND, created_at: now, tags, content: '' }, sk);

  console.log(`Pubkey:        ${pubkey}`);
  console.log(`Essays:        ${ESSAYS.length}`);
  console.log(`Named authors: ${NAMES.length}`);

  // One pool serves both the Guaranteed Presence gate (mirroring each Essay's
  // captured body to the writer relays and reading it back from the reader
  // relays) and, only once every coordinate is confirmed, the Curation list
  // broadcast itself.
  const pool = new SimplePool();
  const closeRelays = [...new Set([...RELAYS, ...READER_RELAYS])];
  const vault = createEssayVault({
    relayPort: createRelayPort(pool),
    store: createFileVaultStore(),
    readerRelays: READER_RELAYS,
    writerRelays: RELAYS,
  });

  console.log('\nConfirming every Official Essay is present on the reader relays before publishing...');

  // The pool holds live WebSocket connections regardless of how the workflow
  // below ends (gate abort, a rejected publishList, or success) — always
  // close it so a failure never leaves the process hanging on open sockets.
  try {
    const outcome = await runPublishWorkflow({
      essays: ESSAYS,
      vault,
      publishList: async () => {
        console.log('\nPublishing to relays...');
        const results = await Promise.allSettled(pool.publish(RELAYS, event));
        const accepted = results.filter((r) => r.status === 'fulfilled').length;
        console.log(`Accepted by ${accepted}/${RELAYS.length} relays.`);

        if (accepted === 0) {
          throw new Error('No relay accepted the event. Check your network connection.');
        }

        // Read back to confirm the list itself landed (a diagnostic, not the
        // publish gate — the gate above already guaranteed every Essay body is
        // present; this only confirms the pointer list propagated).
        await new Promise((r) => setTimeout(r, 2500));
        const events = await pool.querySync(
          RELAYS,
          { kinds: [CURATION_LIST_KIND], authors: [pubkey], '#d': [CURATION_LIST_IDENTIFIER] },
          { maxWait: 6000 },
        );
        const curation = parseCurationList(events[0]);
        console.log(`Read back: ${curation.coordinates.size} coordinate(s), ${curation.names.size} name(s) on relay.`);
        return { accepted, curation };
      },
    });

    if (!outcome.published) {
      console.error('\n❌ Publish aborted — the following Official Essay coordinate(s) are not confirmed present on the reader relays:');
      for (const entry of outcome.presence.entries.filter((e) => !e.ok)) {
        console.error(`  - ${entry.coordinate} (${entry.reason})`);
      }
      console.error('\nCapture and mirror these Essays before re-running publish. The Curation list was NOT published.');
      process.exitCode = 1;
      return;
    }

    console.log('\n✅ Every Official Essay body confirmed present. Curation list published.');

    if (testMode) {
      console.log('\nTo test in the browser, temporarily set in src/brand.js:');
      console.log(`  export const BRAND_PUBKEY = '${pubkey}';`);
      if (ESSAYS.length > 0) {
        console.log('Then open any curated Essay via its #/essay/<coordinate> deep-link.');
      }
    }
  } finally {
    pool.close(closeRelays);
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
