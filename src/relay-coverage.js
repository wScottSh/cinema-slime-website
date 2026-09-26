// Brand relay coverage — the ONE rule behind both live coverage checks:
// "how many brand relays hold this thing, and is that at least
// MIN_RELAY_COVERAGE?" scripts/check-curation.mjs applies it to the live
// Curation (#168); scripts/check-coverage.mjs applies it to each Official
// Essay (#169). Keeping the rule and its threshold here means the two checks
// can never disagree about what "held redundantly" means.
//
// Pure and I/O-free: relay access is injected (ADR 0002), so the unit suite
// never touches a real relay.

// Fewer than this many brand relays holding the Curation or an Official
// Essay is a single point of failure, and fails the check (#165).
export const MIN_RELAY_COVERAGE = 2;

// perRelay: [{ relay, present }] -> the coverage verdict.
export function evaluateRelayCoverage(perRelay, minCoverage = MIN_RELAY_COVERAGE) {
  const coverage = perRelay.filter((entry) => entry.present).length;
  return { ok: coverage >= minCoverage, perRelay, coverage, minCoverage };
}

// Asks each relay (via the injected `queryRelay(relay) -> truthy`) whether it
// holds the thing being audited, then applies the coverage rule. Every relay
// is reported, present or not, so the per-relay breakdown reflects reality.
export async function runRelayCoverageAudit({ relays, queryRelay, minCoverage = MIN_RELAY_COVERAGE } = {}) {
  if (!Array.isArray(relays) || relays.length === 0) {
    throw new Error('runRelayCoverageAudit: relays must be a non-empty array');
  }
  if (typeof queryRelay !== 'function') {
    throw new Error('runRelayCoverageAudit: queryRelay must be a function');
  }
  const perRelay = await Promise.all(
    relays.map(async (relay) => ({ relay, present: Boolean(await queryRelay(relay)) })),
  );
  return evaluateRelayCoverage(perRelay, minCoverage);
}
