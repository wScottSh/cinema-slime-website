# Episode Page: The Ransom Note

**Date**: 2026-09-30
**Status**: accepted
**Amends**: ADR 0001 (the Episode Page's layout; its routing and identity decisions stand)
**Context**: [ADR 0011](0011-above-the-fold-foreground.md) rebuilt the fold into a paste-up, [ADR 0012](0012-below-the-fold-marquee-board.md) rebuilt the bottom into a marquee board, and [ADR 0018](0018-essay-page-projection.md) rebuilt the Essay Page into a projection. The Episode Page was the last surface still in the original style. Settled over five `/prototype` rounds; the exploration is preserved on branch `prototype/episode-page`.

---

## Context / problem

The Episode Page still used the original site's look: a 220px rounded image, a pill Play button, a 2rem title, and the whole description in a rounded `--bg-card` box, with the timestamps shown as a green list. Every other surface had moved on.

The description has a shape every week, and the old page ignored it: an opening line from the film, a list of timestamps, a bold billing line (`RENN'S PICK x DAD-TEMBER`) and a synopsis. It rendered all of this as one undifferentiated block.

## Decisions

### 1. The top is a ransom note, not a copy of the fold

The page keeps the fold's paste-up toolkit (torn paper, halftone, grain, tape, the polaroid, the stencil, the red chip, the chewed Play button) but rearranges it so it does not read as the fold again. The torn panel of the Episode's own blurred art is tilted and offset right. The polaroid is small and taped off the panel's top-left corner at a steep angle. The title is cut into strips of mismatched paper stock, each at its own angle and size, like a ransom note.

The strips flow in rows and wrap only when the width runs out; one strip per line read as a stack. Titles of 30 characters or fewer are cut bigger so they still fill the panel.

The panel hugs its content: it is as tall as the copy or the polaroid, whichever is taller, and the copy is centered in it. A fixed height left sparse Episodes (short title, no billing) in an empty box.

Alternatives built and compared (see the prototype branch):

- **Projection** (the Essay Page's frame, adapted for square art). Rejected outright.
- **The fold's panel reused whole**, with the notes as scraps below. The register was right but it read as a copy of the homepage. This round set the direction; rounds 2–5 kept its lower half.
- **Flipped** (title on the wall, polaroid right) and **Banner** (a low torn strip with the polaroid hanging off it). Both were less fresh than the ransom note.

### 2. Ransom stock is scattered, never cycled

Cycling cream/black/red in turn made long titles read as a flag. Each strip's stock, angle, lift and size are drawn from a PRNG seeded by the title, so every Episode looks different and each one looks the same on every load. The draw is weighted: mostly cream and newsprint, some black, and red as the accent. There is at most one red strip (two on titles of seven or more strips), never two reds touching, and a title of three or more strips always gets one red. No stock runs three strips in a row.

### 3. The billing is its own tag

The bold `X x Y` line is pulled out as the billing: the label on a taped cream strip, the theme on a lit green strip. It covers picks (`HARRISON'S PICK x DAD-TEMBER`) and other billing (`Week 2 DEEP DIVE x Deep Roy`). A pick written backwards (`… X Renn's Pick`) is swapped. A pick billed alone (`RENN'S PICK`, as in older Episodes) is a label with no theme. With no billing, the tag falls back to the `Now showing` stencil.

### 4. Chapters are frames on a film strip, and a frame plays from there

The timestamps become **Chapters**, shown as frames on a single sprocketed film strip taped across the wall. Each frame is as wide as its share of the runtime. The last Chapter runs to the Episode's duration; if the duration is unknown it is drawn at the average width of the others.

Every frame is a button that starts the Episode at that Chapter. The page says so explicitly: a cream label above the strip reads "Click any frame to jump straight to that part" ("Tap" on touch screens), and each frame has a play dot that lights on hover and keyboard focus. Stacked below 980px, the strip scrolls sideways at a fixed frame width.

### 5. The quote and the synopsis are scraps below

The film quote goes on a taped cream strip. The synopsis goes on a dark torn flyer labelled `The film`. A description that doesn't follow the pattern keeps all its content on the flyer, labelled `Show notes`. The original RSS description stays one click away.

## Consequences

- New `src/episode-notes.js` (`parseShowNotes`, `toSeconds`) parses the description into quote, Chapters, billing and prose. It is pure string handling with no DOM, so it runs under `node --test`. It reads the timestamp forms the feed actually carries: `(5:40) X`, `( 1:19:25 ) X`, `(27:20 )X` and `X (6:40)`. It reads a quote in italic, or in bold when it opens with a quote mark. Anything it doesn't recognize falls through to prose unchanged. Across the 84 Episodes in the feed at the time of writing, no timestamp is left in the prose.
- New `src/episode-page.js` exports pure builders (`buildEpisodeTopHtml`, `buildEpisodeReelHtml`, `buildEpisodeLowerHtml`) plus `ransomStrips` and `runtimeLabel`. They follow the colocated `node --test` pattern.
- `createPlayback` gains `playFrom(idx, seconds)`. A fresh source can't take a position until its metadata has loaded, so the position is held until `loadedmetadata`; a source that is already loaded jumps immediately. A plain `play()` clears any held position.
- `ARTWORK_WIDTH.POSTER` (640) names the Episode Page polaroid's slot.
- The Episode Page renders the grunge `<defs>` (`buildGrungeFiltersHtml`) for the torn edges and the chewed Play button.
- The old `.episode-header/-art/-meta/-label/-title/-date/-content/-description` rules are gone. `.episode-page` and `.back-link` remain for the Episode-not-found state and the Essay loading/unavailable states, which still use the old shell (as ADR 0018 left them).
- The parse depends on the hosts' formatting habits. A new habit (a different billing shape, say) degrades to prose rather than breaking the page, but it won't be staged until the parser learns it.
