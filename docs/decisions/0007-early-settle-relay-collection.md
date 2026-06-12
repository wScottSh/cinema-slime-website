# Early-settle relay collection — stop waiting for the slowest relay

**Date**: 2026-06-12
**Status**: accepted
**Context**: ADR 0006 made returning visitors instant via the localStorage SWR cache, but the *cold* essays path (first visit, or any browser where `cs:essays` was never written) still showed the Discovery spinner for 14–19 seconds. This ADR records why, and the change to how Nostr events are collected from relays.

---

## Context / problem

All four Nostr fetchers (`src/nostr-pool.js`) used `SimplePool.querySync`, which resolves only when **every** relay has sent EOSE, or a generous `maxWait` (6–8s) expires. Measured against the four `DEFAULT_RELAYS` (June 2026):

- `nos.lol` served the curation list in ~0.8s and essays in ~1s.
- `relay.damus.io` returns **zero events** for the `kind:30001` curation query (it does not serve it), and `relay.nostr.band` hung to timeout on both queries — so neither EOSEs usefully.

Result: both sequential discovery queries (curation list, then essays) ran to their full `maxWait` on every cold load — ~19s of spinner while the complete answer had been sitting in memory since the first second. Worse, the SWR cache is written only when that fetch resolves, so any visit shorter than ~19s never warmed the cache and the visitor saw the full spinner again on every subsequent visit.

## Decision

Replace `querySync` with `collectEvents` (`src/relay-collect.js`), which resolves with the events collected so far when the first of these fires:

1. **All relays EOSE'd or closed** — the complete answer (unchanged semantics).
2. **The stream went quiet** — `settleMs` (800ms) has passed since the last event arrived. First event starts the window; each further event resets it (debounce), so multi-event result sets that arrive in bursts from different relays are not truncated.
3. **`maxWait` elapsed** — hard cap, and the only exit when nothing arrives (relays down / genuinely empty result). Failure detection latency is unchanged.

The pool is injected, so the module is unit-tested without touching `nostr-tools` or a WebSocket — the existing rule that relay/wire internals stay out of the unit suite (ADR 0002) is preserved.

**Alternatives considered**:
- *Dropping the two misbehaving relays.* Rejected: relay weather changes, and with early-settle the slow relays no longer gate latency — keeping them preserves redundancy at no cost.
- *Per-relay EOSE quorum (resolve at N of M).* Rejected: `SimplePool.subscribeMany` does not expose per-relay EOSE, and the time-based settle window is simpler to reason about and test.
- *Shortening `maxWait`.* Rejected as the primary fix: it trades failure-detection robustness for latency; the settle window gets the latency win without touching the failure path.

## Consequences

- Cold-load essays population drops from ~14–19s to ~2–3s (two sequential queries × roughly first-response + 800ms each). The SWR cache now warms reliably even on short first visits.
- **Exhaustiveness is traded for latency**: an event held *only* by a relay that responds more than `settleMs` after the stream last went quiet will be missed in that fetch. For replaceable, brand-curated events published to all relays this is a duplicate-suppression window, not a data-loss window; the background revalidation on every load self-heals any miss.
- A newer *version* of a replaceable event (essay edit, curation update) arriving from a slow relay after settle is likewise picked up on a later revalidation, not the current fetch — acceptable under the 5–10 min staleness budget (ADR 0006).
- The redundant outer `Promise.race` timeout guards in the fetchers are gone; `collectEvents` guarantees resolution by `maxWait`.
