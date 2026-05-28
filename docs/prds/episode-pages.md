# PRD: Episode Pages (Full Description View for Episodes)

**Generated**: 2026-05-28 (autonomous synthesis from grill-me session + codebase + CONTEXT.md)

---

## Problem Statement

As a visitor to the Cinema Slime website, I currently cannot easily read the full description of any Episode. The Discovery View only shows heavily truncated descriptions on cards and in the hero. When I want to understand what an Episode is about before committing time to Playback, I have no good way to do so. Clicking an Episode in the Discovery View only initiates Playback via the sticky player, with no path to a dedicated view for the complete description.

---

## Solution

Introduce **Episode Pages** — distinct, addressable views dedicated to a single Episode, reached via a stable **Episode Identifier** from the Discovery View (and via direct links). Each Episode Page presents the Episode's complete, untruncated description (after sensible boilerplate stripping) along with core metadata, while keeping the rest of the site shell intact so that Playback remains available without friction.

The existing Discovery View and Playback mechanisms remain the primary ways to browse and listen; Episode Pages are an additive, first-class way to deeply understand an Episode.

---

## User Stories

1. As a first-time visitor, I want to click any Episode card in the Discovery View, so that I am taken to a dedicated Episode Page where I can read the full description.
2. As a visitor who received a shared link to a specific Episode, I want to land directly on that Episode Page, so that I can immediately read the description without first hunting through the grid.
3. As a visitor reading an Episode Page, I want to see the Episode's title, number/label, publish date, duration, and artwork prominently, so that I have context before reading the description.
4. As a visitor on an Episode Page, I want the full description rendered in a readable format (with basic structure preserved), so that I can comfortably read long-form content about the films discussed.
5. As a visitor on an Episode Page, I want boilerplate (subscribe CTAs, repeated social links, "EXPERIENCE MOVIES WITH US!" blocks) removed from the default view, so that I am not distracted by repetitive footer material.
6. As a power user or archivist, I want a way to view the original raw RSS description on the Episode Page, so that I can see exactly what was published in the feed.
7. As a listener who arrives at an Episode Page, I want a clear, prominent control to start Playback of that Episode, so that I can listen immediately after (or while) reading the description.
8. As a visitor on an Episode Page, I want the sticky player (if active) to continue working without interruption, so that Playback state is not lost when moving between views.
9. As a visitor who has read an Episode Page, I want an obvious "Back to all episodes" control, so that I can return to the Discovery View without relying solely on the browser back button.
10. As a visitor using browser navigation, I want the browser back/forward buttons to work naturally between the Discovery View and any Episode Page, so that the experience feels like normal web navigation.
11. As a visitor who had an active search or filter in the Discovery View, I want those filters and my scroll position to be restored when I return from an Episode Page (best effort), so that I do not lose my place in the collection.
12. As a mobile visitor, I want the Episode Page to be fully usable and readable on small screens, so that I can consume descriptions on the go.
13. As a keyboard or screen reader user, I want all actions on Episode cards (navigate to page vs initiate Playback) and on the Episode Page itself to be discoverable and operable, so that the feature is accessible.
14. As a visitor who refreshes the browser while on an Episode Page, I want to return to the same Episode Page, so that the URL is a stable, reliable address for that Episode.
15. As a visitor, I want the browser tab title to reflect the current Episode when on an Episode Page, so that I can easily identify the page among many tabs.
16. As a future maintainer, I want Episode identification to be stable across feed reordering, new episodes, and potential client-side sorting, so that links and bookmarks to Episode Pages do not break.
17. As a visitor browsing the Discovery View, I still want to be able to initiate Playback directly from an Episode card without first going to the Episode Page, so that the quick-listen workflow is preserved.
18. As a visitor on an Episode Page for a bonus or trailer Episode, I want the type (bonus/trailer) to be clearly indicated, so that I have the same context I see in the Discovery View.
19. As a visitor who lands on an Episode Page for a guid that no longer exists in the feed, I want a clear, helpful "not found" experience with a path back to the Discovery View, so that I am not left in a broken state.
20. As the site owner, I want all new Episode Page behavior to be implemented without introducing any new runtime dependencies, so that the zero-dependency, single-file vanilla nature of the site is preserved.
21. As a developer, I want the logic that cleans Episode descriptions to be pure and easily testable in isolation, so that I can evolve the cleaning rules confidently as the feed content changes.
22. As a developer, I want the routing logic that decides whether to show the Discovery View or a specific Episode Page to be small, pure, and testable, so that deep linking and navigation edge cases can be covered with fast tests.
23. As a visitor, I want the Episode Page to feel visually consistent with the rest of the Cinema Slime site (same colors, typography, spacing, grain, etc.), so that I never feel like I have left the site.
24. As a visitor who uses the hero "latest episode" card, I want clicking it to also take me to the corresponding Episode Page (with Playback available as a secondary action), so that the entry point is consistent with the grid.
25. As the site owner, I want the addition of Episode Pages to be deliverable in small, reviewable increments without a large rewrite of the existing monolithic render and event code, so that risk is minimized.

---

## Implementation Decisions

- The site will use hash-based routing for Episode Pages (e.g. `#/episode/<Episode Identifier>`). This was chosen because the current deploy is a static file copy to a VPS with no existing server-side routing configuration. The approach is fully reversible later.
- The stable **Episode Identifier** used to address Episode Pages will be the `guid` value already parsed from the RSS feed for every Episode. Array index is explicitly rejected as the identifier because it is unstable across feed changes.
- Primary click/tap on an Episode card (or the hero latest card) in the Discovery View navigates to the corresponding Episode Page. A distinct, always-visible play control on the card will initiate Playback without navigation. This split was accepted because the web presence is new and has no entrenched listener base arriving via the site.
- An Episode Page renders inside the existing full site shell (fixed nav, footer, and sticky player remain functional). Only the main content area (hero + episodes grid) is replaced by the Episode Page content. This keeps Playback continuously available and preserves site coherence.
- Description rendering on the Episode Page will use an enhanced version of the existing cleaning logic. The default view will aggressively strip known repetitive boilerplate ("EXPERIENCE MOVIES WITH US!", social link blocks, host credits, etc.) while preserving the actual episode prose and any timestamped sections. A collapsed disclosure will offer the raw original RSS description for completeness.
- Playback on an Episode Page will be initiated via a prominent button that re-uses the existing global Playback mechanism (sticky player). There will be no second audio element or duplicate player UI.
- Navigation out of an Episode Page will be supported by an explicit "All Episodes" / back link plus full browser history support (hashchange + popstate). Best-effort preservation of the visitor's last search query, filter, and scroll position in the Discovery View will be implemented.
- Deep linking will be fully supported: on initial load, after the RSS feed is fetched, the router will inspect the hash and render the matching Episode Page (or a friendly not-found state) instead of the default Discovery View.
- `document.title` will be dynamically updated while an Episode Page is active and restored when leaving it.
- No new runtime dependencies will be introduced. All logic stays within the existing vanilla JS + CSS patterns.
- The following deep modules are proposed for extraction (to improve testability and reduce the size of the main render/event file):
  - **Episode Data Module** (pure functions): lookup by Episode Identifier, labeling (`getEpLabel`), title cleaning, metadata formatting. Stable narrow interface over the episodes array.
  - **Description Normalizer** (pure): `normalizeDescription(rawHtml) → { cleanedHtml, rawHtml }`. Encapsulates all boilerplate removal rules. Extremely high-value for testing against real feed samples.
  - **Hash Router** (near-pure): `getCurrentRoute()`, `parseHash(hash) → Route`, `navigateToEpisodePage(id: Episode Identifier)`, `navigateToDiscoveryView()`. Tiny surface that can be tested with mocked location/hash.
  - **Playback Controller** (stateful but narrow interface): encapsulates the Audio element lifecycle, sticky player sync, and play/pause/next/prev logic. Moves scattered globals and listeners into one place.

These modules were identified specifically because they have narrow, stable interfaces while hiding significant complexity or duplication that currently lives in the monolithic `render()` / `bindEvents()` / global state.

- No changes to the RSS fetch or core parsing layer are required — the new views only consume already-parsed Episode data (including the previously unused `guid` and full `description` fields).
- Visual styling for Episode Pages will reuse the existing design system tokens (slime green, cinema red, typography stack, radii, transitions, grain overlay) with no new foundational tokens.

---

## Testing Decisions

A good test in this codebase verifies external observable behavior (what the user sees or can do) or the output of pure functions, without asserting on internal implementation details such as exact DOM structure of private helpers or the order of event listener attachment.

Prior art: there are currently no automated tests in the repository. The existing `getShortDescription`, `stripHtml`, `cleanTitle`, `getEpLabel`, and `formatDate` helpers are all pure or near-pure functions that have grown organically — they are the natural prior art for the new pure modules.

Modules that will be tested (in priority order):

- **Description Normalizer** (pure): extensive tests using real RSS description samples (including trailers, bonuses, and full episodes) covering boilerplate stripping, preservation of timestamps and prose, and the raw fallback path. This is the highest-leverage test surface.
- **Episode Data Module** helpers (pure): tests for stable lookup by Episode Identifier, correct labeling of full/bonus/trailer, title cleaning edge cases, and graceful handling of missing fields.
- **Hash Router** (near-pure): tests for parsing various hash formats into the correct Route union, round-tripping Episode Identifier, and navigation side-effect-free behavior.
- Integration smoke tests (via the existing manual dev server or a lightweight DOM test harness) for: deep-link initial render of an Episode Page, navigation from Discovery View card to page and back, Playback initiation from both surfaces, and title updates.
- No unit tests will be written for the top-level `render()` orchestration or raw DOM manipulation in the first increment (these are inherently hard to isolate and change frequently).

The pure modules above should be extracted early so they can be tested in complete isolation before any view wiring.

---

## Out of Scope

- Per-Episode social / Open Graph previews or server-side rendering (would require build-time or hosting changes).
- Migration from hash routing to clean URLs + nginx `try_files` (reversible future work).
- Inline audio player on the Episode Page itself (the sticky player remains the single source of truth for Playback).
- "Related episodes", chapter markers, or timestamps-as-navigation within the description.
- Any change to how the RSS feed is fetched or the core Episode shape.
- Pagination, infinite scroll, or virtualized grids in the Discovery View.
- Persistence of list state (search/filter/scroll) across browser sessions (localStorage).
- Any visual or interaction design that deviates from the existing Cinema Slime design system.

---

## Further Notes

- This PRD is the direct output of an exhaustive autonomous grill session that resolved every major design branch (routing model, identifier strategy, click behavior, page composition, description handling, deep linking, exit paths, and error states) using concrete scenarios and cross-references against the live codebase and real RSS feed content.
- A detailed record of every decision, rationale, and scenario considered is stored at `docs/episode-pages-decisions.md`.
- The `CONTEXT.md` glossary (Episode, Episode Page, Episode Identifier, Discovery View, Playback) must be respected in all implementation work and future discussions.
- Because the web presence is new, several decisions deliberately favored the "read the description" use case over preserving every existing Playback shortcut. These can be revisited cheaply if listener behavior on the site changes.
- The four proposed deep modules represent the main opportunity to move the codebase from a monolithic SPA toward more testable, maintainable boundaries without a full rewrite.

Ready for implementation once the modules are confirmed and the `ready-for-agent` label is applied.
