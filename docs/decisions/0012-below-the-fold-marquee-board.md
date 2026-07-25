# Below the Fold: The Marquee Board

**Date**: 2026-07-25
**Status**: accepted
**Context**: [ADR 0011](0011-above-the-fold-foreground.md) rebuilt the Discovery View's *foreground* into a back-alley paste-up. This ADR is its companion at the other end of the page: it records what About Cinema Slime, Subscribe & Follow, and the footer became, and why. Settled over one `/prototype` round; the exploration is preserved on branch `prototype/bottom-of-site`.

---

## Context / problem

The fold was rebuilt. The bottom of the page was not, and it showed.

About, Subscribe and the footer were still the original site's register: rounded cards on `--bg-card` with `--border-subtle` hairlines, a centered `label / TITLE / red divider` header stack repeated three times, 50px-radius pill buttons, and a `translateY(-2px)` lift on every hover. None of that vocabulary survives above the fold any more. Scrolling past the Essays grid, the page stopped being one object and became two websites stacked on each other.

Three smaller problems came with it:

1. **The header stack was the loudest tell.** Three identical centered `label / TITLE / divider` blocks in a row is a template, not a design. The fold has no such stack.
2. **The eight platform links were the least interesting thing on the page** despite being the section with a call to action in its name — eight identical grey rounded rectangles.
3. **The footer carried no brand weight.** Centered text on `--bg-surface` with a hairline top border is the default footer of any site.

---

## Decisions

### 1. The three bottom sections are one object

About, Subscribe and the footer share a single frame: the same bulb rail, the same board edge, the same light. They are not three sections that happen to sit near each other. That shared frame is what stops the bottom reading as a stack of unrelated widgets, and it is why the CSS for all three lives in one block in `style.css` and the markup in one module, `src/site-bottom.js`.

### 2. The register is the theatre out front, not more back alley

The fold is the flyposted wall beside the cinema. The bottom is the **marquee** — the lit board over the entrance. It is the same world, one step toward the building: chasing bulb rails, a lit board carrying the copy, the hosts as a *bill of players*, the platforms as **letters slotted into a marquee track**, and the copyright as a **box-office card**.

This was chosen over three alternatives, all built and compared (see the prototype branch):

- **Back alley wall** — the fold's own paste-up continued: torn broadsheet, taped polaroid crew cards, ticket-stub links. Rejected as *more of the same*: it made the page one long note with no arrival at the end.
- **Photocopied zine** — a light, xeroxed sheet inverting the ground. Rejected: a genuine option, but it fought the fold for attention rather than closing behind it.
- **End credits** — no panels at all, right-aligned role labels against left-aligned names. Rejected: correct instinct, too quiet to carry the calls to action.

The marquee wins because it does what the bottom of a page has to do — **close the page** — while staying inside the same fiction as the fold.

### 3. Warm light is the bottom's signal, and it is used nowhere else

The board is lit in `#ffe29e`. This is the only warm hue on a site that is otherwise cold slime green and cinema red, and it is deliberately reserved for the bottom third. The green and red keep their existing jobs (the stencil kicker stays green, the host roles stay red) so the bottom still reads as Cinema Slime rather than as a different palette.

### 4. The centered header stack is gone

Headings sit **left**, in the display face, with the hard red offset shadow the fold uses. The `section-label / section-title / section-divider` trio survives only in the Episodes and Essays sections, which are indexes and legitimately want a centered marker.

### 5. The footer depends on no SVG filter

The footer renders on the Episode and Essay pages too, where the hero's grunge `<defs>` are **not** in the document — a `filter: url(#…)` there resolves to nothing and silently drops the element's paint. The footer is therefore built from gradients and borders only.

The About section's kicker does use the fold's `#grunge-ink` via `.hero-stencil`, which is safe because About only ever renders on the Discovery View, where the hero's `<defs>` are present.

### 6. Grunge stays CSS-only, and the sticker still hangs off the edge

ADR 0011 decision 4 (no image assets for texture) holds: the halftone is a `repeating radial-gradient`, the bulbs are a `radial-gradient` whose `background-position` animates, and the board face is a stack of gradients.

The logo is pasted on the board's bottom-right corner and is allowed to hang over its edge, the same move the fold's sticker makes. The **section**, not the board, is what clips — clipping at the board would cut the drip off, and not clipping at all would open a horizontal scrollbar on narrow viewports.

---

## Consequences

- The page reads as one object end to end. The fold opens it, the marquee closes it.
- `.about-grid`, `.host-card`, `.subscribe-section`, `.subscribe-link` and the old `.footer-*` rules are deleted. The stylesheet still grows by ~4 kB uncompressed: the bottom gains real detail, and reusing the fold's vocabulary offsets only part of that.
- The bottom's markup moves out of `main.js` into `src/site-bottom.js` as pure builders, and gains unit tests — including that `#about` and `#subscribe` keep the ids the nav scroll-links depend on.
- The hosts and the contact address are static content inside that module. If they ever need to change per-deploy, that is a new decision, not an oversight of this one.
