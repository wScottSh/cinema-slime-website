// Pure HTML-string builders for the Episode Page's ransom-note paste-up
// (ADR 0019). No DOM access — every export returns an HTML string or plain
// data. Mirrors the essay-header.js pattern.
//
// The page is three pieces, top to bottom:
//   - the top: a tilted torn panel of the Episode's own artwork, the polaroid
//     taped off its corner, and the title torn into strips of mismatched stock
//   - the Reel: the Chapters as frames on one film strip, each as wide as its
//     share of the runtime; a frame is a button that starts the Episode there
//   - the lower wall: the film quote on a taped strip and the synopsis on a
//     dark flyer
//
// The torn edges and the chewed Play button need the grunge <defs>
// (buildGrungeFiltersHtml) in the document; the Episode Page renders them.
import { buildSeasonTag } from './hero-marquee.js';
import { artworkUrl, ARTWORK_WIDTH } from './artwork-url.js';

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

// A title this short sits on one or two rows, so its strips are cut bigger to
// fill the panel instead of leaving it half empty.
const SHORT_TITLE_CHARS = 30;
// Words are grouped into strips of about this many characters.
const STRIP_CHARS = 12;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/** "01:43:11" -> "1h 43m", "00:16:22" -> "16 min", unparseable -> ''. */
export function runtimeLabel(duration) {
  const parts = String(duration ?? '').split(':');
  if (!parts[0] || parts.some((p) => !/^\d+$/.test(p))) return '';
  const s = parts.reduce((acc, n) => acc * 60 + Number(n), 0);
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

/* ========================= the ransom title ========================= */

// Mulberry32, seeded from the title: every Episode gets its own scatter of
// stock, angle and size, and the same one on every load.
function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groupWords(title) {
  const strips = [];
  let cur = '';
  for (const w of title.split(/\s+/).filter(Boolean)) {
    if (cur && `${cur} ${w}`.length > STRIP_CHARS) { strips.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) strips.push(cur);
  return strips;
}

const STOCK_WEIGHTS = [['cream', 0.38], ['news', 0.22], ['black', 0.28], ['red', 0.12]];

/**
 * The title cut into strips, each with its own stock, angle, lift and size.
 * Stock is weighted, never cycled — a cycle of cream/black/red reads as a flag.
 * Red is the accent: at most one red strip (two on very long titles), never two
 * touching, and a title of three or more strips always gets one. No stock runs
 * three strips in a row.
 *
 * @returns {Array<{ text: string, stock: 'cream'|'news'|'black'|'red', rot: number, lift: number, scale: number }>}
 */
export function ransomStrips(title) {
  const words = groupWords(String(title ?? ''));
  const rand = seededRandom(String(title ?? ''));
  const maxRed = words.length >= 7 ? 2 : 1;
  const out = [];
  let reds = 0;
  words.forEach((text, i) => {
    let stock = 'cream';
    for (let tries = 0; tries < 20; tries++) {
      const r = rand();
      let acc = 0;
      stock = STOCK_WEIGHTS.find(([, w]) => (acc += w) >= r)?.[0] ?? 'cream';
      if (stock === 'red' && (reds >= maxRed || out[i - 1]?.stock === 'red')) continue;
      if (i >= 2 && out[i - 1].stock === stock && out[i - 2].stock === stock) continue;
      break;
    }
    if (stock === 'red') reds++;
    out.push({
      text,
      stock,
      rot: Math.round((rand() * 6.4 - 3.2) * 100) / 100,
      lift: Math.round((rand() * 0.6 - 0.3) * 100) / 100,
      scale: Math.round((0.9 + rand() * 0.18) * 1000) / 1000,
    });
  });
  if (!reds && out.length >= 3) {
    // No reds exist yet, so a red middle strip can't touch another red.
    const middle = out.slice(1, -1).map((_, k) => k + 1);
    const pick = middle[Math.floor(rand() * middle.length)];
    out[pick].stock = 'red';
  }
  return out;
}

function buildRansomTitleHtml(title) {
  const size = title.length <= SHORT_TITLE_CHARS ? 'short' : 'long';
  const strips = ransomStrips(title).map((s) =>
    `<span class="episode-cut episode-cut--${s.stock}" style="--r:${s.rot}deg;--lift:${s.lift}rem;--s:${s.scale}"><span class="episode-cut-paper"></span>${escapeHtml(s.text)}</span>`,
  ).join('');
  return `<h1 class="episode-ransom episode-ransom--${size}" aria-label="${escapeHtml(title)}">${strips}</h1>`;
}

/* ========================= the pieces ========================= */

// "RENN'S PICK" on a taped cream label, the theme on a green strip beside it.
function buildBillingHtml(billing) {
  if (!billing) return '<p class="hero-stencil">Now showing</p>';
  return `<p class="episode-billing">
    <span class="episode-billing-label"><span class="episode-cut-paper"></span><span class="hero-tape"></span>${escapeHtml(billing.label)}</span>
    ${billing.theme ? `<span class="episode-billing-theme"><span class="episode-cut-paper"></span>× ${escapeHtml(billing.theme)}</span>` : ''}
  </p>`;
}

/**
 * The top of the page: back link, torn art panel, polaroid, billing, ransom
 * title, meta and Play. The panel hugs its content, so a sparse Episode gets a
 * short panel rather than an empty one.
 *
 * ep: { title, image, pubDate, duration, season, episode, episodeType }
 * notes: parseShowNotes(...)
 */
export function buildEpisodeTopHtml(ep, notes) {
  const title = cleanTitle(ep?.title);
  const art = escapeHtml(artworkUrl(ep?.image, ARTWORK_WIDTH.POSTER));
  const tag = buildSeasonTag(ep);
  const runtime = runtimeLabel(ep?.duration);

  return `<a href="/" id="back-to-episodes" class="episode-back">← All episodes</a>
  <div class="episode-top">
    <div class="episode-panel">
      <div class="hero-marquee-paper">
        <div class="hero-marquee-bleed" style="background-image:url('${art}')"></div>
        <div class="episode-panel-scrim"></div>
      </div>
      <div class="hero-marquee-halftone"></div>
      <div class="hero-marquee-grain"></div>
    </div>
    <div class="hero-marquee-poster episode-poster">
      <img src="${art}" alt="${escapeHtml(title)}" />
      <span class="hero-tape hero-tape--tl"></span><span class="hero-tape hero-tape--br"></span>
    </div>
    <div class="episode-copy">
      ${buildBillingHtml(notes?.billing)}
      ${buildRansomTitleHtml(title)}
      <p class="hero-marquee-meta">
        ${tag ? `<span class="hero-chip">${escapeHtml(tag)}</span>` : ''}
        ${ep?.pubDate ? `<span>${formatDate(ep.pubDate)}</span>` : ''}
        ${runtime ? `<span>${runtime}</span>` : ''}
      </p>
      <button id="episode-play-btn" class="btn btn-primary episode-play" data-play>${PLAY_ICON} Play it</button>
    </div>
  </div>`;
}

/**
 * The Reel: Chapters as frames on a film strip, each frame as wide as its share
 * of the runtime. Every frame is a button carrying data-seek (seconds). Empty
 * string when the Episode has no Chapters.
 *
 * chapters: parseShowNotes(...).chapters
 */
export function buildEpisodeReelHtml(chapters) {
  if (!Array.isArray(chapters) || chapters.length === 0) return '';
  // A last Chapter of unknown length is drawn as wide as the average of the rest.
  const known = chapters.filter((c) => c.len > 0);
  const avg = known.length ? known.reduce((a, c) => a + c.len, 0) / known.length : 1;

  const frames = chapters.map((c, i) => `
    <button class="episode-frame" data-seek="${c.secs}" style="flex-grow:${Math.round(c.len || avg)}" title="Play from ${escapeHtml(c.at)}" aria-label="Play from ${escapeHtml(c.at)}: ${escapeHtml(c.label)}">
      <span class="episode-frame-go" aria-hidden="true">${PLAY_ICON}</span>
      <span class="episode-frame-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
      <span class="episode-frame-label">${escapeHtml(c.label)}</span>
      <span class="episode-frame-at">${escapeHtml(c.at)}</span>
    </button>`).join('');

  return `<section class="episode-reel" aria-label="Chapters">
    <div class="episode-reel-head">
      <p class="hero-stencil episode-reel-k">The reel · ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}</p>
      <p class="episode-reel-hint"><span class="episode-cut-paper"></span>${PLAY_ICON}<span><span class="episode-reel-hint--click">Click</span><span class="episode-reel-hint--tap">Tap</span> any frame to jump straight to that part</span><span class="episode-reel-hint-arrow" aria-hidden="true">↓</span></p>
    </div>
    <div class="episode-film">
      <span class="hero-tape episode-reel-tape episode-reel-tape--l"></span>
      <span class="hero-tape episode-reel-tape episode-reel-tape--r"></span>
      <span class="episode-sprockets"></span>
      <div class="episode-frames">${frames}</div>
      <span class="episode-sprockets"></span>
    </div>
  </section>`;
}

/**
 * The lower wall: the film quote on a taped strip, and the synopsis (or the
 * whole description, when the notes don't follow the pattern) on a flyer.
 *
 * notes: parseShowNotes(...)
 */
export function buildEpisodeLowerHtml(notes) {
  const quote = notes?.quote
    ? `<div class="episode-quote"><span class="hero-tape hero-tape--tl"></span><p>“${escapeHtml(notes.quote)}”</p></div>`
    : '';
  const prose = notes?.proseHtml || '<p class="episode-muted">No description available for this episode.</p>';
  return `<div class="episode-lower">
    ${quote}
    <div class="episode-flyer">
      <span class="episode-flyer-paper"></span>
      <p class="hero-stencil hero-stencil--sm">${notes?.billing ? 'The film' : 'Show notes'}</p>
      <div class="episode-prose">${prose}</div>
    </div>
  </div>`;
}
