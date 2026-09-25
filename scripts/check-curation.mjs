// Read-only verification that the LIVE curation list on the relays matches the
// ESSAYS/NAMES currently in publish-curation.mjs, that the Curation itself is
// held by at least 2 brand relays individually (see #168), AND that every
// Official Essay's body is actually openable from the reader relay set (see
// #156, #160).
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
import { getLatestCurationList, getNewestCurationEvent } from '../src/essay-curation.js';
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

// The per-relay Curation redundancy audit (#168): reports, for each brand
// relay, whether that relay itself holds the live Curation list — not just
// "found on the union of relays" (the pointer check above already covers
// that), but "found on THIS relay, specifically". Fails (ok: false) when
// fewer than `minCoverage` relays hold it, so a single-point-of-failure
// Curation (ADR 0014's open question — during the July outage the Curation
// resolved from exactly one of four relays) is a loud, checked failure
// instead of a silent one.
//
// Read-only and needs no secret key: `queryRelay(relay)` is injected so the
// unit suite can drive this deterministically with a fake, never touching a
// real relay (ADR 0002); production wires it to a single-relay
// pool.querySync call.
export async function runRelayCoverageAudit({ relays, queryRelay, minCoverage = 2 } = {}) {
  if (!Array.isArray(relays) || relays.length === 0) {
    throw new Error('runRelayCoverageAudit: relays must be a non-empty array');
  }
  if (typeof queryRelay !== 'function') {
    throw new Error('runRelayCoverageAudit: queryRelay must be a function');
  }
  const perRelay = await Promise.all(
    relays.map(async (relay) => ({ relay, present: Boolean(await queryRelay(relay)) })),
  );
  const coverage = perRelay.filter((entry) => entry.present).length;
  return { ok: coverage >= minCoverage, perRelay, coverage, minCoverage };
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
    // The newest raw event across the union query, via the SAME selection
    // rule getLatestCurationList uses (src/essay-curation.js's
    // getNewestCurationEvent) — the exact version the per-relay coverage
    // audit below checks for. Kept separate from getLatestCurationList's
    // parsed { coordinates, names } because the coverage audit needs the
    // event's identity (its id), not its contents: a relay could hold an
    // OLDER version of the Curation and still match on coordinates by
    // coincidence, which would make "holds the Curation" report a false
    // positive for redundancy purposes. Sharing the selection rule (rather
    // than re-deriving "newest" here) means the pointer check above and the
    // coverage audit below can never disagree about which version is live.
    let newestEvent = null;

    if (events.length === 0) {
      console.error('\n❌ No curation list found on the relays for this brand pubkey.');
      console.error('   The publish may not have landed, or relays are still indexing — retry shortly.');
      pass = false;
    } else {
      const live = getLatestCurationList(events);
      liveCoords = live.coordinates;
      liveNames = live.names;
      newestEvent = getNewestCurationEvent(events);
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

    // Per-relay Curation redundancy audit (#168): RELAYS and READER_RELAYS
    // are now the same brand relay set (src/brand.js), so this also proves
    // the Curation reaches exactly the relays the site reads from — closing
    // ADR 0014's open question.
    //
    // Checks for the exact newest event (by id), not merely "some kind:30001
    // event under this d-tag" — a relay serving a stale, superseded version
    // must NOT count toward coverage of the LIVE Curation. When no live
    // Curation was found at all (newestEvent is null, already a failure
    // above), every relay reports not-present rather than skipping the
    // probe, so the per-relay breakdown still reflects reality.
    console.log('\nConfirming the live Curation is held by each brand relay individually...');
    const coverageAudit = await runRelayCoverageAudit({
      relays: RELAYS,
      queryRelay: async (relay) => {
        if (!newestEvent) return false;
        const relayEvents = await pool.querySync(
          [relay],
          { kinds: [CURATION_LIST_KIND], authors: [BRAND_PUBKEY], '#d': [CURATION_LIST_IDENTIFIER] },
          { maxWait: 5000 },
        );
        return relayEvents.some((e) => e.id === newestEvent.id);
      },
    });

    for (const { relay, present } of coverageAudit.perRelay) {
      console.log(`  ${present ? '✅' : '❌'} ${relay} — ${present ? 'holds the live Curation' : 'does NOT hold the live Curation'}`);
    }
    console.log(
      `\n${coverageAudit.ok ? '✅' : '❌'} Curation held by ${coverageAudit.coverage}/${RELAYS.length} brand relays` +
        ` (need >= ${coverageAudit.minCoverage}).`,
    );

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

    const overallPass = pass && coverageAudit.ok && audit.ok && guaranteeOk;
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
