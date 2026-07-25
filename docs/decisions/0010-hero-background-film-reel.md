# Hero Background Film Reel

**Date**: 2026-07-25
**Status**: accepted
**Supersedes**: [ADR 0004](0004-hero-bg-tile-wrappers-and-enhancement.md) (Hero Background Tile Wrappers and Post-Render Enhancement)
**Context**: The Discovery View above-the-fold background was reworked from a static tiled grid of Episode artwork into a slowly-drifting, perspective-tilted film reel. This ADR records why, and the structural choices that keep the change small and reversible.

---

## Context / problem

The original hero background (ADR 0004) tiled Episode artwork across the viewport and faded each tile in independently over ~2s (`blur(20px)→blur(2px)` + opacity) as its image decoded. Two things made that design no longer fit:

1. **The load choreography became noise.** The per-tile fade was designed for the "always fresh from RSS, staggered arrival" world of ADR 0004 §3. [ADR 0006](0006-runtime-data-fetch-with-edge-cache-and-swr.md) then introduced an edge cache + SWR, so on the common warm path artwork is available immediately — the slow per-tile reveal now reads as distracting motion rather than a graceful cover for slow loads.
2. **The grid cut off abruptly.** The tile field was computed once from `window.innerWidth/innerHeight` at render, with no resize handling and no edge treatment. The partial last row/column hard-cut against the void, a hero taller than the viewport ran short at the bottom, and resizing never refilled.

Separately, the background read as *flat* — a wall of thumbnails with no depth, thematically inert for a cinema podcast.

The same two hard constraints from ADR 0004 still applied: the codebase is intentionally vanilla JS + a single `main.js` (no virtual DOM, no component model), and the optimization must be client-side presentation only, adding no runtime dependencies.

---

## Decisions

### 1. A film reel, not a grid — on-brand depth

Episode cover artwork is arranged as **frames in film strips**: each cover is one square (1:1) cell with a film-base gutter (the frame line) and sprocket-hole perforations down the strip edges. Strips are tilted in 3D perspective and drift very slowly, so the artwork recedes toward a vanishing point like film running through a projector. This gives the background depth and ties it to the cinema theme (it rhymes with the **Film Leader** concept in `CONTEXT.md`, though it is a distinct decorative texture, not that concept).

The reel is deliberately **knocked back** — dim (`opacity ~0.32`), softened (`blur ~2.2px`), behind a projector-beam vignette — and drifts glacially (~16-minute loop). It is ambient background, never the focus.

### 2. Whole-layer reveal replaces per-tile fade

`revealHeroReel(root)` in `src/hero-reel-reveal.js` waits for the first few frames to `decode()`, then fades the **entire layer** in as one unit via a `.reel-loaded` class (with a timeout fallback so a slow/broken/offscreen `decode()` can never leave the layer hidden — `Promise.allSettled` swallows rejections). This keeps ADR 0004 decision 2's structure — a small, idempotent post-render enhancement called from the same slot as `bindEvents()` / `observeAnimations()` — while dropping the now-unnecessary per-tile choreography and the per-tile `dataset` bookkeeping it required. Idempotency now lives on the layer (`dataset.reelRevealed`), so hash-back re-renders and resize rebuilds never re-trigger the fade.

### 3. Viewport-aligned mask + inner tilted canvas — edges never hard-cut

The background layer (`.hero-reel-layer`) is the **viewport-aligned frame**: it carries a radial feather mask so the artwork dissolves into the void on every edge. The tilt lives on an **inner** oversized canvas (`.hero-reel`, ~190%×240%, `OVERFILL` in `src/hero-reel.js`), so rotating/perspective-transforming it can never uncover a corner of the masked frame. This structurally fixes the abrupt right/bottom cutoff regardless of aspect ratio or tilt.

### 4. Rebuild to the hero's actual height, on render and on resize

`renderHero` stays a dumb renderer: it emits an **empty** `.hero-reel-layer` and returns. `rebuildHeroReel()` (main.js) then fills it via `innerHTML`, sizing the reel to `hero.offsetHeight` (the real rendered height, not just the viewport) so it never runs short at the bottom. A single debounced `resize` listener, registered once in `init()`, calls `rebuildHeroReel()` again — the missing piece that made the old grid cut off on resize. The shuffled Episode order is cached (`heroReelOrder`) and reshuffled only when the Episode count changes, so a resize does not reshuffle the artwork.

Pure/imperative split from ADR 0004 is preserved: `src/hero-reel.js` builds the markup as a **pure** function (no imports, no `Math.random()`, deterministic dark-fill cycling by frame index; the shuffle is applied at the call site), and `src/hero-reel-reveal.js` remains the side-effectful post-render DOM glue.

### 5. Small / reviewable / reversible — no new dependencies

The change renames `hero-bg-tiles.js` → `hero-reel.js` and `hero-bg-reveal.js` → `hero-reel-reveal.js`, rewrites the hero-background CSS, and touches a handful of `main.js` call sites. Zero new `package.json` dependencies; no changes to `vite.config.js`, the deploy workflow, or nginx. The presentation-only, always-fresh-artwork discipline of ADR 0004 §5 carries over unchanged. Computable logic is covered by `node --test` (`hero-reel.test.js`, `hero-reel-reveal.test.js`).

---

## Consequences

- The above-the-fold background reads as an intentional, on-brand film reel with depth, instead of a flat grid that popped in tile-by-tile and hard-cut at the edges.
- The load is calm on the warm-cache common path (one whole-layer fade) and still degrades gracefully with no artwork (dark placeholder frames, tested).
- Edges feather into the void and refill on resize; the reel always covers the real hero height.
- `prefers-reduced-motion` is honored: no drift, no fade.
- ADR 0004 is superseded; its tile-specific mechanisms are historical. The "dumb renderer" pattern and presentation-only discipline it established live on in the reel.
- The full throwaway `/prototype` exploration (load/edge grids → rotated depth riffs → four film-reel treatments; winner F4) is preserved as a primary source on branch `prototype/hero-bg-reel`, out of `main`.
