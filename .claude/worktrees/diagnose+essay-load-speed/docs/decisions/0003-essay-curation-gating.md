# Essay Curation & Branding — Official-Essay Gating Design Decisions

**Date**: 2026-05-31
**Status**: accepted
**Context**: Implementing issue #29 of the "Essays via Nostr" PRD (#11). #28 built the bare reader: it could fetch and render *any* NIP-23 long-form post at its own URL. This slice layers the Cinema Slime curation and branding on top, so that only Essays the brand has endorsed render as official, shown under brand-controlled author names. Builds directly on the modules from ADR 0002.

---

## Context / problem

A bare Nostr reader renders anything addressable — including an author's unrelated long-form posts and the brand key's own social notes. The brand needs an authoritative index of which Essays "count," plus control over the author names shown, without re-curating every time an author edits a piece. The site must learn all of this from Nostr itself while hardcoding the absolute minimum.

---

## Decisions

### 1. One hardcoded trust anchor — the brand pubkey

The site hardcodes **exactly one** value: `BRAND_PUBKEY` (`src/brand.js`). Everything else — which Essays are official, what each author is called — is discovered at runtime from the brand's curation list. This keeps the trust surface to a single key and makes the brand the sole authority over the Essay canon.

`BRAND_PUBKEY` is a **clearly-marked placeholder** (all-zeros) for now; the real production key is set in a later slice (#G). Until then the site is fail-closed: the zero key matches no events, so no Essay is official. Pointing the site at the real brand is a one-line change.

### 2. Curation-list wire format — NIP-51 `kind:30001`, coordinates as `a` tags, names as `p`-tag petnames

The brand publishes a single addressable list event:

- `kind:30001` (NIP-51 list), stable `d = cinema-slime-essays` — the Nostr equivalent of the RSS feed.
- Each curated Essay is an **`a` tag** carrying its full coordinate (`30023:<authorpubkey>:<identifier>`). Standard NIP-01 addressable-event reference.
- Each brand-approved author name is a **`p` tag** with the display name in the NIP-02 **petname position** (`["p", <pubkey>, <relay>, <name>]`).

**Alternative considered**: a JSON `pubkey → name` object in the event `content`. Rejected in favour of `p`-tag petnames because it reuses an existing Nostr convention, keeps the whole payload uniform and tag-based (no JSON-in-content parsing on the happy path), and lets the parser stay a trivial tag walk. Interop isn't a concern — only the brand writes this list and only this site reads it — so the more idiomatic, simpler-to-parse shape wins.

### 3. The official-Essay gate — coordinate membership, fail-closed

An Essay renders as an *official Cinema Slime Essay* **only when its coordinate is on the curation list**. `selectCuratedEssay(essay, curation)` (pure) returns the Essay enriched with its brand name, or `null` when the coordinate isn't curated. A `null` result renders the existing "Essay unavailable" view.

The gate is **fail-closed**: a missing, empty, or unreachable curation list yields `null` for every Essay — the site never shows an "official" Essay it could not verify against the brand's index. This matters because the list is a trust boundary, not just a convenience.

### 4. Author name comes from the list, never from `kind:0`

The display name shown on an Essay Page is taken from the curation list's name map (the `p`-tag petname), so the brand — not the author's own profile — controls the name. If the brand curated an Essay but supplied no name for its author, the byline is **empty**; it never falls back to the author's `kind:0` profile or to the raw pubkey. Brand silence means no byline, not an un-vetted name.

### 5. Curation points at coordinates, not versions — edits need no re-curation

Because each `a` tag is a coordinate (not a specific event id), an author editing an Essay (a new `kind:30023` version of the same coordinate) is reflected automatically: `getLatestByCoordinate` (ADR 0002) selects the newest version, and the gate only checks the coordinate. The brand never re-curates for an edit.

### 6. Latest list wins — the curation list is itself replaceable

`kind:30001` is an addressable (replaceable) event, so the brand's list lives at one coordinate with many versions over time. `getLatestCurationList` parses **only the newest** version; a later list **fully supersedes** earlier ones, so removing a coordinate from the list immediately de-officialises that Essay.

### 7. Purity boundary preserved

All curation logic — parsing the list, selecting the latest version, gating an Essay — lives in the pure, dependency-free `src/essay-curation.js`, unit-tested in isolation (node:test + assert/strict, mirroring `essay-data.test.js`). The relay/`SimplePool` dependency stays quarantined in `src/nostr-pool.js`. `src/brand.js` is pure config constants.

---

## Module structure (additions to ADR 0002)

| Module | Purity | Responsibility |
| --- | --- | --- |
| `src/brand.js` | pure config | The single `BRAND_PUBKEY` trust anchor + curation list kind/identifier |
| `src/essay-curation.js` | pure, unit-tested | Parse `kind:30001` → `{coordinates, names}`; latest-list selection; official-Essay gate |
| `src/nostr-pool.js` (extended) | integration | `fetchCurationList()` — relay fetch + fail-closed degradation |
| `src/main.js` (extended) | integration | Fetch Essay + curation together, gate, render official Essay with brand byline |

---

## Verification

- **Unit**: `src/essay-curation.test.js` covers valid payloads, empty lists, malformed/wrong-kind input, latest-list selection, the gate (official / not-official / fail-closed), name-from-map (incl. absent name), and version-independent gating.
- **End-to-end**: `scripts/verify-curation.mjs` publishes — under a disposable ephemeral key, to public relays — an official Essay, a non-curated "other writing" Essay, and the brand curation list, then reads them back through the real modules and asserts the curated Essay resolves as official with the brand name while the non-curated one is gated out. Confirmed green against `relay.damus.io`, `nos.lol`, and `relay.primal.net`, and confirmed in-browser (official Essay shows the brand byline; non-curated shows "Essay unavailable").

---

## Consequences

- The brand gains full control over the Essay canon and the names shown, governed entirely by one published list and one hardcoded key.
- The site is fail-closed: until `BRAND_PUBKEY` is set (#G), and any time the list is unreachable, no Essay is official — a safe default for a trust boundary.
- Author edits are free; only adding/removing a coordinate changes officialness.
- The Episode experience (RSS, player, search, filters) shares no code with this path and is unaffected.
- Discovery of official Essays (a browsable list) is still out of scope — reaching an Essay Page is by coordinate URL until #30.
