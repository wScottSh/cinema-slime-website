# Essay Page: The Projection

**Date**: 2026-09-30
**Status**: accepted
**Amends**: ADR 0009 (the Essay Page now uses the cover cascade, not the brand mark)
**Context**: [ADR 0011](0011-above-the-fold-foreground.md) rebuilt the fold into a paste-up and [ADR 0012](0012-below-the-fold-marquee-board.md) rebuilt the bottom into a marquee board. The Essay Page was left in the original register. This ADR records what it became. Settled in one `/prototype` round; the exploration is preserved on branch `prototype/essay-reader`.

---

## Context / problem

The Essay Page still used the original site's look: a rounded `--bg-card` box with a hairline border around the body, a small 16:7 cover band, a 2rem title and a green back link. Every other surface had moved on. The fold has torn paper, stencils and a red offset shadow on display type, and the bottom has the lit board. The Essay Page is the only place a reader spends minutes rather than seconds, and it looked like a different, older site.

## Decisions

### 1. The cover is the screen

The Essay's cover goes full-bleed at the top of the page (`min(88vh, 820px)`), lit like a projection. The top is dimmed under the nav, there is a vignette, a red bloom sits behind the title, and the foot fades into the page. Sprocket strips run down both edges. The title sits across the bottom of the screen in the display face at up to 7.5rem, with the fold's red offset shadow and green `ESSAY` stencil.

Two alternatives were built and compared (see the prototype branch):

- **Paste-up wall.** A torn header panel with the cover taped up as a print, and the body on a torn dark sheet. Rejected: it repeated the fold instead of giving the reader somewhere new, and the torn sheet made a long read feel boxed in.
- **Marquee board.** The lit board as a title card, with a centered column. Rejected: it spends the warm light that ADR 0012 §3 reserves for the bottom third.

The paste-up's **rail** was kept (§2).

### 2. Meta lives in a rail beside the text, taken from the paste-up

Back link, Cinema Slime Name, date, read time and social proof sit in a narrow rail left of the reading column. The rail sticks while you scroll. It uses the paste-up's labels: display-face keys, and the red season-tag chip for the byline. The rail is the only home for this meta, so the screen carries no meta row.

Below 980px (the site's stacking breakpoint, as in ADRs 0011/0012) the rail lays flat above the text.

### 3. The text sits on the void, with no box

The body has no card, border or radius. It is a 66ch column at 1.14rem/1.9. The first paragraph is set larger as a lead. Headings are numbered `REEL 01`, `REEL 02`… in slime green over display type with the red offset. Blockquotes become display-face pull quotes, and they and images hang 3rem into the gutter. `<hr>` is a row of sprocket holes. The page ends on an `END OF REEL` slate.

### 4. The screen uses the cover cascade; the brand mark is retired from the page

Full-bleed, the old brand-mark fallback (a small square disc centered in a box) cannot fill a screen. The screen therefore uses the Discovery cards' cascade from ADR 0009: `image` tag, then the first body image, then the generated film leader. The film leader is always rendered under the cover, so a cover that 404s removes itself and shows the leader. `BRAND_MARK_URL` is gone from `src/essay-header.js`. `public/cs-logo-sm.png` stays, since ADR 0011 names it for future square-mark surfaces.

## Consequences

- `src/essay-header.js` now exports three pure builders: `buildEssayHeaderHtml` (the screen), `buildEssayRailHtml` and `buildEssayDeckHtml`, plus `readingMinutes`. They keep the colocated `node --test` pattern.
- The Essay Page renders the grunge `<defs>` (`buildGrungeFiltersHtml`) because the stencil kicker uses `#grunge-ink`. The loading and not-found shells do not render the screen, so they do not need them.
- Going full-bleed exposed a bug that was already on main: the leader's `CINEMA SLIME` mark (which has its own `z-index`) painted over cover images on every surface, including the Discovery cards and hero flyer. `.essay-cover-leader` is now its own stacking context (`z-index: 0`), which fixes it everywhere.
- When the cover comes from the body's first image, that image appears twice: once on the screen and again at the top of the text.
- The loading and not-found states still use the old `.episode-page` shell.
