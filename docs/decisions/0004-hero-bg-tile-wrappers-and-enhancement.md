# Hero Background Tile Wrappers and Post-Render Enhancement Function

**Date**: 2026-06-02
**Status**: accepted
**Context**: Implementing issues #39 and #40 of PRD #20 — Hero Background Tile Placeholders for Smooth Cold-Start Discovery View. This ADR records why the hero background tiles received wrapper markup and an idempotent post-render enhancement function, while every other Episode image on the site did not.

---

## Context / problem

The Discovery View hero background renders 30–60 `<img class="hero-bg-tile">` elements sourced live from the RSS feed on every cold load. These images arrive at staggered, unpredictable times, producing visible pop-in across the tiled background while the rest of the hero paints. The fix had to respect two hard constraints:

1. **"Dumb renderer" invariant** — all Episode artwork URLs come from the live RSS parse on every load; nothing is server-cached or pre-fetched. The optimization must be 100 % client-side presentation only.
2. **Architectural simplicity** — the codebase is intentionally vanilla JS + single `main.js`. No virtual DOM, no component model, no new runtime dependencies.

---

## Decisions

### 1. Wrapper markup only for hero background tiles — not for any other Episode imagery

The `<img class="hero-bg-tile">` elements were promoted from bare `<img>` tags to a thin wrapper structure:

```html
<div class="hero-bg-tile-wrap">
  <div class="hero-bg-tile-placeholder" style="background:${darkFill}"></div>
  <img class="hero-bg-tile" src="${src}">
</div>
```

**Why only the hero background?**

All other Episode images on the site — episode cards in the grid, the hero-latest artwork, Episode Page art, sticky player art — are primary content elements that appear once per episode in a contextual UI component. Their load timing is either fast enough not to matter (small thumbnails in cards) or their container already has appropriate loading states. They are not decorative background texture.

The hero background is different in kind: it is a large field of purely decorative tile imagery whose only function is to create ambient visual texture during cold load. The cold-start experience for this specific element is deliberately degraded by the "always fresh from RSS" invariant — artwork URLs are not known until RSS parsing completes. Introducing a local, instant dark-fill placeholder for these tiles is the minimum intervention that solves the visual problem without touching any other image rendering path.

Limiting wrappers to `.hero-bg-tile` elements makes the scope change reviewable and reversible at low cost. All other image rendering paths remain untouched.

**The wrapper structure is pure string templating** — the same `renderHero` function that was already filtering, shuffling, and cycling episode thumbnails simply emits the new HTML. No virtual DOM, no component abstraction, no new module needed for markup alone.

**Cross-reference**: `src/hero-bg-tiles.js` — `buildHeroBgTileDescriptors()` returns `{src, darkFill}` descriptors consumed by `renderHero` to produce the wrapper markup.

---

### 2. Small idempotent post-render enhancement function — follows the established `bindEvents` / `observeAnimations` / `applyFilters` pattern

`revealHeroBgTiles(root)` in `src/hero-bg-reveal.js` wires the decode-and-reveal pass after the `render()` call settles the DOM. Its call site in `main.js` sits in the same position as `bindEvents()` and `observeAnimations()`:

```js
render(state);
bindEvents();
observeAnimations();
revealHeroBgTiles();  // ← new, same pattern
```

**Why a separate enhancement function instead of inline logic in `renderHero`?**

`renderHero` (and `render()` broadly) is a "dumb renderer": it emits markup and returns. It has no knowledge of the DOM lifecycle after the string is injected into the page. Wiring `img.decode()` promises requires the img elements to already exist in the live document — this is inherently a post-render, imperative concern.

The established pattern in this codebase is to keep `render()` purely functional (string → DOM injection) and collect all post-render DOM wiring in small, focused enhancement functions called immediately after. `bindEvents()` re-attaches all click/submit/input listeners. `observeAnimations()` sets up IntersectionObserver for card entrance animations. `revealHeroBgTiles()` wires the decode pass for hero tiles. Each function is independently legible and testable.

**Why idempotent?**

The Discovery View re-renders on hash navigation (back from an Episode Page). `revealHeroBgTiles()` is called on every `render()`, so it must be safe to call on a DOM that includes tiles that were already wired on a previous render. The `dataset.revealWired = '1'` marker on each `<img>` achieves this: an already-wired tile is skipped, so `decode()` is called exactly once per img lifetime and no double-listeners or double-promise chains accumulate.

**Why `img.decode()` rather than the `load` event?**

`decode()` resolves only after the browser confirms full pixel decode — the image is safe to paint with no partial or broken content. The `load` event fires when the network transfer completes, but the browser may not yet have decoded the pixels. Using `decode()` means `.loaded` (and thus the CSS fade-in) is added only when the artwork will render cleanly. Rejection (failed or missing image) is silently swallowed; the tile keeps its dark placeholder indefinitely, which is the correct degraded state.

**Cross-reference**: `src/hero-bg-reveal.js`.

---

### 3. "Always real-time fresh on every refresh, nothing server-cached" invariant is preserved

The dark placeholder fills are generated entirely from existing design tokens (`--bg-void` through mid-card greys, hex range `#0a0a0a`–`#222222`) at render time inside the existing tile generation loop. No new network requests. No data URIs for fetched assets. No service worker, IndexedDB, or in-memory blob cache.

The artwork URLs themselves still come from the live RSS parse on every cold load, exactly as before. The optimization layer is 100 % client-side presentation: it makes the wait for those images feel intentional (stable dark texture) and progressive (per-tile independent reveal as each decodes), without ever knowing or caching any image URL ahead of time.

The varied dark-fill cycling (stride 5, coprime to 8 fills — giving a full permutation per 8 tiles with no stripes) is deterministic given tile index, requiring no `Math.random()` and keeping `buildHeroBgTileDescriptors()` a pure function. The shuffle of episode images is applied at the call site in `renderHero`, not inside the descriptor generator, for the same reason.

---

### 4. Future extraction boundary — pure tile-descriptor generation

`buildHeroBgTileDescriptors(episodes, viewport, showArt)` in `src/hero-bg-tiles.js` already forms a natural extraction boundary: given the current Episodes array and viewport dimensions, it returns a list of `{src, darkFill}` descriptors with no DOM, no randomness, and no side effects. This function is already independently tested (15 unit tests via `node --test`).

Per the precedent in `decisions/0001-episode-pages.md` (all logic stays in `main.js` for now), the descriptor generator was extracted into its own module immediately because its purity made it trivially testable — but it is consumed directly by `renderHero` without any additional abstraction. If the hero background tile system grows (additional tile shapes, alternate fill strategies, responsive tile-size breakpoints), this module forms the natural boundary for a deeper `HeroBackgroundTileSet`-style pure module with a stable, well-typed interface.

The imperative enhancement pass (`revealHeroBgTiles`) will remain DOM glue regardless of how the descriptor layer evolves — its responsibility is fundamentally different (post-render, async, side-effectful) and should not be folded into the pure generator.

---

### 5. No new runtime dependencies, no build-pipeline changes, no deployment changes — small / reviewable / reversible

The implementation added:
- `src/hero-bg-tiles.js` — pure descriptor generator, no imports
- `src/hero-bg-reveal.js` — idempotent post-render function, no imports
- CSS additions in `src/style.css` — new rules under `.hero-bg-tile-wrap`, `.hero-bg-tile-placeholder`, `.hero-bg-tile.loaded`, and a `prefers-reduced-motion` override
- Small call sites in `main.js` for `buildHeroBgTileDescriptors()` and `revealHeroBgTiles()`

Zero new `package.json` dependencies. Zero changes to `vite.config.js`, the deploy workflow (`.github/workflows/deploy-live.yml`), or nginx configuration. The feature can be reverted by removing the two new modules, the CSS additions, and the two call sites — no migration, no coordination with infrastructure.

---

## Consequences

- Cold-load visual quality for the hero background is substantially improved: visitors see an instant, stable field of varied dark tiles on first paint, followed by per-tile independent fuzzy-reveals as artworks decode.
- Markup for hero background tiles is slightly richer (wrapper + placeholder sibling) but remains pure string templating with no new abstractions.
- The "dumb renderer" pattern and the "always fresh from RSS" invariant are preserved intact.
- All other image rendering paths (cards, hero-latest art, Episode Page art, sticky player art) are completely unaffected.
- 24 new unit tests (15 for descriptor generation, 9 for the reveal function) cover the computable logic. CSS transitions and visual QA remain manual/browser-based concerns per PRD testing decisions.
- The feature is small, self-contained, and reversible with low cost if the aesthetic direction changes.
