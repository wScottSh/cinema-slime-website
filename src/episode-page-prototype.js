// PROTOTYPE — throwaway. Do not build on this file.
//
// Question: the Episode Page still wears the original site's register (rounded
// --bg-card box, 220px rounded art, pill button, green timestamp list) while the
// fold became a paste-up (ADR 0011), the bottom a marquee board (ADR 0012) and
// the Essay Page a projection (ADR 0018). What should the Episode Page look like
// to sit on par with them?
//
// Three variants of the Episode Page, switchable via `?variant=` on the existing
// episode route (e.g. /?variant=A#/episode/<guid>). `current` is the untouched
// production page, kept in the cycle for comparison. ← / → cycle.
//
// Unlike an Essay, an Episode description has a shape every week: an opening
// film quote, a timestamp list, a "<HOST>'S PICK x <THEME>" line and a synopsis.
// parseShowNotes pulls those apart so each variant can stage them separately.
import './episode-page-prototype.css';
import { buildGrungeFiltersHtml, buildSeasonTag } from './hero-marquee.js';
import { artworkUrl, ARTWORK_WIDTH } from './artwork-url.js';

export const VARIANTS = [
  { key: 'current', name: 'Current (production)' },
  { key: 'B', name: 'Paste-up — round-1 top + film strip' },
  { key: 'D', name: 'Flipped — title on the wall, poster right' },
  { key: 'E', name: 'Banner — torn strip, hanging print' },
  { key: 'F', name: 'Ransom note — title torn into strips' },
];

export function currentVariant() {
  if (!import.meta.env.DEV) return 'current';
  const v = new URLSearchParams(window.location.search).get('variant');
  return VARIANTS.some((x) => x.key === v) ? v : 'current';
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cleanTitle(title) {
  return String(title ?? '')
    .replace(/\s*\|\s*Cinema Slime Podcast.*$/i, '')
    .replace(/\s*x\s*Cinema Slime Podcast.*$/i, '')
    .replace(/\s*Review & Deep Dive.*$/i, '');
}
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function toSeconds(stamp) {
  const parts = String(stamp || '').split(':').map(Number);
  if (parts.some(isNaN) || !parts.length) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
function runtimeLabel(duration) {
  const s = toSeconds(duration);
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

/* ===== Show-notes parse (prototype-grade, DOM-based) ===== */
export function parseShowNotes(cleanedHtml, durationStr) {
  const doc = new DOMParser().parseFromString(`<div>${cleanedHtml || ''}</div>`, 'text/html');
  const blocks = [...doc.body.firstChild.children];
  let quote = '';
  let pick = '';
  const chapters = [];
  const prose = [];
  for (const el of blocks) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const stamp = text.match(/^\(((?:\d+:)?\d+:\d{2})\)\s*(.+)$/);
    if (stamp) { chapters.push({ at: stamp[1], secs: toSeconds(stamp[1]), label: stamp[2] }); continue; }
    if (/TIMESTAMPS/i.test(text)) continue;
    const onlyEm = el.children.length === 1 && el.firstElementChild.tagName === 'EM' && el.firstElementChild.textContent.trim() === el.textContent.trim();
    if (!quote && !prose.length && onlyEm) { quote = text.replace(/^["“]|["”]$/g, ''); continue; }
    const onlyStrong = el.children.length === 1 && el.firstElementChild.tagName === 'STRONG' && el.firstElementChild.textContent.trim() === el.textContent.trim();
    if (!pick && onlyStrong && /\sx\s/i.test(text)) { pick = text; continue; }
    prose.push(el.outerHTML);
  }
  // Each chapter runs until the next one; the last runs to the end of the Episode.
  const total = toSeconds(durationStr) || (chapters.at(-1)?.secs ?? 0) + 600;
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.secs ?? total;
    c.len = Math.max(30, end - c.secs);
  });
  // "HARRISON'S PICK x DAD-TEMBER" -> host "Harrison", theme "DAD-TEMBER"
  const m = pick.match(/^(.+?)[’']S PICK\s*x\s*(.+)$/i);
  const pickHost = m ? m[1].trim() : '';
  // Any "LEFT x RIGHT" bold line: "RENN'S PICK x DAD-TEMBER", "Week 2 DEEP DIVE x Deep Roy".
  const lr = pick.match(/^(.+?)\s+x\s+(.+)$/i);
  const pickLabel = lr ? lr[1].trim() : '';
  const pickTheme = (m ? m[2] : lr ? lr[2] : pick).trim().replace(/^["“”']+|["“”']+$/g, '');
  return { quote, chapters, total, pick, pickHost, pickLabel, pickTheme, proseHtml: prose.join('') };
}

// parts: { ep, idx, cleanedHtml, safeRaw, episodeCount }
export function buildEpisodePrototypeHtml(variant, parts) {
  const notes = parseShowNotes(parts.cleanedHtml, parts.ep.duration);
  const ctx = {
    ...parts, notes,
    title: cleanTitle(parts.ep.title),
    tag: buildSeasonTag(parts.ep),
    art: artworkUrl(parts.ep.image, ARTWORK_WIDTH.FEATURE),
    date: formatDate(parts.ep.pubDate),
    runtime: runtimeLabel(parts.ep.duration),
  };
  const top = { B: topB, D: topD, E: topE, F: topF }[variant](ctx);
  return `${buildGrungeFiltersHtml()}
  <div class="epB-wall ep-top--${variant}">
    <a href="#" id="back-to-episodes" class="epB-back">← All episodes</a>
    ${top}
    ${filmStrip(ctx)}
    ${lowerScraps(ctx, { quoteUsed: variant !== 'F' })}
    <div class="epB-foot">${disclosure(ctx.safeRaw)}</div>
  </div>`;
}

function disclosure(safeRaw) {
  return `<details class="original-disclosure">
    <summary>View original RSS description</summary>
    <div class="raw-description">${safeRaw}</div>
  </details>`;
}

function playBtn(extra = '') {
  return `<button class="btn btn-primary hero-marquee-play ep-play ${extra}" data-play="1">${PLAY_ICON} Play it</button>`;
}
function metaLine({ tag, date, runtime, notes }, { withPick = true } = {}) {
  return `<p class="hero-marquee-meta">
    ${tag ? `<span class="hero-chip">${escapeHtml(tag)}</span>` : ''}
    <span>${date}</span>${runtime ? `<span>${runtime}</span>` : ''}
    ${withPick && notes.pickHost ? `<span class="hero-marquee-meta-dim">${escapeHtml(notes.pickHost)}’s pick</span>` : ''}
  </p>`;
}
function polaroid({ art, title }, cls = '') {
  return `<div class="hero-marquee-poster ${cls}">
    <img src="${escapeHtml(art)}" alt="${escapeHtml(title)}" />
    <span class="hero-tape hero-tape--tl"></span><span class="hero-tape hero-tape--br"></span>
  </div>`;
}
function quoteScrap({ notes }, cls = '') {
  return notes.quote
    ? `<div class="epB-quote ${cls}"><span class="hero-tape hero-tape--tl"></span><p>“${escapeHtml(notes.quote)}”</p></div>`
    : '';
}
function kicker({ notes }) {
  return `<p class="hero-stencil">${notes.pickTheme ? escapeHtml(notes.pickTheme) : 'Now showing'}</p>`;
}

/* ===== The film strip: chapters as frames, each as wide as its share of the
   runtime, taped across the wall. Click a frame to start there. ===== */
function filmStrip({ notes }) {
  if (!notes.chapters.length) return '';
  const frames = notes.chapters.map((c, i) => `
    <button class="epC-frame" data-seek="${c.secs}" style="flex:${c.len} 1 0" title="Play from ${escapeHtml(c.at)}" aria-label="Play from ${escapeHtml(c.at)}: ${escapeHtml(c.label)}">
      <span class="ep-frame-go" aria-hidden="true">${PLAY_ICON}</span>
      <span class="epC-frame-n">${String(i + 1).padStart(2, '0')}</span>
      <span class="epC-frame-lbl">${escapeHtml(c.label)}</span>
      <span class="epC-frame-at">${escapeHtml(c.at)}</span>
    </button>`).join('');
  return `<section class="ep-strip">
    <div class="ep-strip-head">
      <p class="hero-stencil ep-strip-k">The reel · ${notes.chapters.length} chapters</p>
      <p class="ep-strip-hint"><span class="epF-strip-paper"></span>${PLAY_ICON} Click any frame to jump straight to that part <span class="ep-strip-hint-arrow" aria-hidden="true">↓</span></p>
    </div>
    <div class="epC-strip">
      <span class="hero-tape ep-strip-tape ep-strip-tape--l"></span>
      <span class="hero-tape ep-strip-tape ep-strip-tape--r"></span>
      <span class="epC-sprockets"></span>
      <div class="epC-frames">${frames}</div>
      <span class="epC-sprockets"></span>
    </div>
  </section>`;
}

function lowerScraps(ctx, { quoteUsed }) {
  const { notes } = ctx;
  return `<div class="ep-lower">
    ${quoteUsed ? '' : quoteScrap(ctx, 'ep-lower-quote')}
    <div class="epB-flyer ep-lower-flyer">
      <span class="epB-flyer-paper"></span>
      <p class="hero-stencil hero-stencil--sm">The film</p>
      <div class="epB-prose">${notes.proseHtml || '<p class="ep-muted">No synopsis for this Episode.</p>'}</div>
    </div>
  </div>`;
}

/* ================================================================
   B — the round-1 top, unchanged: the fold's panel reused whole.
   ================================================================ */
function topB(ctx) {
  const { art, title } = ctx;
  return `<div class="hero-marquee epB-marquee">
    <div class="hero-marquee-panel epB-panel">
      <div class="hero-marquee-paper">
        <div class="hero-marquee-bleed" style="background-image:url('${escapeHtml(art)}')"></div>
        <div class="hero-marquee-scrim"></div>
      </div>
      <div class="hero-marquee-halftone"></div>
      <div class="hero-marquee-grain"></div>
      <div class="hero-marquee-inner">
        ${polaroid(ctx)}
        <div class="hero-marquee-copy">
          ${kicker(ctx)}
          <h1 class="hero-marquee-title epB-title">${escapeHtml(title)}</h1>
          ${metaLine(ctx)}
          <div class="hero-cta-group" style="margin-top:1.4rem">${playBtn()}</div>
        </div>
      </div>
    </div>
  </div>
  ${quoteScrap(ctx)}`;
}

/* ================================================================
   D — FLIPPED & OFF THE PANEL. No rectangle. The title is set huge
   straight on the wall, left; the poster moves right, bigger, leaning
   the other way, on a torn scrap of its own bled art. The quote is
   taped across the poster's foot.
   ================================================================ */
function topD(ctx) {
  const { art, title } = ctx;
  return `<div class="epD-top">
    <div class="epD-copy">
      ${kicker(ctx)}
      <h1 class="epD-title">${escapeHtml(title)}</h1>
      ${metaLine(ctx)}
      <div class="epD-cta">${playBtn()}</div>
    </div>
    <div class="epD-art">
      <div class="epD-scrap"><div class="hero-marquee-bleed" style="background-image:url('${escapeHtml(art)}')"></div><div class="hero-marquee-halftone"></div></div>
      ${polaroid(ctx, 'epD-poster')}
      ${quoteScrap(ctx, 'epD-quote')}
    </div>
  </div>`;
}

/* ================================================================
   E — BANNER + HANGING PRINT. A long, low, torn strip of the bled art
   runs the width of the wall with the title struck across it; the
   polaroid hangs off its bottom edge on the right, steeply tilted.
   Meta and Play sit under the banner on the bare wall.
   ================================================================ */
function topE(ctx) {
  const { art, title } = ctx;
  return `<div class="epE-top">
    <div class="epE-banner">
      <div class="epE-paper">
        <div class="hero-marquee-bleed" style="background-image:url('${escapeHtml(art)}')"></div>
        <div class="epE-scrim"></div>
      </div>
      <div class="hero-marquee-halftone"></div>
      <div class="hero-marquee-grain"></div>
      <div class="epE-banner-inner">
        ${kicker(ctx)}
        <h1 class="epE-title">${escapeHtml(title)}</h1>
      </div>
    </div>
    ${polaroid(ctx, 'epE-poster')}
    <div class="epE-under">
      ${metaLine(ctx)}
      <div class="epE-cta">${playBtn()}</div>
      ${quoteScrap(ctx, 'epE-quote')}
    </div>
  </div>`;
}

/* ================================================================
   F — RANSOM NOTE. The title is torn into strips of mismatched stock,
   each at its own angle, pasted over a tilted panel of the bled art.
   The poster is small and taped off the panel's top-left corner. The
   quote drops down to the lower wall beside the synopsis.
   ================================================================ */
function ransomLines(title) {
  const words = title.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > 12) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
// "RENN'S PICK" on a taped cream label, the month's theme on a red strip
// beside it — the same torn stock as the title, one size down.
function pickTag({ notes }) {
  if (!notes.pickLabel && !notes.pickTheme) return '<p class="hero-stencil">Now showing</p>';
  return `<p class="epF-pick">
    ${notes.pickLabel ? `<span class="epF-pick-who"><span class="epF-strip-paper"></span><span class="hero-tape"></span>${escapeHtml(notes.pickLabel)}</span>` : ''}
    ${notes.pickTheme ? `<span class="epF-pick-theme"><span class="epF-strip-paper"></span>× ${escapeHtml(notes.pickTheme)}</span>` : ''}
  </p>`;
}
// Mulberry32 seeded from the title: every Episode gets its own scatter of
// stock, angle and size, but the same one on every load.
function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Stock is weighted, not cycled: mostly cream and newsprint, some black, and
// red as the accent — at most one red strip per title (two on very long ones),
// never two reds touching, and never three of the same stock in a row.
function ransomStyles(lines, seed) {
  const rand = seededRandom(seed);
  const weights = [['cream', 0.38], ['news', 0.22], ['black', 0.28], ['red', 0.12]];
  const maxRed = lines.length >= 7 ? 2 : 1;
  let reds = 0;
  const out = [];
  lines.forEach((_, i) => {
    let stock;
    for (let tries = 0; tries < 20; tries++) {
      let r = rand(), acc = 0;
      stock = weights.find(([, w]) => (acc += w) >= r)?.[0] ?? 'cream';
      if (stock === 'red' && (reds >= maxRed || out[i - 1]?.stock === 'red')) continue;
      if (i >= 2 && out[i - 1].stock === stock && out[i - 2].stock === stock) continue;
      break;
    }
    if (stock === 'red') reds++;
    out.push({
      stock,
      rot: (rand() * 6.4 - 3.2).toFixed(2),
      y: (rand() * 0.6 - 0.3).toFixed(2),
      scale: (0.9 + rand() * 0.18).toFixed(3),
    });
  });
  // A title of 3+ strips with no red yet gets one on a middle strip.
  if (!reds && lines.length >= 3) out[1 + Math.floor(rand() * (lines.length - 2))].stock = 'red';
  return out;
}
function topF(ctx) {
  const { art, title } = ctx;
  const lines = ransomLines(title);
  const styles = ransomStyles(lines, title);
  const strips = lines.map((l, i) => {
    const st = styles[i];
    return `
    <span class="epF-strip epF-strip--${st.stock}" style="--r:${st.rot}deg;--y:${st.y}rem;--s:${st.scale}">
      <span class="epF-strip-paper"></span>${escapeHtml(l)}
    </span>`;
  }).join('');
  return `<div class="epF-top">
    <div class="epF-panel">
      <div class="hero-marquee-paper"><div class="hero-marquee-bleed" style="background-image:url('${escapeHtml(art)}')"></div><div class="epF-scrim"></div></div>
      <div class="hero-marquee-halftone"></div>
      <div class="hero-marquee-grain"></div>
    </div>
    ${polaroid(ctx, 'epF-poster')}
    <div class="epF-copy">
      ${pickTag(ctx)}
      <h1 class="epF-title epF-title--${title.length <= 30 ? 'short' : 'long'}" aria-label="${escapeHtml(title)}">${strips}</h1>
      ${metaLine(ctx, { withPick: false })}
      <div class="epF-cta">${playBtn()}</div>
    </div>
  </div>`;
}

/* ===== Interactions: Play and chapter seek, delegated ===== */
export function bindEpisodePrototype(root, { onPlay, onSeek }) {
  root.addEventListener('click', (e) => {
    const seekEl = e.target.closest('[data-seek]');
    if (seekEl) { onSeek(Number(seekEl.dataset.seek)); return; }
    if (e.target.closest('[data-play]')) onPlay();
  });
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
