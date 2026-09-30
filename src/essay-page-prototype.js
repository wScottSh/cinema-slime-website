// PROTOTYPE — throwaway. Do not build on this file.
//
// Question: the Essay Page still wears the original site's register (rounded
// --bg-card box, small title) while the fold became a paste-up (ADR 0011) and
// the bottom became a marquee board (ADR 0012). What should the reader look like
// to sit on par with them?
//
// Three variants of the Essay Page, switchable via `?variant=` on the existing
// essay route (e.g. /?variant=A#/essay/my-own-private-idaho). `current` is the
// untouched production page, kept in the cycle for comparison.
//
// Captured on branch prototype/essay-reader; fold the winner into main properly.
import './essay-page-prototype.css';
import { buildGrungeFiltersHtml } from './hero-marquee.js';
import { resolveCoverImage, buildFilmLeaderHtml } from './essay-cover.js';

export const VARIANTS = [
  { key: 'current', name: 'Current (production)' },
  { key: 'A', name: 'Paste-up wall — sidebar' },
  { key: 'B', name: 'Marquee board — lit & centered' },
  { key: 'C', name: 'Projection — full-bleed' },
];

export function currentVariant() {
  if (!import.meta.env.DEV) return 'current';
  const v = new URLSearchParams(window.location.search).get('variant');
  return VARIANTS.some((x) => x.key === v) ? v : 'current';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function readingMinutes(bodyHtml) {
  const words = String(bodyHtml).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

function coverHtml(essay, cls) {
  const url = resolveCoverImage(essay);
  const img = url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(essay.title || '')}" onerror="this.remove()">` : '';
  return `<div class="${cls}">${buildFilmLeaderHtml(essay.title || '')}${img}</div>`;
}

// parts: { essay, bodyHtml, socialProofHtml, disclosureHtml }
export function buildEssayPrototypeHtml(variant, parts) {
  if (variant === 'A') return variantA(parts);
  if (variant === 'B') return variantB(parts);
  if (variant === 'C') return variantC(parts);
  return '';
}

/* ===== A — Paste-up wall: the fold's register, torn header + sticky rail ===== */
function variantA({ essay, bodyHtml, socialProofHtml, disclosureHtml }) {
  const url = resolveCoverImage(essay);
  const mins = readingMinutes(bodyHtml);
  return `
  ${buildGrungeFiltersHtml()}
  <div class="pa-page">
    <header class="pa-head">
      <div class="pa-paper">
        <div class="pa-bleed" style="${url ? `background-image:url('${escapeHtml(url)}')` : ''}"></div>
        <div class="pa-scrim"></div>
      </div>
      <div class="pa-halftone"></div>
      <div class="pa-grain"></div>
      <div class="pa-head-inner">
        <div class="pa-print">
          <span class="hero-tape hero-tape--tl"></span>
          ${coverHtml(essay, 'pa-print-img')}
          <span class="hero-tape hero-tape--br"></span>
        </div>
        <div class="pa-copy">
          <span class="hero-stencil">Essay</span>
          <h1 class="pa-title">${escapeHtml(essay.title || 'Untitled')}</h1>
          ${essay.summary ? `<p class="pa-deck">${escapeHtml(essay.summary)}</p>` : ''}
        </div>
      </div>
    </header>

    <div class="pa-layout">
      <aside class="pa-rail">
        <div class="pa-rail-inner">
          <a href="#" id="back-from-essay" class="pa-back">← Back to the wall</a>
          ${essay.authorName ? `<div class="pa-rail-block"><span class="pa-rail-k">Written by</span><span class="hero-chip">${escapeHtml(essay.authorName)}</span></div>` : ''}
          <div class="pa-rail-block"><span class="pa-rail-k">Posted</span><span class="pa-rail-v">${formatDate(essay.publishedAt)}</span></div>
          <div class="pa-rail-block"><span class="pa-rail-k">Read</span><span class="pa-rail-v">${mins} min</span></div>
          ${socialProofHtml ? `<div class="pa-rail-block">${socialProofHtml}</div>` : ''}
        </div>
      </aside>
      <article class="pa-sheet">
        <div class="pa-sheet-paper"></div>
        <div class="essay-body pa-body">${bodyHtml}</div>
      </article>
    </div>
    <div class="pa-after">${disclosureHtml}</div>
  </div>`;
}

/* ===== B — Marquee board: the bottom's lit board, pulled up to carry the page ===== */
function variantB({ essay, bodyHtml, socialProofHtml, disclosureHtml }) {
  const mins = readingMinutes(bodyHtml);
  return `
  <div class="mb-page">
    <a href="#" id="back-from-essay" class="mb-back">← Back to the lobby</a>
    <header class="mb-head">
      <span class="bulb-rail"></span>
      <div class="mb-board">
        <div class="board-face"></div>
        <div class="board-halftone"></div>
        <div class="mb-board-inner">
          <p class="mb-kicker">Now reading · an essay</p>
          <h1 class="mb-title">${escapeHtml(essay.title || 'Untitled')}</h1>
          <div class="mb-bill">
            ${essay.authorName ? `<span class="mb-bill-item"><span class="bill-role">Written by</span><span class="bill-name">${escapeHtml(essay.authorName)}</span></span>` : ''}
            <span class="mb-bill-item"><span class="bill-role">Opened</span><span class="bill-name">${formatDate(essay.publishedAt)}</span></span>
            <span class="mb-bill-item"><span class="bill-role">Runtime</span><span class="bill-name">${mins} min</span></span>
          </div>
        </div>
      </div>
      <span class="bulb-rail"></span>
    </header>

    <figure class="mb-lobbycard">
      ${coverHtml(essay, 'mb-lobbycard-img')}
    </figure>

    ${essay.summary ? `<p class="mb-deck">${escapeHtml(essay.summary)}</p>` : ''}

    <article class="essay-body mb-body">${bodyHtml}</article>

    <footer class="mb-end">
      <span class="mb-end-card">The End</span>
      ${socialProofHtml}
    </footer>
    ${disclosureHtml}
  </div>`;
}

/* ===== C — Projection: full-bleed cover as the screen, text on the void ===== */
function variantC({ essay, bodyHtml, socialProofHtml, disclosureHtml }) {
  const mins = readingMinutes(bodyHtml);
  return `
  ${buildGrungeFiltersHtml()}
  <header class="pj-screen">
    ${coverHtml(essay, 'pj-screen-img')}
    <div class="pj-light"></div>
    <span class="pj-sprockets pj-sprockets--l"></span>
    <span class="pj-sprockets pj-sprockets--r"></span>
    <div class="pj-titleblock">
      <a href="#" id="back-from-essay" class="pj-back">← Cinema Slime</a>
      <span class="hero-stencil">Essay</span>
      <h1 class="pj-title">${escapeHtml(essay.title || 'Untitled')}</h1>
      <p class="pj-meta">
        ${essay.authorName ? `<span>By <b>${escapeHtml(essay.authorName)}</b></span>` : ''}
        <span>${formatDate(essay.publishedAt)}</span>
        <span>${mins} min read</span>
      </p>
    </div>
  </header>
  <div class="pj-page">
    ${essay.summary ? `<p class="pj-deck">${escapeHtml(essay.summary)}</p>` : ''}
    <article class="essay-body pj-body">${bodyHtml}</article>
    <div class="pj-slate">
      <span class="pj-slate-line">End of reel</span>
      ${socialProofHtml}
    </div>
    ${disclosureHtml}
  </div>`;
}

/* ===== The floating switcher (dev only) ===== */
export function mountPrototypeSwitcher(onChange) {
  if (!import.meta.env.DEV) return;
  let bar = document.getElementById('proto-switcher');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'proto-switcher';
    document.body.appendChild(bar);
    window.addEventListener('keydown', (e) => {
      if (bar.hidden) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
  }
  function step(dir) {
    const i = VARIANTS.findIndex((v) => v.key === currentVariant());
    const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length].key;
    const params = new URLSearchParams(window.location.search);
    params.set('variant', next);
    history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
    window.scrollTo(0, 0);
    bar.__onChange();
  }
  bar.hidden = false;
  bar.__onChange = onChange;
  const v = VARIANTS.find((x) => x.key === currentVariant());
  bar.innerHTML = `<button data-dir="-1" aria-label="Previous variant">‹</button><span>${v.key} — ${v.name}</span><button data-dir="1" aria-label="Next variant">›</button>`;
  bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => step(+b.dataset.dir)));
}

export function unmountPrototypeSwitcher() {
  const bar = document.getElementById('proto-switcher');
  if (bar) bar.hidden = true;
}
