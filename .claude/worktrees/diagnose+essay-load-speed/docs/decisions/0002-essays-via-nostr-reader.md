# Essays via Nostr — Reader Layer Design Decisions

**Date**: 2026-05-31
**Status**: accepted
**Context**: Implementing issue #28, the tracer-bullet slice of the "Essays via Nostr" PRD (#11). This ADR records the design decisions made while building the thinnest end-to-end path: reading one NIP-23 long-form post live from Nostr and rendering it at its own URL. Later slices (#29 curation gating, #30 discovery, #31 rich rendering, #32 social proof) build on these foundations.

---

## Context / problem

The site must become a Nostr reader client: discover long-form Essays (NIP-23 `kind:30023` addressable events), fetch them from relays, and render them as dedicated, bookmarkable pages — mirroring the existing Episode Pages architecture (stable index, client-side fetch on load, full site shell, hash router, graceful degradation). Several foundational decisions had to be made and are recorded here so future slices and contributors can rely on them.

---

## Decisions

### 1. Nostr client library — `nostr-tools` (first runtime dependency)

The codebase had **zero runtime dependencies** by design (Episode Pages hand-rolled everything on vanilla JS + Vite). Essays change that: we add `nostr-tools` (2.x) as the first runtime dependency.

**Rationale**: A correct read-only Nostr client still needs multi-relay connection management, NIP-01 wire protocol handling, NIP-19/addressable-event semantics, and — critically — **schnorr signature verification** (secp256k1). Hand-rolling signature verification is exactly the kind of security-sensitive code we should not own. The PRD explicitly calls for "established Nostr client patterns (multi-relay connection via a pool)", which is `nostr-tools`' `SimplePool`. The dependency is well-maintained, tree-shakeable, and bundles to ~27 kB gzipped.

**Boundary**: the dependency is quarantined to the relay layer (`src/nostr-pool.js`). All parsing/selection logic lives in pure, dependency-free modules so the unit-test suite never touches relays or WebSockets.

### 2. Default relay set

`wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net`, `wss://relay.nostr.band` — a small set of widely-used, reliable public relays. Defined as `DEFAULT_RELAYS` in `nostr-pool.js`, overridable per call.

### 3. Signature-verification policy — verify (library default)

`SimplePool` verifies event id + schnorr signature by default; we keep it on. A misbehaving relay cannot inject a forged Essay. (This matters even more once #29 trusts the brand's curation list.)

### 4. Addressable-event handling — newest `created_at` wins

NIP-23 events are replaceable: many versions can share one coordinate. `getLatestByCoordinate()` (pure) deduplicates a set of fetched events down to the newest version per coordinate. This is what makes author edits show up automatically with no re-curation (PRD story 17).

### 5. Essay Identifier → URL scheme — the raw `kind:pubkey:d` coordinate

The **Essay Identifier** is the full addressable coordinate `kind:pubkey:d`, percent-encoded into the hash route `#/essay/<coordinate>`. The bare `d` tag is **not** unique across authors; the full coordinate is.

- `parseCoordinate` / `formatCoordinate` (`src/essay-coordinate.js`, pure) convert between the string and `{ kind, pubkey, identifier }`, validating a numeric kind and a 64-hex pubkey. The `d` identifier may contain colons, slashes, and unicode (verified live against a real Guardian-article-slug Essay whose `d` tag was a full URL), so parsing splits only on the first two colons and the router round-trips via `encodeURIComponent`/`decodeURIComponent`.

**Alternative considered**: NIP-19 `naddr` bech32. Rejected for the tracer because it would couple the otherwise dependency-free identifier module to `nostr-tools`, and the raw coordinate is human-readable and already fully stable/bookmarkable/shareable for our site. `naddr` can be added later for cross-client share links without breaking existing URLs.

### 6. Page composition & routing — mirror Episode Pages

Essay Pages reuse the full site shell (nav, footer, sticky player) and swap only the main content area, exactly like Episode Pages (ADR 0001). The hash router gains an `essay` route alongside `episode`; deep-linking on first load works because `renderCurrentView` resolves the route after the initial data path. A stale-navigation guard ensures a slow relay response never clobbers a view the user has since navigated away from.

### 7. Body rendering — intentionally minimal for the tracer

The Essay body is escaped and rendered as paragraphs/line breaks only (no markdown interpretation, no embeds) — safe by construction (no XSS). Rich markdown, image/YouTube embeds, premium typography, and the "View original Nostr event" disclosure are deliberately deferred to #31.

### 8. Graceful degradation

`fetchEssayByCoordinate` never throws: any relay failure, timeout, or not-found resolves to `null`, which renders a friendly "Essay unavailable" view. The Episode experience (RSS, player, search, filters) runs on a completely separate code path and is unaffected by Nostr outages.

---

## Module structure (deep modules, mirroring the Episode precedent)

| Module | Purity | Responsibility |
| --- | --- | --- |
| `src/essay-coordinate.js` | pure, unit-tested | Essay Identifier ⇄ `{kind,pubkey,identifier}` |
| `src/router.js` (extended) | pure, unit-tested | `#/essay/<coordinate>` parse/build/navigate |
| `src/essay-data.js` | pure, unit-tested | NIP-23 event → Essay; latest-version selection; coordinate lookup |
| `src/nostr-pool.js` | integration | `SimplePool` fetch + graceful degradation (not unit-tested, per PRD) |
| `src/main.js` (extended) | integration | Essay route handling, loading/page/not-found render, deep-link |

---

## Consequences

- The site now ships a runtime dependency; future contributors must `npm install`. Bundle grew by ~27 kB gzipped.
- All Nostr parsing/selection is unit-testable in isolation; relay/wire internals are owned by `nostr-tools` and verified by live smoke checks, not unit tests.
- The raw-coordinate URL scheme is committed to; migrating to `naddr` later is additive, not breaking.
- Curation/branding (#29), discovery (#30), rich rendering (#31), and social proof (#32) layer cleanly on these modules.
