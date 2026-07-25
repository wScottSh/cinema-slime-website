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
// This module is pure: no DOM, no Math.random(). Pass a shuffled episodes array
// for varied image order; dark placeholder fills are deterministically varied
// by frame index.

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
 */
export function buildHeroReelFrameHtml({ src, darkFill }) {
  const img = src ? `<img class="hero-reel-art-img" src="${src}" alt="" loading="lazy" />` : '';
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
  const thumbs = Array.isArray(episodes)
    ? episodes.filter(e => e.image && e.image !== showArt).map(e => e.image)
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
