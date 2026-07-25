// Builds the Discovery View hero's film-reel background: Episode cover art
// arranged as frames in slowly-drifting, perspective-tilted film strips — a
// "projection reel" evoking the cinema theme. Purely decorative: every frame
// carries alt="" and the whole layer is wrapped in aria-hidden by the caller.
//
// The markup is:
//   .hero-reel                      (the tilted canvas; CSS applies the perspective)
//     └ .hero-reel-strip            (one film strip; alternate strips get --rev)
//         └ .hero-reel-strip-track  (the element CSS drifts; frame set duplicated)
//             └ .hero-reel-frame    (film base + frame-line gutter + sprocket holes)
//                 └ .hero-reel-art  (the square cover window)
//                     ├ .hero-reel-art-fill  (dark placeholder shown until decode)
//                     └ img.hero-reel-art-img (the cover art)
//
// This module is pure: no DOM, and no randomness of its own — `shuffleEpisodes`
// takes its random source as a parameter (defaulting to Math.random at the call
// site's discretion), so the markup builder stays deterministic. Pass a shuffled
// episodes array for varied image order; dark placeholder fills are
// deterministically varied by frame index.
//
// Frame artwork is requested through the artwork URL resolver, so the reel pulls
// 160px derivatives rather than the 3000x3000 originals (ADR 0013). At a 270px
// slot that is blurred to ~2.2px and dimmed to ~32%, nothing about the look
// changes — only the bytes.

import { artworkUrl, ARTWORK_WIDTH } from './artwork-url.js';

const FRAME_SIZE = 270; // px — the square cover window; matches .hero-reel-art in style.css
const OVERFILL = 1.9; // strips cover ~190% of the viewport so the tilt never exposes a hard corner

// Dark placeholder fills cycling from --bg-void (#0a0a0a) through mid-card greys
// (#222222), matching the design tokens in style.css. Shown until a frame's
// cover art decodes (and permanently for episodes that have no image).
const DARK_FILLS = [
  '#0a0a0a', // --bg-void
  '#0d0d0d',
  '#111111', // --bg-surface
  '#141414',
  '#161616', // --bg-card
  '#1a1a1a',
  '#1e1e1e', // --bg-card-hover
  '#222222',
];

// Stride 5 is coprime to 8 (DARK_FILLS.length), giving a full permutation per
// 8 frames — all fills appear before any repeat, preventing obvious banding.
const FILL_STRIDE = 5;

/**
 * A uniformly-shuffled copy of `list` (Fisher-Yates), leaving the input alone.
 *
 * `random` is injected — defaulting to the platform's own randomness — purely so
 * the permutation is verifiable from a known sequence. It replaces an earlier
 * `sort(() => Math.random() - 0.5)`, which is not a uniform shuffle and quietly
 * favors the feed's original order. That bias is invisible while the catalogue
 * is smaller than the reel's frame count (every image appears somewhere
 * regardless), but as the catalogue grows past it, a biased shuffle would start
 * systematically favoring recent Episodes over the back catalogue — exactly what
 * the reel exists to avoid.
 */
export function shuffleEpisodes(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The strip/frame grid needed to cover a viewport (with overfill for the tilt).
 * Returned as { cols, rows }: `cols` film strips, each `rows` frames tall.
 */
export function heroReelDimensions(viewport) {
  const cols = Math.ceil((viewport.width * OVERFILL) / FRAME_SIZE) + 1;
  const rows = Math.ceil((viewport.height * OVERFILL) / FRAME_SIZE) + 1;
  return { cols, rows };
}

/**
 * HTML for a single film frame. `src` is null when no cover art is available,
 * in which case only the dark placeholder renders (no img element).
 *
 * Loading attributes: `fetchpriority="low"` keeps a decorative background out of
 * the way of the foreground's own images, and `decoding="async"` keeps the
 * decode off the main thread. Deliberately NOT `loading="lazy"`: the strips are
 * tilted and oversized, so most frames project into or near the viewport under
 * the browser's post-transform intersection geometry — lazy-loading would mostly
 * delay fetches that happen anyway, while risking that a frame whose transformed
 * position never crosses the threshold never loads at all. (The Episode grid
 * card keeps `loading="lazy"`, where cards really are below the fold.)
 */
export function buildHeroReelFrameHtml({ src, darkFill }) {
  const img = src
    ? `<img class="hero-reel-art-img" src="${src}" alt="" fetchpriority="low" decoding="async" />`
    : '';
  return `<div class="hero-reel-frame"><div class="hero-reel-art"><div class="hero-reel-art-fill" style="background:${darkFill}"></div>${img}</div></div>`;
}

/**
 * The full inner HTML for the hero background layer for the given episodes and
 * viewport. Cover art (excluding the generic show-art fallback) cycles across
 * the frames; each strip's frame set is duplicated so the drift animation loops
 * seamlessly. Degrades gracefully: with no usable images every frame is a dark
 * placeholder.
 */
export function buildHeroReelHtml({ episodes, viewport, showArt }) {
  const { cols, rows } = heroReelDimensions(viewport);
  // The show-art exclusion compares RAW urls, before any mapping — "which
  // Episode is the generic show-art placeholder" and "what URL do we actually
  // request" are separate concerns and must not get entangled.
  const thumbs = Array.isArray(episodes)
    ? episodes
        .filter(e => e.image && e.image !== showArt)
        .map(e => artworkUrl(e.image, ARTWORK_WIDTH.REEL))
    : [];

  let strips = '';
  let i = 0;
  for (let c = 0; c < cols; c++) {
    let frames = '';
    for (let r = 0; r < rows; r++, i++) {
      frames += buildHeroReelFrameHtml({
        src: thumbs.length ? thumbs[i % thumbs.length] : null,
        darkFill: DARK_FILLS[(i * FILL_STRIDE) % DARK_FILLS.length],
      });
    }
    const rev = c % 2 === 1 ? ' hero-reel-strip--rev' : '';
    strips += `<div class="hero-reel-strip${rev}"><div class="hero-reel-strip-track">${frames}${frames}</div></div>`;
  }
  return `<div class="hero-reel">${strips}</div>`;
}
