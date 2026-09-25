// Read-only live check: for each Official Essay in the live Curation, how many
// brand relays hold it? Fails (non-zero exit) when any Official Essay is held
// by fewer than 2 brand relays, naming it by Essay Slug and coordinate — so
// the curator knows exactly what to re-broadcast or ask an author to
// re-publish, instead of a reader silently losing that Essay off Discovery
// (see #165, #169).
//
// This NEVER publishes and needs no secret key — it only reads public events.
// Replaces the throwaway diagnosis scripts used to first reproduce #165's bug
// (`curated=13 shown=4 missing=9` against live relays).
//
// Probe volume is kept gentle (#169): exactly ONE query per brand relay for
// the Curation, and exactly ONE further query per brand relay for ALL curated
// Essays together (a single kinds:[30023] + authors + #d filter, not one
// query per Essay) — relays rate-limit repeated connections.
//
// Run: node scripts/check-coverage.mjs   (or `npm run check:coverage`)
import { pathToFileURL } from 'node:url';
import { SimplePool } from 'nostr-tools/pool';
import { BRAND_PUBKEY, BRAND_PUBKEY_PLACEHOLDER, READER_RELAYS, curationListFilter } from '../src/brand.js';
import { getLatestCurationList } from '../src/essay-curation.js';
import { parseCoordinate, formatCoordinate } from '../src/essay-coordinate.js';
import { ESSAY_KIND } from '../src/essay-vault.js';
import { evaluateRelayCoverage, MIN_RELAY_COVERAGE } from '../src/relay-coverage.js';

// Fetches, per relay, the set of "kind:pubkey:identifier" coordinates that
// relay holds among the given curated coordinates — ONE query per relay,
// filtered by kinds + authors + the curated `d` identifiers together (not one
// query per Essay, and not merely kind+authors — an unconstrained query risks
// a relay silently truncating to its newest N events per author and
// undercounting older ones as absent). `identifiers` is threaded through as
// its own parameter (rather than folded into `queryRelay` via closure) so a
// future edit that drops the `#d` filter breaks a test, not just a comment.
// Injected `queryRelay` keeps this swappable/testable; production wires it to
// a single-relay pool.querySync call.
export async function collectPerRelayCoordinates({ relays, authors, identifiers, queryRelay }) {
  if (!Array.isArray(relays) || relays.length === 0) {
    throw new Error('collectPerRelayCoordinates: relays must be a non-empty array');
  }
  if (!Array.isArray(authors) || authors.length === 0) {
    throw new Error('collectPerRelayCoordinates: authors must be a non-empty array');
  }
  if (!Array.isArray(identifiers) || identifiers.length === 0) {
    throw new Error('collectPerRelayCoordinates: identifiers must be a non-empty array');
  }
  if (typeof queryRelay !== 'function') {
    throw new Error('collectPerRelayCoordinates: queryRelay must be a function');
  }
  const entries = await Promise.all(
    relays.map(async (relay) => {
      const events = await queryRelay(relay, authors, identifiers);
      const coordinates = new Set();
      for (const event of events ?? []) {
        if (!event || event.kind !== ESSAY_KIND) continue;
        const dTag = event.tags?.find((t) => t[0] === 'd')?.[1];
        if (dTag === undefined) continue;
        const coordinate = formatCoordinate({ kind: event.kind, pubkey: event.pubkey, identifier: dTag });
        if (coordinate) coordinates.add(coordinate);
      }
      return [relay, coordinates];
    }),
  );
  return new Map(entries);
}

// The per-Essay coverage audit (#169): for each curated coordinate, how many
// brand relays hold it, judged by the SAME coverage rule (src/relay-coverage.js)
// the Curation redundancy check (#168) uses — "count present relays, fail
// below minCoverage" never diverges between "does this relay hold the
// Curation" and "does this relay hold this Essay". Pure: `perRelayCoordinates`
// is already-fetched data, so this makes no relay I/O of its own.
export function runEssayCoverageAudit({ coordinates, relays, perRelayCoordinates, minCoverage = MIN_RELAY_COVERAGE }) {
  if (!Array.isArray(coordinates)) {
    throw new Error('runEssayCoverageAudit: coordinates must be an array');
  }
  if (!(perRelayCoordinates instanceof Map)) {
    throw new Error('runEssayCoverageAudit: perRelayCoordinates must be a Map<relay, Set<coordinate>>');
  }
  const entries = coordinates.map((coordinate) => {
    const perRelay = relays.map((relay) => ({ relay, present: perRelayCoordinates.get(relay)?.has(coordinate) ?? false }));
    const audit = evaluateRelayCoverage(perRelay, minCoverage);
    const holders = perRelay.filter((entry) => entry.present).map((entry) => entry.relay);
    return { coordinate, ok: audit.ok, coverage: audit.coverage, holders };
  });
  return { ok: entries.every((entry) => entry.ok), entries };
}

async function main() {
  if (BRAND_PUBKEY === BRAND_PUBKEY_PLACEHOLDER) {
    console.error('BRAND_PUBKEY in src/brand.js is still the all-zeros placeholder.');
    console.error('The site is fail-closed and no list is fetched. Nothing to check.');
    process.exit(1);
  }

  const pool = new SimplePool();
  try {
    console.log(`Brand pubkey: ${BRAND_PUBKEY}`);
    console.log('\nReading the live Curation from the brand relays...');

    const curationEvents = await pool.querySync(READER_RELAYS, curationListFilter(), { maxWait: 8000 });

    if (curationEvents.length === 0) {
      console.error('\n❌ No curation list found on the relays for this brand pubkey.');
      console.error('   The publish may not have landed, or relays are still indexing — retry shortly.');
      process.exit(1);
    }

    const { coordinates, coordinateToSlug } = getLatestCurationList(curationEvents);
    const coordinateList = [...coordinates];
    console.log(`Found ${coordinateList.length} Official Essay(s) on the live Curation.`);

    const parsedCoordinates = coordinateList.map((c) => parseCoordinate(c)).filter(Boolean);
    const authors = [...new Set(parsedCoordinates.map((c) => c.pubkey))];
    // Constrain by the curated `d` identifiers too, not just kind + authors:
    // a relay that caps how many events it returns per query would otherwise
    // silently return only its newest N Essays per author and undercount
    // older ones as absent.
    const identifiers = [...new Set(parsedCoordinates.map((c) => c.identifier))];

    console.log(`\nQuerying each brand relay for the ${coordinateList.length} Official Essay(s) (one connection per relay)...`);
    const perRelayCoordinates = await collectPerRelayCoordinates({
      relays: READER_RELAYS,
      authors,
      identifiers,
      queryRelay: (relay, relayAuthors, relayIdentifiers) =>
        pool.querySync([relay], { kinds: [ESSAY_KIND], authors: relayAuthors, '#d': relayIdentifiers }, { maxWait: 5000 }),
    });

    const coverage = runEssayCoverageAudit({
      coordinates: coordinateList,
      relays: READER_RELAYS,
      perRelayCoordinates,
      minCoverage: MIN_RELAY_COVERAGE,
    });

    console.log('\nPer-Essay relay coverage:');
    for (const entry of coverage.entries) {
      const slug = coordinateToSlug.get(entry.coordinate) ?? '(no slug)';
      const icon = entry.ok ? '✅' : '❌';
      console.log(`  ${icon} ${slug} — ${entry.coordinate}`);
      console.log(`      ${entry.coverage}/${READER_RELAYS.length} brand relays (need >= ${MIN_RELAY_COVERAGE}): ${entry.holders.join(', ') || '(none)'}`);
    }

    const failing = coverage.entries.filter((entry) => !entry.ok);
    if (failing.length) {
      console.error(`\n❌ ${failing.length} Official Essay(s) held by fewer than ${MIN_RELAY_COVERAGE} brand relays:`);
      for (const entry of failing) {
        const slug = coordinateToSlug.get(entry.coordinate) ?? '(no slug)';
        console.error(`  - ${slug} — ${entry.coordinate} (${entry.coverage}/${READER_RELAYS.length})`);
      }
    }

    console.log(`\n${coverage.ok ? '✅ COVERAGE CHECK PASS' : '❌ COVERAGE CHECK FAIL — see above.'}\n`);
    process.exitCode = coverage.ok ? 0 : 1;
  } finally {
    pool.close(READER_RELAYS);
  }
}

// Only run when invoked directly (e.g. `npm run check:coverage`), so tests
// can import the pure helpers without triggering a live relay check.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('\n❌ Check errored:', err.message);
    process.exit(2);
  });
}
