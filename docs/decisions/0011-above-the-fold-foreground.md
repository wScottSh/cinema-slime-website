# Above-the-Fold Foreground

**Date**: 2026-07-25
**Status**: accepted
**Context**: [ADR 0010](0010-hero-background-film-reel.md) reworked the Discovery View's above-the-fold *background* into a drifting film reel. This ADR is its companion: it records what the *foreground* on top of that background became, and why. Settled over three `/prototype` rounds; the exploration is preserved on branch `prototype/above-fold-round3`.

---

## Context / problem

Two things broke the old foreground at once.

1. **The film reel made the cards read as mush.** The hero's Episode and Essay cards were translucent panels (`rgba(22,22,22,0.85)` + `backdrop-filter: blur`) designed to float over a flat, dim background. Once the background became a moving reel of artwork, a translucent card over moving artwork has no edge — the content and the background competed and both lost.

2. **The brand mark changed.** `cs-logo.png` was a square disc mark, so the hero needed a typed `CINEMA / SLIME` `<h1>` beside it to say the name. The new logo sheet *is* the wordmark (plus a drippy eye), which made the typed headline a second, worse copy of the same information.

Two smaller problems came along for the ride:

3. The hero showed `EPISODE 10` beside `70 EPISODES AND COUNTING`. Those are conflicting readings of the same catalogue — the podcast is on Season 2, Episode 10, of a 70-strong back catalogue, and the two numbers together read as broken data.
4. The hero tagline and hosts line were generic marketing copy, out of register with the voice used everywhere else on the site.

---

## Decisions

### 1. Exactly one Episode and one Essay above the fold

The fold presents **one** latest Episode and **one** latest Essay. Never a row of either.

Rows were tried and rejected outright. Two or more of anything reads as a grid, and a grid has no hierarchy — the fold's entire job is to say "here is the newest thing, and here is the newest piece of writing", which a row actively destroys. The full collections already live in the sections below; the fold is not a second, worse index of them.

Consequence for the code: the Episode and the Essay are **one composed block**, not two independent slots. `src/essay-spotlight.js` (a separate builder patched into a separate `#hero-essay-spotlight` div) is gone, folded into `src/hero-marquee.js`, and both are patched through the single `refreshHeroDynamic()` path when fresh data arrives.

### 2. The Episode's artwork is the panel — opaque, not a card

The Episode's own cover art, blurred, blown out and bled edge to edge, **is** the panel: opaque art punching through the reel rather than a translucent card floating on it. The unblurred artwork sits on top of it as a taped-up square print.

Episode artwork is always 1:1 and **must never be cropped**. The square therefore goes on the `<img>` (`aspect-ratio: 1; object-fit: contain`) and not on the bordered frame — with `box-sizing: border-box` an `aspect-ratio: 1` frame leaves a non-square hole, which crops the art.

### 3. The logo is a sticker, and there is no typed wordmark

The nav bar drops the logo mark and keeps the wordmark **text**. The hero drops the typed `CINEMA / SLIME` `<h1>` entirely. The full logo image carries the name, slapped over the top-right as a rotated sticker, dripping down so its bottom crosses the Episode title's **first line**.

The sticker is **allowed to cover words**. That is the point of the treatment — the covered text stays inferable, and the overlap is what makes it read as a sticker on a poster rather than a mark placed politely above one. There is no separate eye stamp: the eye is part of the logo sheet, so placing one alongside duplicated it.

### 4. Grunge is CSS and SVG filters only — no new image assets

The paste-up register (torn paper, tape, halftone, photocopier grain) is built **entirely from CSS and inline SVG filters**. No new image assets enter the repo for it. This is a standing constraint, not an implementation detail: texture assets are the kind of thing that multiplies, goes stale against a palette change, and has to be re-exported per breakpoint.

The toolkit:

| Effect | How |
|---|---|
| Torn edge | `feTurbulence` → `feGaussianBlur` → `feDisplacementMap` on a **paper layer**, never on type |
| Ink bleed | the same filter at ~2px amplitude, on small type only |
| Tape | rotated translucent pseudo-elements with a hard shadow and a striped mask |
| Halftone | `repeating radial-gradient` dots in `multiply` |
| Grain | `feTurbulence` + desaturate, generated so it has no tiling seam |

Two things are load-bearing and were each arrived at the hard way:

- **The displacement is applied to a paper layer *beneath* the type, never to the type.** Displacing text destroys its legibility at any amplitude worth seeing.
- **`clip-path` polygon tears are rejected by name.** A polygon zigzag repeats and reads as hand-cut construction paper — "a kid with scissors". Fractal noise is non-repeating and fine-grained, which is what reads as *torn*.

### 5. The brand identifies an Episode by season, not by raw number

The fold surfaces **`S2 · E10`**, and demotes the catalogue count to **"70 episodes deep"**. This is a domain change, not a styling one — season is now part of how the brand identifies an Episode above the fold — so `CONTEXT.md`'s **Episode** entry gains season alongside episode number and type.

The season tag is deliberately the one element in the panel that gets **no** grunge filter: it is data, and warping it costs more legibility than the grime buys.

### 6. Copy rewritten in-voice, drawn from what already exists

The tagline and hosts line are replaced with a deck and sub drawn from the voice already on the About section ("film obsession gets gloriously messy", "no genre is safe from the slime treatment") rather than invented. The hosts line is dropped from the fold; it still lives in About.

---

## Consequences

- The fold has a hierarchy again: one Episode, one Essay, and a mark big enough to be the brand rather than a badge.
- The reel background can be as busy as it likes without eating the foreground, because the foreground is now opaque.
- No new image assets, and the whole treatment re-colours with the palette because it is filters and gradients over brand tokens.
- `src/essay-spotlight.js` and its tests are removed; `src/hero-marquee.js` and its tests replace them. The pure-builder / colocated-`node --test` pattern from `essay-card.js` is preserved.
- The SVG `<defs>` are a new global-ish dependency: `filter: url(#…)` resolves only if the ids are in the document. They render with the hero shell (outside `#hero-dynamic`) so they appear exactly once and survive its re-renders. Anything else wanting these filters must not assume they exist off the Discovery View.
- Three traps are now written into the code comments because each cost a prototype round: `filter` blockifies a flex item (the inline-block stencil needs `align-self: flex-start`); the turbulence must be blurred before it is displaced or edges stair-step; and the sticker must be anchored to the panel's top edge and pulled up by its own height, never by a fixed `rem` offset.
- The marquee stacks at **980px**, ahead of the site's 900px breakpoint, because the poster and copy columns start fighting for width well before the nav needs to collapse. Below that the deck must be re-ordered (`order: -1`) since it is absolutely positioned on desktop, and the panel must reserve bottom padding or the Essay flyer lands on the Play button.
- Verifying phone widths by resizing the OS window is unreliable — it will not go below ~500px. Narrow widths were checked through an iframe harness.
- The throwaway `/prototype` exploration (five round-1 variants → one-Episode/one-Essay round 2 → the sticker slap of round 3) is preserved as a primary source on branch `prototype/above-fold-round3`, out of `main`.
