# Episode Pages Feature — Autonomous Design Decisions

**Date**: 2026-05-28  
**Context**: User requested the ability to click a podcast episode and view it on its own page to read the full description.  
**Process**: Full grill-me session conducted autonomously per updated instructions (user not highly opinionated; "do the legwork and summarize").

This document records every major branch of the design tree that was walked, the concrete scenarios used to stress-test options, the cross-references against existing code, the decisions made, and their rationales. All decisions were made with the constraints of the current codebase (vanilla JS + Vite, single `main.js`, static VPS deploy, existing design system).

---

## Resolved Terms (added to CONTEXT.md)

- **Episode** (pre-existing)
- **Episode Page** (new primary concept)
- **Episode Identifier** (new)
- **Discovery View** (new — the grid + hero + filters experience)
- **Playback** (new — distinct from viewing an Episode Page)

These were introduced only when they rose to the level of stable domain language that future conversations or code comments could reference without ambiguity.

---

## Design Tree — Decisions Made (in dependency order)

### 1. Routing & Navigation Model
**Branch explored**: What does "its own page" mean in a static SPA with VPS static-file hosting?

**Options considered**:
- Pure in-memory view swap (no URL)
- Hash routing
- History API + clean paths (would require nginx config)
- Modal overlay
- Pre-rendered static files per episode

**Concrete scenarios used**:
- Direct link from Discord/Twitter/shared note
- Refresh on an episode URL
- Browser back/forward between list and episode
- Bookmarking a specific discussion

**Decision**: Hash-based client routing (`#/episode/<id>`).

**Rationale**:
- Zero changes to deploy pipeline or nginx.
- Gives real, shareable, refreshable, bookmarkable URLs immediately.
- Reversible later (can migrate to clean URLs without breaking existing links).
- Matches the low-stakes, new-site reality.

**Cross-reference**: `.github/workflows/deploy-live.yml:52-61` (static rsync only). No existing router.

**HITL required?** No.

---

### 2. Episode Identifier
**Branch explored**: What stable value addresses a specific Episode across reloads, reordering, and time?

**Options considered**:
- Array index (current code everywhere)
- `guid` (already parsed but unused)
- `link`
- Episode number + type + pubDate composite
- Title slug

**Concrete scenarios used**:
- New episodes published (array shifts)
- RSS provider changes sort order
- Future client-side sorting or "view oldest first"
- Shared link opened weeks later

**Decision**: Use the `guid` field already present in every parsed episode object as the canonical **Episode Identifier**.

**Rationale**:
- It is the standard stable identifier provided by the RSS feed.
- Already in the data model (`parseRSSText`, line 70).
- Survives every scenario above.
- No new parsing or normalization required.

**Cross-reference**: `src/main.js:69-70` (parsed but dead code until now). Index-based identification was the main source of fragility (`data-idx`, `currentEpisode`, `playEpisode(idx)`).

**HITL required?** No (user confirmed "guid" after exploration surfaced the field).

---

### 3. Primary Click Behavior on Cards (Navigation vs Playback)
**Branch explored**: Now that cards can target an Episode Page, what happens on click?

**Options considered**:
- Whole card → Episode Page (navigation primary)
- Whole card → Playback (current behavior preserved)
- Split zones / two distinct controls
- Play as primary + secondary "read" link

**Concrete scenarios used**:
- New visitor with no muscle memory
- Mobile fat-finger on small cards
- Listener who just wants quick audio vs reader who wants context first
- Keyboard/screen reader discoverability of both actions

**Decision**: 
- Primary surface of the card (art + title + meta) navigates to the Episode Page.
- A distinct, always-visible play control on the card triggers **Playback** in the sticky player without navigation.

**Rationale**:
- Directly fulfills the original request ("open that episode as its own page so we can read the description").
- Site is brand new ("we have no regular listeners from our webpage").
- Preserves quick-listen capability without forcing every play action through the page.
- Low cost to change later if listener habits emerge.

**Cross-reference**: `src/main.js:508-520` (current click handlers) and `427-455` (play logic). Hero latest card follows the same split.

**HITL required?** No (user explicitly accepted whole-card navigation given the new-site context).

---

### 4. Episode Page Composition & Site Shell
**Branch explored**: How much of the rest of the site remains when viewing an Episode Page?

**Options considered**:
- Full shell (nav + footer + sticky player) + replace main content area
- Focused/isolated reading mode (minimal chrome)
- Hybrid (hide hero/grid but keep nav + player)

**Concrete scenarios used**:
- Direct deep link from external share
- User wants to listen while reading the description
- User finishes reading and wants to browse other episodes easily
- Coherent branding on every view

**Decision**: Full site shell remains. Replace only the hero + episodes grid section with the Episode Page content. Sticky player, nav, and footer stay functional.

**Rationale**:
- User leaned toward keeping the full experience.
- Audio playback must remain available without jarring UI changes.
- New site benefits from consistent branding and easy escape hatches.
- Simplest implementation (reuse existing shell render, just swap one section).

**HITL required?** No.

---

### 5. URL / Hash Format
**Branch explored**: Exact shape of the addressable Episode Page route.

**Decision**: `#/episode/<guid>`

**Rationale**:
- Clear, readable, standard-ish.
- Easy to parse with a small router.
- Avoids collision with future sections or query strings.
- Guids are already URL-safe (no extra encoding needed beyond normal hash handling).

**Alternative considered**: `#ep-<guid>` (shorter). Rejected for readability.

**HITL required?** No.

---

### 6. Description Rendering Strategy
**Branch explored**: How to present the raw RSS `<description>` (which is HTML) on the Episode Page.

**Data legwork performed**:
- Real RSS samples fetched and inspected (multiple full episodes + trailers + bonuses).
- Pattern observed: heavy repetitive boilerplate at the end ("EXPERIENCE MOVIES WITH US!", social links, Patreon, hosts, email, subscribe CTAs).
- Some episodes contain useful timestamped sections at the top.
- Core prose lives in the middle, with light semantic markup (`<p>`, `<strong>`, occasional `<a>` and `<em>`).

**Decision**:
- Create a new `getCleanEpisodeDescription(ep)` helper (builds on existing `stripHtml` and `getShortDescription` logic).
- Strip the known boilerplate blocks aggressively.
- Render the cleaned HTML via `innerHTML` inside a well-styled prose container.
- Provide a small, collapsed "View original RSS description" disclosure for the raw, unfiltered content (useful for debugging or completeness).
- No external sanitizer library (keep zero deps).

**Rationale**:
- Matches the existing cleanup philosophy already in the codebase.
- Gives readers the actual discussion content without the repetitive footer spam.
- The disclosure satisfies the "complete" requirement without making the default view ugly.

**Cross-reference**: `src/main.js:112-130` (existing strip helpers) and the RSS samples (confirmed the boilerplate pattern across 6+ episodes).

**HITL required?** No.

---

### 7. Playback Initiation from the Episode Page
**Branch explored**: How does someone start listening once they are on the detail view?

**Decision**:
- Prominent "▶ Play Episode" button (styled with existing `.btn-primary` patterns) near the top of the Episode Page.
- Clicking it calls the existing `playEpisode()` logic (re-uses the sticky player).
- While playing, the sticky player remains the source of truth for controls/progress.
- No duplicate inline audio element on the page.

**Rationale**:
- Keeps the audio experience unified (one player for the whole site).
- Simple and consistent with the grid play controls.
- Avoids complexity of managing two audio elements.

**HITL required?** No.

---

### 8. Navigation Out of an Episode Page + State Preservation
**Branch explored**: How does the user return to the Discovery View?

**Decision**:
- Explicit "← All Episodes" link/button at the top of the Episode Page (clears hash and re-renders the main view).
- Browser back button works naturally via `hashchange` + `popstate` listeners.
- Best-effort preservation of search query, active filter, and scroll position on the grid when returning (stored in a small `listState` object before leaving).

**Rationale**:
- Explicit affordance is kinder than "just use the back button."
- State preservation reduces frustration on a content-heavy site.
- Still simple to implement in the existing global state model.

**HITL required?** No.

---

### 9. Deep Linking & Initial Load Behavior
**Branch explored**: What happens when someone loads the site directly on `#/episode/<guid>`?

**Decision**:
- `init()` still fetches RSS first (required for data).
- After fetch + render of shell, inspect `location.hash`.
- If it resolves to a valid episode guid, immediately render the Episode Page instead of the default hero + grid.
- Show the existing loader until RSS is ready.
- Update `document.title` to include the episode title for the duration of the view.

**Rationale**:
- Direct links must work on first load (core promise of addressable Episode Pages).
- Reuses the same data path; no extra network requests.
- Title updates improve tab readability and sharing previews.

**HITL required?** No.

---

### 10. Error & Edge Case Handling
**Branch explored**: What if the guid is invalid, missing, or the episode no longer exists in the feed?

**Decision**:
- Show a friendly "Episode not found" view with the episode identifier shown (for support), a "Back to all episodes" button, and suggestion to check the list.
- Log to console for debugging.
- Never crash the app.

**Rationale**:
- Guids can become stale if episodes are removed from the feed.
- Graceful degradation builds trust.

**HITL required?** No.

---

### 11. Technical Implementation Constraints (Self-Imposed)
- No new runtime dependencies (stays pure vanilla + Vite).
- All logic remains in `src/main.js` for now (consistent with current architecture).
- New CSS lives in `src/style.css` using existing design tokens.
- No change to the RSS fetch or parsing layer (only consumption of already-parsed `guid` and `description`).
- Accessibility: ensure focus is managed when swapping views; play buttons have proper labels.

**HITL required?** No.

---

### 12. Future Evolution Notes (Not Implemented Now)
- Episode Page could later show "previous/next episode" navigation (using array position as a convenience, not as an identifier).
- Could add share buttons that copy the canonical Episode Page URL.
- Could support open-graph / social preview cards per episode (would require server or build-time work).
- If clean URLs become desirable later, the hash format can be migrated without breaking old links.
- If descriptions grow very long, a "jump to timestamps" or collapsible sections UI could be added.

These were explicitly left out of the current scope.

---

## Items That Would Have Required HITL (None Found in This Session)

After walking every branch with concrete scenarios, code cross-references, and the existing domain language, **no decisions remained that required human input** under the "not tremendously opinionated" directive.

All choices were either:
- Directly confirmed by prior answers, or
- Low-risk, reversible defaults that follow the spirit of the existing codebase and the new-site reality.

If the user later decides any of the following matter more than the defaults chosen, they can be revisited with low cost:
- Exact visual treatment / typography scale on the Episode Page prose
- Whether to persist list state across sessions (localStorage)
- Adding social share buttons on the Episode Page
- Eventually moving to clean URLs + nginx config

---

## Summary of Changes That Will Be Made

When implementation begins, the following will occur (all captured above):
- Small hash router + `handleRouteChange` + `hashchange`/`popstate` listeners.
- `renderEpisodePage(guid)` that produces focused content inside the existing shell.
- Play control split on cards + hero.
- New description cleaning helper + disclosure for raw view.
- Title updates, back link, error state, deep-link support on init.
- Minimal new CSS for the prose container and episode header.
- All existing playback, search, and filter logic remains untouched and reusable.

The feature can be delivered incrementally with the existing `render()` + event binding patterns.

---

**End of autonomous grill session.**  
All decisions documented. Ready for implementation or further review.
