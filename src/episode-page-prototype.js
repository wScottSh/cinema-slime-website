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
  { key: 'A', name: 'Projection — sibling of the Essay Page' },
  { key: 'B', name: 'Paste-up wall — torn panel + scraps' },
  { key: 'C', name: 'Film strip — chapters are the page' },
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
    if (!pick && onlyStrong && /PICK/i.test(text)) { pick = text; continue; }
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
  const pickTheme = m ? m[2].trim() : pick;
  return { quote, chapters, total, pick, pickHost, pickTheme, proseHtml: prose.join('') };
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
  const body = variant === 'A' ? variantA(ctx) : variant === 'B' ? variantB(ctx) : variantC(ctx);
  return `${buildGrungeFiltersHtml()}${body}`;
}

function disclosure(safeRaw) {
  return `<details class="original-disclosure">
    <summary>View original RSS description</summary>
    <div class="raw-description">${safeRaw}</div>
  </details>`;
}

function chaptersEmpty() {
  return '<p class="ep-muted">No chapters in this Episode\'s notes.</p>';
}

/* ================================================================
   A — PROJECTION. The Essay Page's frame, made for a square poster:
   the art bled and blurred as the screen, the crisp poster pinned on it,
   title struck across the foot. Sticky rail holds Play + meta. The
   column carries the quote as a deck, the chapters as a numbered reel
   log, and the pick as a reel heading over the synopsis.
   ================================================================ */
function variantA({ ep, notes, title, tag, art, date, runtime, safeRaw }) {
  const log = notes.chapters.length
    ? `<ol class="pa-reellog">${notes.chapters.map((c, i) => `
        <li><button class="pa-reel" data-seek="${c.secs}">
          <span class="pa-reel-n">Reel ${String(i + 1).padStart(2, '0')}</span>
          <span class="pa-reel-label">${escapeHtml(c.label)}</span>
          <span class="pa-reel-at">${escapeHtml(c.at)}</span>
        </button></li>`).join('')}</ol>`
    : chaptersEmpty();
  return `
  <header class="essay-screen epA-screen">
    <div class="epA-bleed" style="background-image:url('${escapeHtml(art)}')"></div>
    <div class="essay-screen-light"></div>
    <span class="essay-screen-sprockets essay-screen-sprockets--l"></span>
    <span class="essay-screen-sprockets essay-screen-sprockets--r"></span>
    <div class="epA-poster"><img src="${escapeHtml(art)}" alt="${escapeHtml(title)}"></div>
    <div class="essay-screen-titleblock">
      <span class="hero-stencil">${tag ? escapeHtml(tag) : 'Episode'}</span>
      <h1 class="essay-screen-title epA-title">${escapeHtml(title)}</h1>
    </div>
  </header>
  <div class="essay-reader">
    <aside class="essay-rail">
      <div class="essay-rail-inner">
        <a href="#" id="back-to-episodes" class="essay-rail-back">← All episodes</a>
        <button class="epA-play" data-play="1">${PLAY_ICON} Play it</button>
        ${tag ? `<div class="essay-rail-block"><span class="essay-rail-k">Episode</span><span class="hero-chip">${escapeHtml(tag)}</span></div>` : ''}
        <div class="essay-rail-block"><span class="essay-rail-k">Aired</span><span class="essay-rail-v">${date}</span></div>
        ${runtime ? `<div class="essay-rail-block"><span class="essay-rail-k">Runtime</span><span class="essay-rail-v">${runtime}</span></div>` : ''}
        ${notes.pickHost ? `<div class="essay-rail-block"><span class="essay-rail-k">Picked by</span><span class="essay-rail-v">${escapeHtml(notes.pickHost)}</span></div>` : ''}
      </div>
    </aside>
    <div class="essay-column">
      ${notes.quote ? `<p class="essay-deck epA-quote">“${escapeHtml(notes.quote)}”</p>` : ''}
      <h2 class="epA-h"><span>Reel log</span>What we cover</h2>
      ${log}
      ${notes.proseHtml ? `<h2 class="epA-h"><span>${escapeHtml(notes.pickTheme || 'The film')}</span>${notes.pickHost ? `${escapeHtml(notes.pickHost)}’s pick` : 'The film'}</h2>
      <article class="essay-body epA-body">${notes.proseHtml}</article>` : ''}
      <p class="essay-slate">End of reel</p>
      ${disclosure(safeRaw)}
    </div>
  </div>`;
}

/* ================================================================
   B — PASTE-UP WALL. The fold's own panel, reused whole (torn paper,
   blurred bleed, polaroid, stencil, red chip, chewed Play button), then
   the notes torn into scraps pasted on the wall below: the quote on a
   taped cream strip, the chapters as a typed set list on cream stock,
   the synopsis on a dark flyer.
   ================================================================ */
function variantB({ ep, notes, title, tag, art, date, runtime, episodeCount, safeRaw }) {
  return `
  <div class="epB-wall">
    <a href="#" id="back-to-episodes" class="epB-back">← All episodes</a>
    <div class="hero-marquee epB-marquee">
      <div class="hero-marquee-panel epB-panel">
        <div class="hero-marquee-paper">
          <div class="hero-marquee-bleed" style="background-image:url('${escapeHtml(art)}')"></div>
          <div class="hero-marquee-scrim"></div>
        </div>
        <div class="hero-marquee-halftone"></div>
        <div class="hero-marquee-grain"></div>
        <div class="hero-marquee-inner">
          <div class="hero-marquee-poster">
            <img src="${escapeHtml(art)}" alt="${escapeHtml(title)}" />
            <span class="hero-tape hero-tape--tl"></span><span class="hero-tape hero-tape--br"></span>
          </div>
          <div class="hero-marquee-copy">
            <p class="hero-stencil">${notes.pickTheme ? escapeHtml(notes.pickTheme) : 'Now showing'}</p>
            <h1 class="hero-marquee-title epB-title">${escapeHtml(title)}</h1>
            <p class="hero-marquee-meta">
              ${tag ? `<span class="hero-chip">${escapeHtml(tag)}</span>` : ''}
              <span>${date}</span>${runtime ? `<span>${runtime}</span>` : ''}
              ${notes.pickHost ? `<span class="hero-marquee-meta-dim">${escapeHtml(notes.pickHost)}’s pick</span>` : ''}
            </p>
            <div class="hero-cta-group" style="margin-top:1.4rem">
              <button class="btn btn-primary hero-marquee-play" data-play="1">${PLAY_ICON} Play it</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    ${notes.quote ? `<div class="epB-quote"><span class="hero-tape hero-tape--tl"></span><p>“${escapeHtml(notes.quote)}”</p></div>` : ''}
    <div class="epB-scraps">
      <div class="epB-setlist">
        <span class="epB-setlist-paper"></span>
        <span class="hero-tape hero-tape--tl"></span>
        <h2 class="epB-setlist-head">Set list</h2>
        ${notes.chapters.length ? `<ol>${notes.chapters.map((c) => `
          <li><button data-seek="${c.secs}"><span class="epB-at">${escapeHtml(c.at)}</span><span class="epB-dots"></span><span class="epB-lbl">${escapeHtml(c.label)}</span></button></li>`).join('')}</ol>` : chaptersEmpty()}
      </div>
      <div class="epB-flyer">
        <span class="epB-flyer-paper"></span>
        <p class="hero-stencil hero-stencil--sm">The film</p>
        <div class="epB-prose">${notes.proseHtml || '<p class="ep-muted">No synopsis for this Episode.</p>'}</div>
      </div>
    </div>
    <div class="epB-foot">${disclosure(safeRaw)}</div>
  </div>`;
}

/* ================================================================
   C — FILM STRIP. Audio-first: the Episode is a length of film. A
   compact title card, then the chapters laid out as frames on one
   sprocketed strip, each frame as wide as its share of the runtime.
   Click a frame to start there. Quote and synopsis sit below as a
   centered program note.
   ================================================================ */
function variantC({ ep, notes, title, tag, art, date, runtime, safeRaw }) {
  const frames = notes.chapters.length
    ? notes.chapters.map((c, i) => `
      <button class="epC-frame" data-seek="${c.secs}" style="flex:${c.len} 1 0">
        <span class="epC-frame-n">${String(i + 1).padStart(2, '0')}</span>
        <span class="epC-frame-lbl">${escapeHtml(c.label)}</span>
        <span class="epC-frame-at">${escapeHtml(c.at)}</span>
      </button>`).join('')
    : `<div class="epC-frame epC-frame--whole" style="flex:1"><span class="epC-frame-lbl">One continuous reel</span></div>`;
  return `
  <div class="epC-page">
    <a href="#" id="back-to-episodes" class="essay-rail-back epC-back">← All episodes</a>
    <header class="epC-card">
      <img class="epC-art" src="${escapeHtml(art)}" alt="${escapeHtml(title)}">
      <div class="epC-copy">
        <p class="epC-meta">${tag ? `<span class="hero-chip">${escapeHtml(tag)}</span>` : ''}<span>${date}</span>${runtime ? `<span>${runtime}</span>` : ''}</p>
        <h1 class="epC-title">${escapeHtml(title)}</h1>
        ${notes.pickHost || notes.pickTheme ? `<p class="hero-stencil">${notes.pickHost ? `${escapeHtml(notes.pickHost)}’s pick · ` : ''}${escapeHtml(notes.pickTheme)}</p>` : ''}
      </div>
      <button class="epC-roll" data-play="1">${PLAY_ICON}<span>Roll film</span></button>
    </header>
    <section class="epC-stripwrap">
      <div class="epC-strip-head"><span>The reel</span><span>${notes.chapters.length ? `${notes.chapters.length} chapters · click a frame to start there` : ''}</span></div>
      <div class="epC-strip">
        <span class="epC-sprockets epC-sprockets--t"></span>
        <div class="epC-frames">${frames}</div>
        <span class="epC-sprockets epC-sprockets--b"></span>
      </div>
    </section>
    <section class="epC-program">
      ${notes.quote ? `<blockquote class="epC-quote">“${escapeHtml(notes.quote)}”</blockquote>` : ''}
      ${notes.proseHtml ? `<div class="essay-body epC-body">${notes.proseHtml}</div>` : ''}
      ${disclosure(safeRaw)}
    </section>
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
