# Discovery settle gated on Curation completeness — amends ADR 0007

**Date**: 2026-09-25
**Status**: accepted
**Amends**: ADR 0007 (early-settle relay collection)
**Context**: #165 diagnosed the Discovery View showing only 4 of 13 Official Essays (Harrison's four newest); #166 is the fix this ADR records.

---

## Context / problem

ADR 0007 made `collectEvents` resolve as soon as the event stream goes quiet for `settleMs` (800ms), instead of waiting for every relay to EOSE. It accepted that trade-off on the premise that curated events are "published to all relays" — so an early, quiet-but-partial answer was assumed to already be the *complete* answer, just missing duplicate deliveries from slower relays.

That premise is false. Relay coverage is uneven and nothing checked it. Reproduced deterministically against live relays (Sept 2026, `curated=13 shown=4 missing=9`, three runs): the site's fast relay holds only the four newest Official Essays and answers in ~120ms; a slower relay holds the rest and answers around ~990ms — just after the ~800ms settle window has already ended collection. The fast relay's partial answer was quiet, so `collectEvents` settled on it before the slow relay could deliver anything, and Discovery silently dropped nine Essays.

## Decision

`collectEvents` (`src/relay-collect.js`) gains one optional input: `isComplete(events)`, a completeness rule over the events collected so far.

- **Default**: `() => true` — every existing caller (Curation fetch, Essay Page fetch, social-proof fetch, `RelayPort.collect`) is unaffected; they never pass a rule, so settle-on-quiet behaves exactly as ADR 0007 specified.
- **While `isComplete` reports incomplete**, the quiet-stream settle window does **not** end collection. Only these can:
  1. every relay EOSE'd or closed (unchanged), or
  2. `maxWait` — the hard cap (unchanged as a ceiling, but now also the exit for "the answer never becomes complete").
- **Once `isComplete` reports complete**, the existing settle window applies exactly as before — ADR 0007's grace period for a newer version of a replaceable event arriving from a slower relay is preserved.
- No per-relay EOSE tracking is added (ADR 0007 already rejected this: the relay library doesn't expose it, and it would widen the interface). `isComplete` is evaluated over the accumulated event array only.

**Discovery fetch** (`fetchEssaysForDiscovery` in `src/nostr-pool.js`) supplies the rule: complete when every coordinate in the already-fetched Curation is present among the collected long-form events. The Curation is fetched before the Essays query starts, so this costs no extra round-trip. Other fetches keep the settle-on-quiet timing ADR 0007 established — they don't know what "complete" means for their query, so they don't try.

**Accepted trade-off (option a)**: if an Official Essay exists on no reachable relay, a cold Discovery load waits the full `maxWait` before rendering what it has, instead of a shorter incomplete-case cap or progressive rendering. Returning visitors are unaffected (SWR cache, ADR 0006). This is deliberate — the alternative (a shorter cap for the incomplete case) would silently reintroduce partial results, exactly the bug this ADR fixes. The separate live coverage check (#165, out of scope here) makes chronic thin coverage visible so it's caught before this trade-off is exercised in practice.

**Alternatives considered**:
- *Drop early-settle entirely for Discovery (always wait for EOSE-or-maxWait).* Rejected: with relays that never EOSE (the common case per ADR 0007's own measurements), this degenerates to always paying `maxWait`, which is worse than the accepted trade-off above for the common "everything's covered" case.
- *A shorter incomplete-case cap.* Rejected: reintroduces partial, silently-incomplete results — the same failure mode being fixed, just with a smaller blast radius.

## Consequences

- Discovery now returns every Curation-covered Official Essay it can find within `maxWait`, at the cost of the full `maxWait` on the (now-visible, checked) rare case where coverage is genuinely thin.
- The normal case (all curated Essays covered by the fast relay, or arriving before settle) is unaffected in latency — `isComplete` is satisfied on the first settle check, same as before.
- Curation, Essay Page, and social-proof fetches are byte-for-byte unaffected: they never pass `isComplete`, so `collectEvents` behaves exactly as ADR 0007 left it.
- The unit suite still never touches real relay I/O (ADR 0002): the regression test and the collector's completeness tests drive a fake pool with mocked timers, mirroring ADR 0007's existing test shape.
- `isComplete` treats "no relay has it yet" and "no relay will ever have it" identically — it has no way to distinguish a coordinate that's merely slow to arrive from one that can never match (e.g. a stale/malformed Curation entry, or one naming the wrong event kind). Both pay the full `maxWait` on a cold load under the option-(a) trade-off above. This is accepted as the same condition the live coverage check (#165, separate sub-issue) is meant to catch and report, rather than something this fetch should special-case.
