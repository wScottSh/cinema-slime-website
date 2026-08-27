// Read-only verification that the LIVE curation list on the relays matches the
// ESSAYS/NAMES currently in publish-curation.mjs, AND that every Official
// Essay's body is actually openable from the reader relay set (see #156, #160).
//
// This NEVER publishes and needs no secret key — it only reads public events
// under BRAND_PUBKEY. Run it after publishing to confirm the broadcast landed,
// or any time (including in CI) to catch a Guaranteed Presence regression
// before a visitor hits it.
//
// Run: node scripts/check-curation.mjs   (or `npm run check:curation`)
import { pathToFileURL } from 'node:url';
import { SimplePool } from 'nostr-tools/pool';
import {
  BRAND_PUBKEY,
  CURATION_LIST_KIND,
  CURATION_LIST_IDENTIFIER,
  READER_RELAYS,
  GUARANTEE_RELAY,
  GUARANTEE_RELAY_PLACEHOLDER,
} from '../src/brand.js';
import { getLatestCurationList } from '../src/essay-curation.js';
import { createProductionVault } from '../src/production-vault.js';
import { ESSAYS, NAMES, RELAYS, toHexPubkey, coordinatesFromEssays } from './publish-curation.mjs';

const PLACEHOLDER = '0'.repeat(64);

// The Guaranteed Presence audit (#160): reports each Official Essay as
// "openable" or "unavailable" based on EssayVault.verifyPresence — the
// read-only projection that reads bodies back from the reader relay set and
// NEVER broadcasts (see src/essay-vault.js). An Essay with no captured or
// reachable body is reported unavailable, never silently skipped, because
// verifyPresence's shared read-back core already treats "no stored copy" as
// a failure rather than a skip.
export async function runPresenceAudit({ essays, vault } = {}) {
  const coordinates = coordinatesFromEssays(essays);
  if (!vault || typeof vault.verifyPresence !== 'function') {
    throw new Error('runPresenceAudit: vault must implement { verifyPresence }');
  }
  const presence = await vault.verifyPresence(coordinates);
  const report = presence.entries.map((entry) => ({
    coordinate: entry.coordinate,
    status: entry.ok ? 'openable' : 'unavailable',
    reason: entry.reason,
  }));
  return { ok: presence.ok, report, unavailable: presence.missing };
}

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
  const closeRelays = [...new Set([...RELAYS, ...READER_RELAYS])];

  try {
    const events = await pool.querySync(
      RELAYS,
      { kinds: [CURATION_LIST_KIND], authors: [BRAND_PUBKEY], '#d': [CURATION_LIST_IDENTIFIER] },
      { maxWait: 8000 },
    );

    let pass = true;
    // liveCoords/liveNames default to empty when no curation list was found
    // at all — that is itself a failing pointer check below, but it must
    // never short-circuit the body-reachability audit further down: the
    // manifest's Essays still need to be reported openable/unavailable so an
    // AFK agent or CI sees the full picture in one run, not just the first
    // failure.
    let liveCoords = new Set();
    let liveNames = new Map();

    if (events.length === 0) {
      console.error('\n❌ No curation list found on the relays for this brand pubkey.');
      console.error('   The publish may not have landed, or relays are still indexing — retry shortly.');
      pass = false;
    } else {
      const live = getLatestCurationList(events);
      liveCoords = live.coordinates;
      liveNames = live.names;
    }

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

    console.log(`\n${pass ? '✅ POINTER LIST MATCHES — broadcast confirmed.' : '❌ MISMATCH — see above. If you just published, relays may still be indexing; retry shortly.'}`);

    // Guaranteed Presence audit (#160): can every Official Essay actually be
    // opened right now, reading its body back from the reader relays the
    // site itself uses? Read-only — verifyPresence never broadcasts. Runs
    // regardless of the pointer/name checks above (including when no live
    // curation list was found at all) so an AFK agent or CI always sees what
    // a visitor would experience, not merely that the pointer list matches.
    //
    // Audits the UNION of the local manifest (ESSAYS) and whatever is
    // actually live on the relays right now: an "extra" coordinate on the
    // live list is still something a visitor could open a deep-link to, so
    // its reachability matters even though it's already flagged above as a
    // pointer mismatch.
    const auditCoordinates = new Set([...expectedCoords, ...liveCoords]);
    const essaysToAudit = [...auditCoordinates].map((coordinate) => ({ coordinate }));

    console.log('\nConfirming every Official Essay body is openable from the reader relays...');
    const vault = createProductionVault(pool, { readerRelays: READER_RELAYS });
    const audit = await runPresenceAudit({ essays: essaysToAudit, vault });

    console.log('\nEssay body reachability:');
    for (const entry of audit.report) {
      const icon = entry.status === 'openable' ? '✅' : '❌';
      console.log(`  ${icon} ${entry.coordinate} — ${entry.status}${entry.reason ? ` (${entry.reason})` : ''}`);
    }

    if (!audit.ok) {
      console.error(`\n❌ ${audit.unavailable.length} Official Essay(s) unavailable — a visitor cannot open:`);
      for (const coordinate of audit.unavailable) console.error(`  - ${coordinate}`);
    } else {
      console.log('\n✅ Every Official Essay body is openable from the reader relays.');
    }

    // Guarantee-relay-specific confirmation (#161): the aggregate check above
    // only proves an Essay is readable from SOME relay in the reader set — a
    // public relay could be doing all the work while the guarantee relay is
    // silently empty. Re-run the same read-only audit against ONLY the brand
    // relay so "confirmed readable from that relay specifically" is its own
    // checked fact, never inferred from the union passing.
    let guaranteeOk = true;
    if (GUARANTEE_RELAY === GUARANTEE_RELAY_PLACEHOLDER) {
      console.error('\n❌ GUARANTEE_RELAY in src/brand.js is still the placeholder — not provisioned,');
      console.error('   so the guarantee-relay-specific check cannot pass. Run');
      console.error('   scripts/provision-guarantee-relay.ps1 to provision the brand relay and set');
      console.error('   the real wss:// URL.');
      guaranteeOk = false;
    } else {
      console.log(`\nConfirming every Official Essay is openable from the guarantee relay specifically (${GUARANTEE_RELAY})...`);
      const guaranteeVault = createProductionVault(pool, { readerRelays: [GUARANTEE_RELAY] });
      const guaranteeAudit = await runPresenceAudit({ essays: essaysToAudit, vault: guaranteeVault });
      for (const entry of guaranteeAudit.report) {
        const icon = entry.status === 'openable' ? '✅' : '❌';
        console.log(`  ${icon} ${entry.coordinate} — ${entry.status}${entry.reason ? ` (${entry.reason})` : ''}`);
      }
      guaranteeOk = guaranteeAudit.ok;
      if (!guaranteeAudit.ok) {
        console.error(`\n❌ ${guaranteeAudit.unavailable.length} Official Essay(s) NOT readable from the guarantee relay specifically:`);
        for (const coordinate of guaranteeAudit.unavailable) console.error(`  - ${coordinate}`);
      } else {
        console.log('\n✅ Every Official Essay is openable from the guarantee relay specifically.');
      }
    }

    const overallPass = pass && audit.ok && guaranteeOk;
    console.log(`\n${overallPass ? '✅ CURATION AUDIT PASS' : '❌ CURATION AUDIT FAIL — see above.'}\n`);
    process.exitCode = overallPass ? 0 : 1;
  } finally {
    pool.close(closeRelays);
  }
}

// Only run when invoked directly (e.g. `npm run check:curation`), so tests
// can import runPresenceAudit without triggering a live relay check.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('\n❌ Check errored:', err.message);
    process.exit(2);
  });
}
