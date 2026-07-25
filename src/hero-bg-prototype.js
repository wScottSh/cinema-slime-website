/**
 * PROTOTYPE — throwaway. Answers: "C3 (perspective drift) reads like a film
 * reel — lean in. Make each cover art one FRAME in a film strip: square cells,
 * a black frame-line between them, and sprocket-hole perforations along the
 * edges, running like a projection reel instead of an endless stream."
 *
 * Four riffs on the film-reel idea, switchable live via `?variant=` and a
 * dev-only bottom bar (arrow keys too). Each cover becomes a `.film-cell`
 * (film-base + gutter + perforated edges); cells stack into strips that drift.
 *
 *   F1 — REEL · PERSPECTIVE.  C3's recede + film framing. Strips run into the
 *        vanishing point like film through a projector. The star.
 *   F2 — REEL · UPRIGHT.  Gentle tilt, no heavy perspective; frames stay legible,
 *        depth comes from parallax scale bands.
 *   F3 — REEL · CROSS-SCREEN.  Horizontal strips running across the screen,
 *        sprockets on the top/bottom edges.
 *   F4 — REEL · PROJECTOR.  F1 + a warm projector beam and gate vignette.
 *
 * As before, the feather MASK stays on the viewport-aligned `.hero-bg-tiles`
 * frame while `.hero-bg-rotor` carries the tilt, so rotation never re-exposes a
 * hard edge. main.js owns the data + rebuild(); this module owns markup, reveal,
 * and the switcher. Not production — fold the winner into hero-bg-*.js and delete
 * this file + hero-bg-prototype.css + the main.js hooks.
 */
import { buildHeroBgTileHtml } from './hero-bg-tiles.js';
import './hero-bg-prototype.css';

const TILE = 270; // matches .hero-bg-tile-wrap in style.css
const OVERFILL = 1.9; // strips cover ~190% of the viewport so tilt can't expose a corner

// Dark placeholder fills (same range as hero-bg-tiles.js DARK_FILLS).
const FILLS = ['#0a0a0a', '#0d0d0d', '#111111', '#141414', '#161616', '#1a1a1a', '#1e1e1e', '#222222'];
const FILL_STRIDE = 5;

export const HERO_VARIANTS = [
  { key: 'F1', label: 'Reel · perspective' },
  { key: 'F2', label: 'Reel · upright' },
  { key: 'F3', label: 'Reel · cross-screen' },
  { key: 'F4', label: 'Reel · projector' },
];

const VALID = new Set(HERO_VARIANTS.map(v => v.key));

export function getHeroVariant() {
  const v = new URL(window.location.href).searchParams.get('variant');
  return VALID.has(v) ? v : 'F4';
}

function thumbsOf(episodes, showArt) {
  return Array.isArray(episodes)
    ? episodes.filter(e => e.image && e.image !== showArt).map(e => e.image)
    : [];
}

// One film frame: a square cover cell wrapped in film base + perforated edges.
function filmCell(src, fill, horizontal) {
  const cls = horizontal ? 'film-cell film-cell--h' : 'film-cell';
  return `<div class="${cls}">${buildHeroBgTileHtml({ src, darkFill: fill })}</div>`;
}

// Vertical reel (F1/F2/F4): columns of stacked frames. Each track's cell set is
// duplicated so the drift (translateY -50%) loops seamlessly.
function buildVerticalReel(thumbs, viewport) {
  const cols = Math.ceil((viewport.width * OVERFILL) / TILE) + 1;
  const rows = Math.ceil((viewport.height * OVERFILL) / TILE) + 1;
  let out = '';
  let k = 0;
  for (let c = 0; c < cols; c++) {
    let cells = '';
    for (let r = 0; r < rows; r++, k++) {
      cells += filmCell(thumbs.length ? thumbs[k % thumbs.length] : null, FILLS[(k * FILL_STRIDE) % FILLS.length], false);
    }
    const rev = c % 2 === 1 ? ' hero-bg-strip--rev' : '';
    out += `<div class="hero-bg-strip${rev}"><div class="hero-bg-strip-track">${cells}${cells}</div></div>`;
  }
  return `<div class="hero-bg-rotor">${out}</div>`;
}

// Horizontal reel (F3): rows of frames running across, sprockets top/bottom.
function buildHorizontalReel(thumbs, viewport) {
  const rows = Math.ceil((viewport.height * OVERFILL) / TILE) + 1;
  const cells = Math.ceil((viewport.width * OVERFILL) / TILE) + 1;
  let out = '';
  let k = 0;
  for (let r = 0; r < rows; r++) {
    let strip = '';
    for (let c = 0; c < cells; c++, k++) {
      strip += filmCell(thumbs.length ? thumbs[k % thumbs.length] : null, FILLS[(k * FILL_STRIDE) % FILLS.length], true);
    }
    const rev = r % 2 === 1 ? ' hero-bg-strip--rev' : '';
    out += `<div class="hero-bg-strip hero-bg-strip--h${rev}"><div class="hero-bg-strip-track hero-bg-strip-track--h">${strip}${strip}</div></div>`;
  }
  return `<div class="hero-bg-rotor hero-bg-rotor--h">${out}</div>`;
}

/** Inner HTML for the `.hero-bg-tiles` layer for the given variant. */
export function buildHeroBgInner(variant, { episodes, viewport, showArt }) {
  const thumbs = thumbsOf(episodes, showArt);
  return variant === 'F3' ? buildHorizontalReel(thumbs, viewport) : buildVerticalReel(thumbs, viewport);
}

// Whole-layer reveal: fade the frame in once the first few tiles decode (with a
// timeout fallback). The reel drift is the character — no per-tile fade.
export function revealHeroBgVariant(variant, root = document) {
  root.querySelectorAll('.hero-bg-tiles').forEach(layer => {
    const imgs = [...layer.querySelectorAll('img.hero-bg-tile')].slice(0, 8);
    let settled = false;
    const show = () => {
      if (settled) return;
      settled = true;
      void layer.offsetWidth;
      layer.classList.add('wall-loaded');
    };
    if (!imgs.length) return show();
    Promise.allSettled(imgs.map(i => i.decode().catch(() => {}))).then(show);
    setTimeout(show, 1200);
  });
}

// ===== Floating switcher (dev only) =====

let wired = false;

function updateSwitcherLabel(variant) {
  const el = document.querySelector('.hero-proto-label');
  if (!el) return;
  const idx = HERO_VARIANTS.findIndex(v => v.key === variant);
  const v = HERO_VARIANTS[idx];
  el.textContent = `${idx + 1}/${HERO_VARIANTS.length} — ${v.key} · ${v.label}`;
}

function cycle(dir, rebuild) {
  const keys = HERO_VARIANTS.map(v => v.key);
  const cur = getHeroVariant();
  const next = keys[(keys.indexOf(cur) + dir + keys.length) % keys.length];
  const url = new URL(window.location.href);
  url.searchParams.set('variant', next);
  window.history.replaceState(null, '', url);
  updateSwitcherLabel(next);
  rebuild();
}

/**
 * Injects the floating switcher once and wires clicks / arrow keys / resize.
 * `rebuild` re-measures the hero and rebuilds the bg layer for the current
 * variant. No-op outside dev so a stray merge can't ship the bar.
 */
export function initHeroPrototype(rebuild) {
  if (wired || !import.meta.env.DEV) return;
  wired = true;

  const bar = document.createElement('div');
  bar.className = 'hero-proto-switcher';
  bar.innerHTML = `
    <button type="button" data-hero-nav="prev" aria-label="Previous variant">‹</button>
    <span class="hero-proto-label"></span>
    <button type="button" data-hero-nav="next" aria-label="Next variant">›</button>`;
  document.body.appendChild(bar);
  updateSwitcherLabel(getHeroVariant());

  bar.addEventListener('click', e => {
    const btn = e.target.closest('[data-hero-nav]');
    if (btn) cycle(btn.dataset.heroNav === 'next' ? 1 : -1, rebuild);
  });

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') cycle(-1, rebuild);
    else if (e.key === 'ArrowRight') cycle(1, rebuild);
  });

  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
}
