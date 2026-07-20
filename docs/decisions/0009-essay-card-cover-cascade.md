# Essay card cover cascade — every card carries art, and the no-art treatment is a film leader

**Date**: 2026-07-19
**Status**: accepted
**Context**: Implementing issue #99 — uniform Essay cards in the Discovery View. This ADR records how an Essay card's Cover Image is resolved, and reverses a decision that had until now lived only in code comments: that an Essay card with no hero image should show no art at all.

---

## Context / problem

The Essays grid in the Discovery View rendered an image band only when an Essay carried a hero `image` tag. Of the four Official Essays at the time of writing, two did. The result was a ragged grid: cards of two different heights interleaved in the same row, with the taller ones forcing dead space on their neighbours.

The obvious fix — a fallback image — had been explicitly ruled out. Comments in `essay-card.js` and `style.css` said, in effect: *no brand-mark fallback for cards without an image, it keeps the grid from becoming repeated-logo wallpaper.* That objection was sound as far as it went. The Essay Page hero falls back to the Cinema Slime brand mark, and a grid of eight cards each stamped with the same brand mark would dilute the mark and tell the reader nothing about the Essays.

Two things had changed by the time issue #99 was written:

1. All four Official Essays embed 4–6 images in their **body**, even the two with no hero tag. A body-image step takes real cover art from 50 % of the grid to 100 %, which turns any generated treatment from the common path into a genuine edge case.
2. The generated treatment need not be the brand mark. The original objection was specifically about repeating *the mark*; a distinct thematic texture is not the same object and does not carry the same cost.

---

## Decision

### 1. An Essay card's Cover Image resolves through a three-step cascade

Implemented in `src/essay-cover.js`:

1. **Hero image** — the Essay's own designated image, when it has one.
2. **First body image** — otherwise, the first image embedded in the Essay body.
3. **Film leader** — otherwise, a generated image.

Body extraction scans three embed styles that appear in long-form Nostr bodies — markdown images, raw `<img>` tags, and bare image URLs — and takes whichever match appears **earliest in the body**, not whichever style is checked first. That is deliberately the first image a reader would actually see. `data:` URIs are skipped: they are inline blobs, not addressable cover art.

Bare URLs are the awkward case. They appear inside prose, so trailing sentence punctuation must not defeat the match, while a URL already claimed by a markdown or `<img>` embed must not be counted a second time as a bare one. The pattern therefore terminates on a lookahead at a punctuation/whitespace boundary and guards its start with a lookbehind.

**Known limitation, accepted:** the first image in a body is not guaranteed to be the *best* cover — it could be a meme or a small inline graphic. First-wins is assumed good enough. If it proves wrong in practice, the fallback is a brand-controlled cover field in the Curation, which would be a separate change.

### 2. A cover image that fails to load falls back to the film leader at runtime

The film leader is **always** in the DOM, sitting beneath any resolved cover image. A dead cover URL therefore removes only its own `<img>` on `onerror`, revealing the leader already behind it. No second escaped copy of the leader has to be smuggled through a `data-` attribute, and no dead link can leave a hole in the grid.

### 3. The no-art treatment is a Film Leader, not the brand mark

The generated treatment is a sprocketed film-strip band over a deterministic brand-palette gradient, carrying a small `CINEMA SLIME` wordmark. It is seeded from the Essay's title, so a given Essay always wears the same leader.

**This reverses the earlier no-fallback-art rule**, on two grounds:

- The earlier objection was about not papering the grid with repeats of the **brand mark**. The film leader is a distinct thematic texture, not the logo — repetition of a texture reads as house style, repetition of a mark reads as wallpaper.
- Decision #1 makes the leader an edge case rather than the common path, so the repetition the earlier rule feared largely does not arise.

The Essay Page hero (`src/essay-header.js`) still falls back to the brand mark. That is a single large image on a page about one Essay, which is exactly the use the mark is for; it is untouched by this decision.

Validated against three alternatives in a throwaway UI prototype (six variants across two rounds); this one won.

### 4. Uniformity is clamp **and** reserve

Clamping alone still leaves rows ragged, because a one-line title makes a shorter card. So the card title clamps to two lines *and* reserves two lines' height; the author line reserves its height even when the brand designates no Cinema Slime Name (with the dangling `by ` prefix suppressed); and the date/meta line pins to the card bottom. The cover band has a fixed aspect ratio. A card is therefore structurally identical regardless of how complete its Essay data is.

The reserve is expressed at the same line-height the shared card-title rule already renders at, so it changes card geometry and nothing about the type itself.

---

## Consequences

- **The Essays grid no longer goes ragged.** Every card is the same shape whatever the Essay data looks like, so no row is deformed by one incomplete Essay.
- **Cover art is now derived, and can be wrong.** A body image chosen by position may not be the image a curator would have chosen. This is a known, accepted trade; the escape hatch is a curated cover field.
- **The earlier no-fallback-art rule is retired.** Its rationale is preserved here rather than in the code comments that used to carry it; `essay-card.js` and `style.css` now point at this ADR instead of restating the argument. No previous ADR is superseded — that decision was never recorded as one.
- **Domain language grew.** CONTEXT.md gains **Cover Image** and **Film Leader** as glossary terms. The cascade and the reasoning live here, not there.
- **The brand mark keeps a single job.** It marks Cinema Slime on the Essay Page hero and is not repeated as substitute art across a set of Essays.
