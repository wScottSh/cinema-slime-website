// Cover art for Essay cards in the Discovery View.
//
// Every card gets a cover band, resolved through a cascade:
//   hero `image` tag  ->  first image embedded in the body  ->  generated film leader.
// Why the no-art treatment is a film leader and not the brand mark: see ADR 0009.
//
// Pure functions only — no DOM access, all builders return HTML strings.

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ========================= body image extraction =========================
   Three embed styles appear in long-form Nostr bodies. Each pattern is scanned
   independently and the match appearing EARLIEST in the body wins, so the cover
   is the first image a reader would actually see — not merely the first style
   that happens to be listed here.

   The bare-URL pattern excludes URLs preceded by `(`, `"`, `'` or `]` so that a
   markdown or <img> URL is never double-counted as a "bare" one.

   A bare URL in prose is usually followed by ordinary sentence punctuation, so the
   pattern ends on a lookahead at a terminator rather than consuming one — a trailing
   period, comma, semicolon, colon, exclamation mark, question mark or closing
   bracket/paren/quote must not defeat the match. A genuine query string is still
   captured as part of the URL, but a query string may not END on punctuation, which
   is how a sentence-final question mark stays out of it. */
const BODY_IMAGE_PATTERNS = [
  /!\[[^\]]*\]\(\s*(\S+?)(?:\s+["'][^"']*["'])?\s*\)/gi,  // ![alt](url "title")
  /<img[^>]+src\s*=\s*["']([^"']+)["']/gi,                // <img src="url">
  /(?<!["'(\]])(https?:\/\/\S+?\.(?:png|jpe?g|gif|webp|avif)(?:\?\S*[^\s.,;:!?)\]}<>"'])?)(?=[\s.,;:!?)\]}<>"']|$)/gi, // bare url
];

export function extractBodyImage(body) {
  if (typeof body !== 'string' || body === '') return null;

  let best = null;
  for (const pattern of BODY_IMAGE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const url = (match[1] || '').trim();
      // data: URIs are inline blobs, not addressable cover art.
      if (url === '' || url.startsWith('data:')) continue;
      if (best === null || match.index < best.index) best = { index: match.index, url };
      break; // only each pattern's first usable hit can be the earliest overall
    }
  }
  return best === null ? null : best.url;
}

/** Resolve an Essay's cover URL, or null when the film leader should be used instead. */
export function resolveCoverImage(essay) {
  if (!essay || typeof essay !== 'object') return null;
  const hero = typeof essay.image === 'string' ? essay.image.trim() : '';
  if (hero !== '') return hero;
  return extractBodyImage(essay.body);
}

/* ========================= film leader =========================
   The generated no-art treatment: a sprocketed film-strip band over a
   deterministic brand-palette gradient, with a small CINEMA SLIME wordmark.
   Deterministic so a given Essay always wears the same leader.

   The colours are hardcoded rather than read from CSS custom properties because
   they are baked into generated markup where CSS vars cannot reach — the same
   precedent as `hero-bg-tiles.js`. They mirror the design tokens in style.css:
   #39ff14 is --slime-green, #e63220 is --cinema-red, #0a0a0a is --bg-void.
   #ff8c00 has no corresponding custom property. */
const PALETTES = [
  ['#39ff14', '#0a0a0a'],
  ['#e63220', '#0a0a0a'],
  ['#ff8c00', '#0a0a0a'],
  ['#39ff14', '#e63220'],
  ['#e63220', '#ff8c00'],
];

function seedFor(text) {
  let hash = 0;
  for (const ch of String(text ?? '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [from, to] = PALETTES[hash % PALETTES.length];
  return { from, to, angle: 100 + (hash % 7) * 20 };
}

export function buildFilmLeaderHtml(seedText) {
  const { from, to, angle } = seedFor(seedText);
  return `<div class="essay-cover-leader" style="--leader-from:${from};--leader-to:${to};--leader-angle:${angle}deg" aria-hidden="true">` +
    `<span class="essay-cover-sprockets essay-cover-sprockets--left"></span>` +
    `<span class="essay-cover-sprockets essay-cover-sprockets--right"></span>` +
    `<span class="essay-cover-mark">CINEMA SLIME</span>` +
    `</div>`;
}

/* ========================= the cover band =========================
   The film leader is always rendered, and a resolved cover image is layered on
   top of it. That is what makes the runtime 404 fallback trivial: `onerror`
   simply removes the dead <img>, revealing the leader already sitting behind it.
   No second copy of the leader has to be smuggled through a data- attribute. */
export function buildEssayCoverHtml(essay) {
  const title = (essay && essay.title) || '';
  const url = resolveCoverImage(essay);
  const leader = buildFilmLeaderHtml(title);
  const img = url === null
    ? ''
    : `<img class="essay-cover-img" src="${escapeHtml(url)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.remove()">`;
  return `<div class="essay-card-image">${leader}${img}</div>`;
}
