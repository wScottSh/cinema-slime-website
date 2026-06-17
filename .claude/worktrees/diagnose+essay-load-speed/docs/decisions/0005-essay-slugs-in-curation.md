# Essay Slugs — human-readable URLs via the curation list

**Date**: 2026-06-02
**Status**: accepted
**Context**: Implementing issue #50. ADR 0002 (decision #5) committed the Essay URL scheme to the raw addressable coordinate `kind:pubkey:identifier`, percent-encoded into `#/essay/<coordinate>`. That commitment came with an explicit escape hatch: "migrating to `naddr` later is additive, not breaking." This ADR exercises that hatch in a different direction — brand-chosen human-readable slugs — and records why.

---

## Context / problem

Coordinate URLs are stable and shareable but ugly:

```
#/essay/30023%3Ab62f1736…%3AdIBToCbVqma_T8HM4Z4Os
```

The brand wants pretty, memorable URLs (`#/essay/first`) without giving up the existing coordinate links already in the wild, and without introducing a second source of truth that requires a redeploy to change.

---

## Decisions

### 1. The slug is a brand-controlled field of the Curation, published into the `kind:30001` event

The slug is **not** derived from the Essay's NIP-23 `d` identifier (author-controlled, may be a full URL, not URL-pretty) and **not** baked into the site bundle at build time. It lives in the same place the brand already controls Essay membership and display names: the curation list. To add or change a slug, the brand edits the manifest and re-publishes — no code change or deploy. This keeps a single source of truth, consistent with ADR 0003.

### 2. Encoding — slug at index 3 of the `a` tag

A curated Essay tag becomes `["a", <coordinate>, "", <slug>]` (index 2 left empty for the conventional NIP-51 relay hint we don't use). This mirrors the existing name encoding `["p", <pubkey>, "", <name>]`, so `parseCurationList` reads `tag[3]` for both. An Essay without a slug is published as `["a", <coordinate>]`. Index 2 stays free for a real relay hint later without a migration.

### 3. The slug never enters the coordinate string

The coordinate's identifier may itself contain colons and slashes (verified live; see ADR 0002), so there is no delimiter that can safely append a slug to the coordinate string. The slug is therefore a separate manifest field (`{ coordinate, slug }`) and a separate tag element, never a suffix on the coordinate. `parseCoordinate` is unchanged.

### 4. URL scheme — coexistence, slug canonical, coordinate honored

The router accepts both forms and discriminates for free: `parseCoordinate(token)` succeeds for a coordinate and returns `null` for a slug.

- **Coordinate token** → the existing fast path: the coordinate is self-contained in the URL, so the Essay + curation + social-proof fetches stay parallel. Old shared links keep working — ADR 0002's stability promise is preserved.
- **Slug token** → resolve first: load the curation list, map slug → coordinate via the list the site already fetches, then fetch the Essay. One previously-parallel hop becomes serial in the slug case only.

Internal links (essay cards, Essay Page affordances) prefer the slug when the curation list provides one, falling back to the coordinate — so the pretty URL is the one users see and copy. The "view original event" / `njump` link remains the coordinate, since that is a Nostr address, not a site URL.

### 5. Slug rules

- **Format**: `^[a-z0-9]+(?:-[a-z0-9]+)*$` — lowercase alphanumerics and single hyphens. URL-safe without encoding; colon-free, so a slug can never be parsed as a coordinate.
- **Uniqueness**: unique within the curation list. The brand owns the namespace.
- **Optional**: an Essay may be Official without a slug; only its coordinate URL resolves in that case.
- **Validation at publish time**: the publish script refuses to broadcast if two entries share a slug or any slug is malformed — fail loud before the event is signed, never after it is live.

---

## Alternatives considered

- **Slug baked into the site bundle at build time.** Rejected: splits authority — membership and names live on Nostr but slugs would require a redeploy, a second source of truth that can drift from the published list.
- **Hard cutover to slug-only URLs.** Rejected: breaks the coordinate links ADR 0002 promised would stay stable, for no benefit over coexistence.
- **Deriving the slug from the NIP-23 `d` identifier.** Rejected: the `d` tag is author-controlled and may be a full URL; the brand needs its own URL-pretty namespace.

---

## Consequences

- Deep-linking a slug URL on a cold load depends on the curation list resolving first; relays-down degrades to the existing fail-closed "Essay unavailable" view, same as today.
- `parseCurationList` gains slug↔coordinate maps; `coordinates`/`names` outputs are unchanged, so curation gating is untouched.
- The URL scheme is now committed to coexistence. Removing coordinate URLs later would be breaking; adding more slugs is additive.
- Introduces the **Essay Slug** domain term (see CONTEXT.md), distinct from the **Essay Identifier**.
