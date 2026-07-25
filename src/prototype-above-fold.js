// =============================================================================
// PROTOTYPE — THROWAWAY CODE. DO NOT SHIP.
//
// Question: what should the above-the-fold foreground of the Discovery View
// look like, now that (a) the wordmark lives inside the full logo image and
// (b) the film-reel background makes the old translucent cards read as mush?
//
// Round 2 (after review of round 1). What the review settled:
//   - ONE latest Episode and ONE latest Essay above the fold. Never a row of
//     either — multiples read as a grid and kill the hierarchy.
//   - Direction A (artwork bled edge-to-edge as the panel itself) won, with
//     D's enormous-artwork scale as the other thing worth keeping.
//   - Push it grungier: back-alley flyposting, spray stencil, torn paper and
//     tape. Let the logo and the eye overlap the artwork instead of sitting
//     politely above it.
//   - Copy is up for grabs; rewrite it in-voice rather than adding new content.
//   - Surface the SEASON tag. "EPISODE 10" beside "70 EPISODES" is conflicting
//     data — it's Season 2 Episode 10 of a 70-strong catalogue.
//
// Settled in ALL variants (not the thing under test):
//   - nav drops the logo image, keeps the CINEMA SLIME wordmark text
//   - hero drops the typed CINEMA / SLIME <h1> in favour of the full logo image
//   - the scrolling film-reel background is untouched
//
// Fold the winner into main.js / style.css properly; delete this file.
// =============================================================================

import { buildEssayHash } from './router.js';
import { resolveCoverImage, buildFilmLeaderHtml } from './essay-cover.js';

export const PROTO_VARIANTS = [
  { key: 'X', name: 'Baseline (round 1 control)' },
  { key: 'A', name: 'Grunge marquee' },
  { key: 'B', name: 'Flyposter paste-up' },
  { key: 'C', name: 'Spray stencil' },
  { key: 'D', name: 'Zine spread' },
  { key: 'G', name: 'Sticker slap (round 3)' },
  { key: 'H', name: 'Sticker slap, heavy grime (round 3)' },
];

const DEFAULT_VARIANT = 'G';

export function getProtoVariant(search = window.location.search) {
  const key = (new URLSearchParams(search).get('variant') || '').toUpperCase();
  return PROTO_VARIANTS.some(v => v.key === key) ? key : DEFAULT_VARIANT;
}

/* ============================ rewritten copy ============================
   Drawn from the voice already on the About section ("film obsession gets
   gloriously messy", "no genre is safe from the slime treatment") rather than
   invented from scratch. */
const COPY = {
  deck: 'Film obsession, gloriously messy.',
  sub: 'Four films drawn at random every month. No genre survives the slime treatment.',
  hosts: 'Harrison · Renn · Scott',
};

/* ============================ shared bits ============================ */

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* The eye is not a separate asset — it lives at the foot of cs-logo.png. This
   crops the sheet down to it so it can be used as a stamp/spray mark. */
function eyeHtml(className = '') {
  return `<span class="pv-eye ${className}" aria-hidden="true"></span>`;
}

/* SEASON is the thing that was missing. "EPISODE 10" next to "70 EPISODES"
   reads as broken data; "S2 · E10" next to "70 deep" reads as a catalogue. */
function seasonTag(ep) {
  if (!ep) return '';
  if (ep.episodeType === 'bonus') return 'BONUS';
  if (ep.episodeType === 'trailer') return 'TRAILER';
  const s = String(ep.season || '').trim();
  const e = String(ep.episode || '').trim();
  if (s && e) return `S${s} · E${e}`;
  if (e) return `EP ${e}`;
  return '';
}

function catalogueLine(ctx) {
  const n = (ctx.episodes || []).length;
  return n ? `${n} episodes deep` : '';
}

function essayArtHtml(essay, className) {
  const url = resolveCoverImage(essay);
  const leader = buildFilmLeaderHtml(essay.title || '');
  const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()" />` : '';
  return `<div class="${className}">${leader}${img}</div>`;
}

function essayDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* Exactly one Essay, always — never a row of them. */
function latestEssay(ctx) {
  return Array.isArray(ctx.essays) && ctx.essays.length ? ctx.essays[0] : null;
}

function latestOf(ctx) {
  const eps = ctx.episodes || [];
  const latest = eps.find(e => e.episodeType === 'full') || eps[0];
  return latest ? { ep: latest, idx: eps.indexOf(latest) } : null;
}

function loadingHtml() {
  return `<div class="pv-loading">DEVELOPING&hellip;</div>`;
}

/* ============================ variant X — baseline ============================
   Round 1's control, kept so the grunge variants have something to be judged
   against. Deliberately not updated. */

function heroX(ctx) {
  return `
    <div class="pv-branding pv-branding--lg">
      <img class="pv-logo" src="${ctx.logo}" alt="Cinema Slime Podcast" />
      <p class="pv-tagline">Every month we randomly pick 4 films to watch and discuss. Deep dives, hot takes, and slimey ratings.</p>
      <p class="pv-hosts">Harrison Jensen · Renn Jensen · Scott Sheppard</p>
    </div>
    <div id="hero-dynamic">${dynamicX(ctx)}</div>`;
}

function dynamicX(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  const { cleanTitle, formatDate, getEpLabel, getShortDescription } = ctx.helpers;
  const entry = latestEssay(ctx);
  const spotlight = entry ? `<a href="${buildEssayHash(entry.slug || entry.coordinate)}" class="pv-x-essay" data-essay="1">
      ${essayArtHtml(entry.essay, 'pv-x-essay-art')}
      <div class="pv-x-essay-body">
        <p class="pv-eyebrow">LATEST ESSAY</p>
        <h3>${esc(entry.essay.title)}</h3>
        <p class="pv-x-essay-meta">${entry.essay.authorName ? 'by ' + esc(entry.essay.authorName) + ' · ' : ''}${essayDate(entry.essay.publishedAt)}</p>
      </div>
    </a>` : '';

  if (!latest) return spotlight;
  const { ep, idx } = latest;
  return `
    <div class="pv-x-latest" data-idx="${idx}" data-open="${esc(ep.guid)}">
      <div class="pv-x-latest-art">
        <img src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" />
        <span class="pv-badge">LATEST EPISODE</span>
      </div>
      <div class="pv-x-latest-info">
        <span class="pv-eyebrow">${esc(getEpLabel(ep))}</span>
        <h2>${esc(cleanTitle(ep.title))}</h2>
        <span class="pv-x-latest-date">${formatDate(ep.pubDate)} · ${esc(ep.duration || '')}</span>
        <p class="pv-x-latest-desc">${esc(getShortDescription(ep.description))}</p>
        <div class="pv-cta-row">
          <button class="pv-btn pv-btn--primary" data-play="${idx}">▶ Play Now</button>
          <a class="pv-btn pv-btn--ghost" href="${ctx.social.youtube.url}" target="_blank" rel="noopener">YouTube</a>
        </div>
      </div>
    </div>
    <p class="pv-count">${(ctx.episodes || []).length} EPISODES AND COUNTING</p>
    ${spotlight}`;
}

/* ============================ variant A — grunge marquee =====================
   Round 1's winner, dirtied up. The Episode's own artwork, blown out and bled,
   IS the panel — opaque art punching through the reel rather than a translucent
   card floating on it. What's new: the poster is a taped-up print rotated off
   true, the logo breaks the panel's top-left corner instead of sitting above
   it, the eye is sprayed over the bottom-right, and the single Essay is a torn
   flyer pasted onto the panel's bottom edge. */

function heroA(ctx) {
  return `
    <div class="pv-branding pv-branding--a">
      <img class="pv-logo" src="${ctx.logo}" alt="Cinema Slime Podcast" />
      <p class="pv-deck">${COPY.deck}</p>
      <p class="pv-sub">${COPY.sub}</p>
    </div>
    <div id="hero-dynamic">${dynamicA(ctx)}</div>`;
}

function dynamicA(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  if (!latest) return '';
  const { ep, idx } = latest;
  const { cleanTitle, formatDate, getShortDescription } = ctx.helpers;
  const entry = latestEssay(ctx);

  const flyer = entry ? `
    <a class="pv-a-flyer" href="${buildEssayHash(entry.slug || entry.coordinate)}" data-essay="1">
      ${essayArtHtml(entry.essay, 'pv-a-flyer-art')}
      <span class="pv-a-flyer-body">
        <span class="pv-stencil pv-stencil--sm">Fresh ink · Latest essay</span>
        <span class="pv-a-flyer-title">${esc(entry.essay.title)}</span>
        <span class="pv-a-flyer-meta">${entry.essay.authorName ? esc(entry.essay.authorName) + ' · ' : ''}${essayDate(entry.essay.publishedAt)}</span>
      </span>
    </a>` : '';

  return `
    <div class="pv-a-wrap">
      <div class="pv-a-marquee" data-idx="${idx}" data-open="${esc(ep.guid)}">
        <div class="pv-a-bleed" style="background-image:url('${esc(ep.image)}')"></div>
        <div class="pv-a-scrim"></div>
        <div class="pv-a-halftone"></div>
        ${eyeHtml('pv-eye--a')}
        <div class="pv-a-inner">
          <div class="pv-a-poster">
            <img src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" />
            <span class="pv-tape pv-tape--tl"></span><span class="pv-tape pv-tape--br"></span>
          </div>
          <div class="pv-a-copy">
            <p class="pv-stencil">Fresh slime</p>
            <h2 class="pv-a-title">${esc(cleanTitle(ep.title))}</h2>
            <p class="pv-a-meta">
              <span class="pv-chip">${esc(seasonTag(ep))}</span>
              <span>${formatDate(ep.pubDate)}</span><span>${esc(ep.duration || '')}</span>
              <span class="pv-a-meta-dim">${catalogueLine(ctx)}</span>
            </p>
            <p class="pv-a-desc">${esc(getShortDescription(ep.description))}</p>
            <div class="pv-cta-row">
              <button class="pv-btn pv-btn--primary pv-btn--big" data-play="${idx}">${ctx.icons.play} Play it</button>
              <span class="pv-a-link" data-open-link="1">Show notes →</span>
            </div>
          </div>
        </div>
      </div>
      ${flyer}
    </div>`;
}

/* ============================ variant B — flyposter paste-up =================
   The fold as a back-alley wall. One Episode poster pasted up crooked with torn
   edges and tape, the logo slapped across its top corner half-on/half-off, the
   details scrawled beside it, and the single Essay stapled underneath as a
   smaller torn flyer. No panel, no card — just paper on brick. */

function heroB(ctx) {
  return `<div id="hero-dynamic">${dynamicB(ctx)}</div>`;
}

function dynamicB(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  if (!latest) return '';
  const { ep, idx } = latest;
  const { cleanTitle, formatDate } = ctx.helpers;
  const entry = latestEssay(ctx);

  const flyer = entry ? `
    <a class="pv-b-flyer" href="${buildEssayHash(entry.slug || entry.coordinate)}" data-essay="1">
      ${essayArtHtml(entry.essay, 'pv-b-flyer-art')}
      <span class="pv-b-flyer-body">
        <span class="pv-stencil pv-stencil--sm">Latest essay</span>
        <span class="pv-b-flyer-title">${esc(entry.essay.title)}</span>
        <span class="pv-b-flyer-meta">${entry.essay.authorName ? esc(entry.essay.authorName) + ' · ' : ''}${essayDate(entry.essay.publishedAt)}</span>
      </span>
      <span class="pv-tape pv-tape--tl"></span>
    </a>` : '';

  return `
    <div class="pv-b-wall">
      <div class="pv-b-paste" data-idx="${idx}" data-open="${esc(ep.guid)}">
        <div class="pv-b-poster">
          <img src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" />
          <span class="pv-tape pv-tape--tl"></span><span class="pv-tape pv-tape--tr"></span>
          <span class="pv-tape pv-tape--bl"></span><span class="pv-tape pv-tape--br"></span>
          <button class="pv-b-play" data-play="${idx}" aria-label="Play">${ctx.icons.play}</button>
        </div>
        <img class="pv-b-slap" src="${ctx.logo}" alt="Cinema Slime" />
      </div>

      <div class="pv-b-scrawl">
        <p class="pv-deck pv-deck--b">${COPY.deck}</p>
        <p class="pv-sub">${COPY.sub}</p>
        <p class="pv-stencil">Now playing</p>
        <h2 class="pv-b-title">${esc(cleanTitle(ep.title))}</h2>
        <p class="pv-b-meta">
          <span class="pv-chip pv-chip--big">${esc(seasonTag(ep))}</span>
          <span>${formatDate(ep.pubDate)} · ${esc(ep.duration || '')}</span>
        </p>
        <p class="pv-b-cat">${catalogueLine(ctx)} · ${COPY.hosts}</p>
        ${flyer}
      </div>
      ${eyeHtml('pv-eye--b')}
    </div>`;
}

/* ============================ variant C — spray stencil ======================
   Round 1's D scale, aimed at one Episode. Near-full-bleed artwork carries the
   whole fold; the logo is sprayed across it oversized and half-transparent so
   it reads as paint on the image rather than a mark placed on top; the title is
   knocked out in stencil type along the bottom; the single Essay is a torn band
   running off the bottom-right corner. */

function heroC(ctx) {
  return `<div id="hero-dynamic">${dynamicC(ctx)}</div>`;
}

function dynamicC(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  if (!latest) return '';
  const { ep, idx } = latest;
  const { cleanTitle, formatDate } = ctx.helpers;
  const entry = latestEssay(ctx);

  const band = entry ? `
    <a class="pv-c-band" href="${buildEssayHash(entry.slug || entry.coordinate)}" data-essay="1">
      ${essayArtHtml(entry.essay, 'pv-c-band-art')}
      <span class="pv-c-band-body">
        <span class="pv-stencil pv-stencil--sm">Latest essay</span>
        <span class="pv-c-band-title">${esc(entry.essay.title)}</span>
      </span>
      <span class="pv-c-band-meta">${entry.essay.authorName ? esc(entry.essay.authorName) + ' · ' : ''}${essayDate(entry.essay.publishedAt)}</span>
    </a>` : '';

  return `
    <div class="pv-c-stage" data-idx="${idx}" data-open="${esc(ep.guid)}">
      <img class="pv-c-art" src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" />
      <div class="pv-c-grade"></div>
      <img class="pv-c-spray" src="${ctx.logo}" alt="" aria-hidden="true" />
      <div class="pv-c-halftone"></div>
      <button class="pv-c-play" data-play="${idx}" aria-label="Play">${ctx.icons.play}</button>
      <div class="pv-c-plate">
        <p class="pv-c-deck">${COPY.deck}</p>
        <h2 class="pv-c-title">${esc(cleanTitle(ep.title))}</h2>
        <p class="pv-c-meta">
          <span class="pv-chip pv-chip--big">${esc(seasonTag(ep))}</span>
          <span>${formatDate(ep.pubDate)} · ${esc(ep.duration || '')}</span>
          <span class="pv-a-meta-dim">${catalogueLine(ctx)}</span>
        </p>
      </div>
    </div>
    ${band}`;
}

/* ============================ variant D — zine spread ========================
   Photocopied-zine register: the artwork is duotoned and pushed hard to the
   right of a two-column spread, the left column is heavy condensed type on a
   ruled newsprint block, the logo straddles the gutter between them, and the
   single Essay sits at the foot of the text column as a boxed classified. */

function heroD(ctx) {
  return `<div id="hero-dynamic">${dynamicD(ctx)}</div>`;
}

function dynamicD(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  if (!latest) return '';
  const { ep, idx } = latest;
  const { cleanTitle, formatDate, getShortDescription } = ctx.helpers;
  const entry = latestEssay(ctx);

  const classified = entry ? `
    <a class="pv-d-classified" href="${buildEssayHash(entry.slug || entry.coordinate)}" data-essay="1">
      ${essayArtHtml(entry.essay, 'pv-d-classified-art')}
      <span class="pv-d-classified-body">
        <span class="pv-stencil pv-stencil--sm">Latest essay</span>
        <span class="pv-d-classified-title">${esc(entry.essay.title)}</span>
        <span class="pv-d-classified-meta">${entry.essay.authorName ? esc(entry.essay.authorName) + ' · ' : ''}${essayDate(entry.essay.publishedAt)}</span>
      </span>
    </a>` : '';

  return `
    <div class="pv-d-spread" data-idx="${idx}" data-open="${esc(ep.guid)}">
      <div class="pv-d-column">
        <p class="pv-d-masthead">${COPY.deck}</p>
        <p class="pv-d-rule"></p>
        <p class="pv-stencil">This month</p>
        <h2 class="pv-d-title">${esc(cleanTitle(ep.title))}</h2>
        <p class="pv-d-meta">
          <span class="pv-chip pv-chip--big">${esc(seasonTag(ep))}</span>
          <span>${formatDate(ep.pubDate)} · ${esc(ep.duration || '')} · ${catalogueLine(ctx)}</span>
        </p>
        <p class="pv-d-body">${esc(getShortDescription(ep.description))}</p>
        <div class="pv-cta-row">
          <button class="pv-btn pv-btn--primary" data-play="${idx}">${ctx.icons.play} Play it</button>
          <span class="pv-a-link" data-open-link="1">Show notes →</span>
        </div>
        <p class="pv-d-colophon">${COPY.sub} — ${COPY.hosts}</p>
        ${classified}
      </div>
      <div class="pv-d-plate">
        <img class="pv-d-art" src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" />
        <div class="pv-d-duotone"></div>
        <div class="pv-d-halftone"></div>
        ${eyeHtml('pv-eye--d')}
      </div>
      <img class="pv-d-gutter-logo" src="${ctx.logo}" alt="" aria-hidden="true" />
    </div>`;
}

/* ============================ variants G / H — sticker slap ==================
   Round 3. What the review settled:
     - A's LAYOUT is right (square poster, taped, copy beside it). C's grime
       level is the benchmark, but C's widescreen crop wrecks the square cover
       art, so the artwork stays 1:1.
     - The clip-path zigzags read as "kid with scissors". Every torn edge here
       is instead an SVG feTurbulence displacement of a paper layer — organic,
       non-repeating, fine-grained. Small type gets a low-amplitude version of
       the same filter, which reads as ink bleeding into rough stock.
     - The eye stamp is gone.
     - The logo is now the biggest thing above the fold: a sticker slapped over
       the top-right, dripping down across the copy. It is allowed to cover
       words as long as they can still be inferred from behind it.
   G and H share this markup; H is the same thing with the grime pushed. */

/* The filters live in the DOM once, in a zero-size <svg>. feDisplacementMap on
   a paper layer (never on the text) is what buys the torn edge. */
function grungeDefsHtml() {
  return `
    <svg class="pv-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="pv-torn" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.03 0.06" numOctaves="5" seed="11" result="n" />
          <!-- blurring the noise first is what stops the edge stair-stepping -->
          <feGaussianBlur in="n" stdDeviation="0.7" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="22" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="pv-torn-sm" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.09" numOctaves="5" seed="3" result="n" />
          <feGaussianBlur in="n" stdDeviation="0.6" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="12" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="pv-ink" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.14 0.2" numOctaves="3" seed="5" result="n" />
          <feGaussianBlur in="n" stdDeviation="0.4" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="pv-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
    </svg>`;
}

function heroG(ctx) {
  return `
    ${grungeDefsHtml()}
    <div id="hero-dynamic">${dynamicG(ctx)}</div>`;
}

function dynamicG(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  if (!latest) return '';
  const { ep, idx } = latest;
  const { cleanTitle, formatDate, getShortDescription } = ctx.helpers;
  const entry = latestEssay(ctx);

  const flyer = entry ? `
    <a class="pv-g-flyer" href="${buildEssayHash(entry.slug || entry.coordinate)}" data-essay="1">
      <span class="pv-g-flyer-paper"></span>
      ${essayArtHtml(entry.essay, 'pv-g-flyer-art')}
      <span class="pv-g-flyer-body">
        <span class="pv-stencil pv-stencil--sm">Fresh ink · Latest essay</span>
        <span class="pv-g-flyer-title">${esc(entry.essay.title)}</span>
        <span class="pv-g-flyer-meta">${entry.essay.authorName ? esc(entry.essay.authorName) + ' · ' : ''}${essayDate(entry.essay.publishedAt)}</span>
      </span>
      <span class="pv-tape pv-tape--tl"></span>
    </a>` : '';

  return `
    <div class="pv-g-wrap">
      <div class="pv-g-panel" data-idx="${idx}" data-open="${esc(ep.guid)}">
        <!-- paper layer: everything that gets displaced into a torn edge -->
        <div class="pv-g-paper">
          <div class="pv-g-bleed" style="background-image:url('${esc(ep.image)}')"></div>
          <div class="pv-g-scrim"></div>
        </div>
        <div class="pv-g-halftone"></div>
        <div class="pv-g-grain"></div>
        <div class="pv-g-inner">
          <div class="pv-g-poster">
            <img src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" />
            <span class="pv-tape pv-tape--tl"></span><span class="pv-tape pv-tape--br"></span>
          </div>
          <div class="pv-g-copy">
            <p class="pv-stencil">Fresh slime</p>
            <h2 class="pv-g-title">${esc(cleanTitle(ep.title))}</h2>
            <p class="pv-g-meta">
              <span class="pv-chip">${esc(seasonTag(ep))}</span>
              <span>${formatDate(ep.pubDate)}</span><span>${esc(ep.duration || '')}</span>
              <span class="pv-g-meta-dim">${catalogueLine(ctx)}</span>
            </p>
            <p class="pv-g-desc">${esc(getShortDescription(ep.description))}</p>
            <div class="pv-cta-row">
              <button class="pv-btn pv-btn--primary pv-btn--big" data-play="${idx}">${ctx.icons.play} Play it</button>
              <span class="pv-a-link" data-open-link="1">Show notes →</span>
            </div>
          </div>
        </div>
      </div>
      <!-- the deck sits under the panel's shoulder, left; the sticker owns the right -->
      <div class="pv-g-deck">
        <p class="pv-deck">${COPY.deck}</p>
        <p class="pv-sub">${COPY.sub}</p>
      </div>
      <img class="pv-g-sticker" src="${ctx.logo}" alt="Cinema Slime Podcast" />
      ${flyer}
    </div>`;
}

/* ============================ dispatch ============================ */

const BUILDERS = {
  X: { hero: heroX, dynamic: dynamicX },
  A: { hero: heroA, dynamic: dynamicA },
  B: { hero: heroB, dynamic: dynamicB },
  C: { hero: heroC, dynamic: dynamicC },
  D: { hero: heroD, dynamic: dynamicD },
  G: { hero: heroG, dynamic: dynamicG },
  H: { hero: heroG, dynamic: dynamicG },
};

export function buildProtoHeroContent(variant, ctx) {
  return (BUILDERS[variant] || BUILDERS[DEFAULT_VARIANT]).hero(ctx);
}

export function buildProtoHeroDynamic(variant, ctx) {
  return (BUILDERS[variant] || BUILDERS[DEFAULT_VARIANT]).dynamic(ctx);
}

/* One delegated handler covers every variant: [data-play] plays, [data-open]
   opens the Episode Page, [data-essay] anchors are left alone for the router. */
export function bindProtoHero(variant, ctx) {
  const hero = document.getElementById('hero');
  if (!hero) return;

  // The click handler is delegated on #hero, which survives hero-dynamic
  // re-renders — so attach it exactly once.
  if (hero.dataset.pvBound) return;
  hero.dataset.pvBound = '1';

  hero.addEventListener('click', (e) => {
    const playEl = e.target.closest('[data-play]');
    if (playEl) {
      e.preventDefault();
      e.stopPropagation();
      ctx.play(parseInt(playEl.dataset.play, 10));
      return;
    }
    if (e.target.closest('[data-essay]')) return; // let the hash router handle it
    const openEl = e.target.closest('[data-open]');
    if (openEl) {
      e.preventDefault();
      ctx.openEpisode(openEl.dataset.open);
    }
  });
}

/* ============================ the switcher bar ============================ */

export function buildProtoSwitcherHtml(variant) {
  const i = PROTO_VARIANTS.findIndex(v => v.key === variant);
  const cur = PROTO_VARIANTS[i] || PROTO_VARIANTS[0];
  return `
    <div class="pv-switch" id="pv-switch">
      <button class="pv-switch-arrow" data-step="-1" aria-label="Previous variant">←</button>
      <span class="pv-switch-label"><b>${cur.key}</b> — ${esc(cur.name)}</span>
      <button class="pv-switch-arrow" data-step="1" aria-label="Next variant">→</button>
    </div>`;
}

let switcherKeysBound = false;

export function bindProtoSwitcher(variant) {
  const go = (step) => {
    const i = PROTO_VARIANTS.findIndex(v => v.key === variant);
    const next = PROTO_VARIANTS[(i + step + PROTO_VARIANTS.length) % PROTO_VARIANTS.length].key;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.location.href = url.toString(); // full reload — cheapest way to re-render everything
  };
  document.querySelectorAll('#pv-switch [data-step]').forEach(btn => {
    btn.addEventListener('click', () => go(parseInt(btn.dataset.step, 10)));
  });
  if (switcherKeysBound) return;
  switcherKeysBound = true;
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });
}
