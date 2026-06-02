const TILE_SIZE = 270;

// Dark fills cycling from --bg-void (#0a0a0a) through mid-card greys (#222222),
// matching the existing design tokens in style.css.
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
// 8 tiles — all fills appear before any repeat, preventing obvious stripes.
const FILL_STRIDE = 5;

/**
 * Given an ordered episodes array, viewport dimensions, and the SHOW_ART
 * fallback URL, returns an array of { src, darkFill } tile descriptors that
 * fills the viewport at 110% width (for bleed/overflow) with 270×270 tiles.
 *
 * - `src` is null when no valid episode images are available.
 * - `darkFill` is a hex colour from the dark design-token range.
 * - Pure: no DOM, no Math.random(). Pass a shuffled episodes array for varied
 *   image order; dark fills are deterministically varied by tile index.
 */
export function buildHeroBgTileDescriptors(episodes, viewport, showArt) {
  const containerW = viewport.width * 1.1;
  const containerH = viewport.height;
  const cols = Math.ceil(containerW / TILE_SIZE) + 1;
  const rows = Math.ceil(containerH / TILE_SIZE) + 1;
  const totalTiles = cols * rows;

  const thumbs = Array.isArray(episodes)
    ? episodes.filter(e => e.image && e.image !== showArt).map(e => e.image)
    : [];

  return Array.from({ length: totalTiles }, (_, i) => ({
    src: thumbs.length > 0 ? thumbs[i % thumbs.length] : null,
    darkFill: DARK_FILLS[(i * FILL_STRIDE) % DARK_FILLS.length],
  }));
}
