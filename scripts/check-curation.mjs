// Read-only verification that the LIVE curation list is on the relays, that it
// is held by at least 2 brand relays individually (see #168), AND that every
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
  BRAND_PUBKEY_PLACEHOLDER,
  READER_RELAYS,
  GUARANTEE_RELAY,
  GUARANTEE_RELAY_PLACEHOLDER,
  curationListFilter,
} from '../src/brand.js';
import { getLatestCurationList, getNewestCurationEvent } from '../src/essay-curation.js';
import { createProductionVault } from '../src/production-vault.js';
import { runRelayCoverageAudit } from '../src/relay-coverage.js';
import { coordinatesFromEssays } from '../src/curation-publish.js';

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
  if (BRAND_PUBKEY === BRAND_PUBKEY_PLACEHOLDER) {
    console.error('BRAND_PUBKEY in src/brand.js is still the all-zeros placeholder.');
    console.error('The site is fail-closed and no list is fetched. Nothing to verify.');
    process.exit(1);
  }

  console.log(`Brand pubkey: ${BRAND_PUBKEY}`);
  console.log(`\nReading the live curation list from relays...`);

  const pool = new SimplePool();

  try {
    const events = await pool.querySync(READER_RELAYS, curationListFilter(), { maxWait: 8000 });

    // The live Curation is the only list (ADR 0021), so there is nothing to
    // diff it against; what can still fail is finding it at all.
    const pass = events.length > 0;
    const liveCoords = pass ? getLatestCurationList(events).coordinates : new Set();
    // The newest raw event, by the same selection rule the site uses: the
    // coverage audit below needs its identity (id), because a relay holding
    // an OLDER version must not count as holding the live one.
    const newestEvent = getNewestCurationEvent(events);

    if (pass) {
      console.log(`✅ Live Curation found: ${liveCoords.size} Official Essay(s).`);
    } else {
      console.error('\n❌ No curation list found on the relays for this brand pubkey.');
      console.error('   The publish may not have landed, or relays are still indexing — retry shortly.');
    }

    // Per-relay Curation redundancy audit (#168): does each brand relay
    // itself hold the live Curation — not just "found on the union" (the
    // check above covers that), but "found on THIS relay"? Fails
    // below MIN_RELAY_COVERAGE (src/relay-coverage.js), so a single-relay
    // Curation (ADR 0014's open question) is a loud, checked failure. The
    // brand relay set is also what the site reads and the Curator
    // writes (src/brand.js), so this proves the Curation reaches exactly the
    // relays the site reads from.
    //
    // Checks for the exact newest event (by id), not merely "some kind:30001
    // event under this d-tag" — a relay serving a stale, superseded version
    // must NOT count toward coverage of the LIVE Curation. When no live
    // Curation was found at all (newestEvent is null, already a failure
    // above), every relay reports not-present rather than skipping the
    // probe, so the per-relay breakdown still reflects reality.
    console.log('\nConfirming the live Curation is held by each brand relay individually...');
    const coverageAudit = await runRelayCoverageAudit({
      relays: READER_RELAYS,
      queryRelay: async (relay) => {
        if (!newestEvent) return false;
        const relayEvents = await pool.querySync([relay], curationListFilter(), { maxWait: 5000 });
        return relayEvents.some((e) => e.id === newestEvent.id);
      },
    });

    for (const { relay, present } of coverageAudit.perRelay) {
      console.log(`  ${present ? '✅' : '❌'} ${relay} — ${present ? 'holds the live Curation' : 'does NOT hold the live Curation'}`);
    }
    console.log(
      `\n${coverageAudit.ok ? '✅' : '❌'} Curation held by ${coverageAudit.coverage}/${READER_RELAYS.length} brand relays` +
        ` (need >= ${coverageAudit.minCoverage}).`,
    );

    // Guaranteed Presence audit (#160): can every Official Essay actually be
    // opened right now, reading its body back from the reader relays the
    // site itself uses? Read-only — verifyPresence never broadcasts. It
    // compares against this checkout's vault/essays/, so an Essay the bot
    // curated since the vault was last synced from the droplet reports
    // not-captured.
    const essaysToAudit = [...liveCoords].map((coordinate) => ({ coordinate }));

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
    // checked fact, never inferred from the union passing. Skipped while
    // GUARANTEE_RELAY is the placeholder: there is no relay to check yet, and
    // provisioning it is tracked in #172 (which also removes this skip).
    let guaranteeOk = true;
    if (GUARANTEE_RELAY !== GUARANTEE_RELAY_PLACEHOLDER) {
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
    pool.close(READER_RELAYS);
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
