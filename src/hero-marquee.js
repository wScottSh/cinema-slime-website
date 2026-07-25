// The above-the-fold foreground of the Discovery View: one Episode and one
// Essay, in a back-alley paste-up register.
//
// Shape, and why:
//   - Exactly ONE latest Episode and ONE latest Essay. A row of either reads as
//     a grid and flattens the hierarchy the fold exists to create.
//   - The Episode's own artwork, blown out and bled, IS the panel — opaque art
//     punching through the film-reel background rather than a translucent card
//     floating on it, which the reel turned to mush.
//   - The logo is a sticker slapped over the top-right, dripping down across the
//     Episode title's first line. It is the biggest thing above the fold and is
//     allowed to cover words; you can still read behind it. There is therefore
//     no typed CINEMA / SLIME headline any more, and no separate eye stamp —
//     the eye is part of the logo sheet.
//   - The season tag is what's surfaced. "EPISODE 10" beside "70 EPISODES" was
//     conflicting data; "S2 · E10" beside "70 episodes deep" is a catalogue.
//
// The grunge is CSS/SVG only — no image assets. See ADR 0011.
//
// Pure functions only — no DOM access, all builders return HTML strings.

import { buildEssayHash } from './router.js';
import { resolveCoverImage, buildFilmLeaderHtml } from './essay-cover.js';

/* Drawn from the voice already on the About section ("film obsession gets
   gloriously messy", "no genre is safe from the slime treatment") rather than
   written fresh. */
const DECK = 'Film obsession, gloriously messy.';
const SUB = 'Four films drawn at random every month. No genre survives the slime treatment.';

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

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

function formatEssayDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ========================= the grunge toolkit =========================
   Every ragged edge here is an feTurbulence displacement of a *paper layer*
   sitting beneath the type — never of the type itself. clip-path polygons were
   tried and rejected: a repeating zigzag reads as hand-cut construction paper,
   where fractal noise reads as torn stock.

   These <defs> must be in the document for `filter: url(#…)` to resolve, and
   exactly once — they are rendered with the hero shell, outside the chunk that
   re-renders when Episode or Essay data arrives. */
export function buildGrungeFiltersHtml() {
  return `<svg class="hero-grunge-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    <filter id="grunge-torn" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.03 0.06" numOctaves="5" seed="11" result="noise" />
      <!-- Blurring the noise first is what stops the torn edge stair-stepping. -->
      <feGaussianBlur in="noise" stdDeviation="0.7" result="softNoise" />
      <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="22" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id="grunge-torn-sm" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.05 0.09" numOctaves="5" seed="3" result="noise" />
      <feGaussianBlur in="noise" stdDeviation="0.6" result="softNoise" />
      <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="12" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <!-- Low amplitude: on small type this reads as ink bleeding into rough stock. -->
    <filter id="grunge-ink" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.14 0.2" numOctaves="3" seed="5" result="noise" />
      <feGaussianBlur in="noise" stdDeviation="0.4" result="softNoise" />
      <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <!-- Photocopier grain, generated rather than tiled, so it has no seam. -->
    <filter id="grunge-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
  </defs></svg>`;
}

/* ========================= episode identity ========================= */

/** How the brand identifies an Episode above the fold: by season, not by raw number. */
export function buildSeasonTag(ep) {
  if (!ep) return '';
  if (ep.episodeType === 'bonus') return 'BONUS';
  if (ep.episodeType === 'trailer') return 'TRAILER';
  const season = String(ep.season ?? '').trim();
  const episode = String(ep.episode ?? '').trim();
  if (season && episode) return `S${season} · E${episode}`;
  if (episode) return `EP ${episode}`;
  return '';
}

/** The catalogue count, demoted to a depth line beside the season tag. */
export function buildCatalogueLine(count) {
  return count ? `${count} episodes deep` : '';
}

/** The one Episode above the fold: the newest full episode, or the newest of any type. */
export function pickLatestEpisode(episodes) {
  if (!Array.isArray(episodes) || episodes.length === 0) return null;
  const episode = episodes.find(e => e.episodeType === 'full') || episodes[0];
  return { episode, index: episodes.indexOf(episode) };
}

/* ========================= the pieces ========================= */

function buildFlyerHtml(entry) {
  if (!entry) return '';
  const { coordinate, slug, essay } = entry;
  const url = resolveCoverImage(essay);
  const leader = buildFilmLeaderHtml(essay.title || '');
  const img = url
    ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  const author = essay.authorName ? `${escapeHtml(essay.authorName)} · ` : '';

  return `<a class="hero-essay-flyer" href="${buildEssayHash(slug || coordinate)}" data-essay="1">
    <span class="hero-essay-flyer-paper"></span>
    <span class="hero-essay-flyer-art">${leader}${img}</span>
    <span class="hero-essay-flyer-body">
      <span class="hero-stencil hero-stencil--sm">Fresh ink · Latest essay</span>
      <span class="hero-essay-flyer-title">${escapeHtml(essay.title)}</span>
      <span class="hero-essay-flyer-meta">${author}${formatEssayDate(essay.publishedAt)}</span>
    </span>
    <span class="hero-tape hero-tape--tl"></span>
  </a>`;
}

function buildSkeletonPanelHtml() {
  return `<div class="hero-marquee-panel hero-marquee--skeleton" aria-hidden="true">
    <div class="hero-marquee-paper"><div class="hero-marquee-scrim"></div></div>
    <div class="hero-marquee-halftone"></div>
    <div class="hero-marquee-inner">
      <div class="hero-marquee-poster"><div class="skeleton-block"></div></div>
      <div class="hero-marquee-copy">
        <div class="skeleton-line skeleton-line--sm"></div>
        <div class="skeleton-line skeleton-line--lg"></div>
        <div class="skeleton-line skeleton-line--md"></div>
        <div class="skeleton-line skeleton-line--sm"></div>
      </div>
    </div>
  </div>`;
}

function buildPanelHtml({ episode, episodeIndex, episodeCount, description }) {
  const title = cleanTitle(episode.title);
  const seasonTag = buildSeasonTag(episode);
  const catalogue = buildCatalogueLine(episodeCount);

  return `<div class="hero-marquee-panel" data-idx="${episodeIndex}" data-open="${escapeHtml(episode.guid)}">
    <!-- The paper layer carries the art and the scrim and gets displaced into a
         torn edge; .hero-marquee-inner sits above it so the type stays sharp. -->
    <div class="hero-marquee-paper">
      <div class="hero-marquee-bleed" style="background-image:url('${escapeHtml(episode.image)}')"></div>
      <div class="hero-marquee-scrim"></div>
    </div>
    <div class="hero-marquee-halftone"></div>
    <div class="hero-marquee-grain"></div>
    <div class="hero-marquee-inner">
      <div class="hero-marquee-poster">
        <img src="${escapeHtml(episode.image)}" alt="${escapeHtml(title)}" />
        <span class="hero-tape hero-tape--tl"></span><span class="hero-tape hero-tape--br"></span>
      </div>
      <div class="hero-marquee-copy">
        <p class="hero-stencil">Fresh slime</p>
        <h2 class="hero-marquee-title">${escapeHtml(title)}</h2>
        <p class="hero-marquee-meta">
          ${seasonTag ? `<span class="hero-chip">${escapeHtml(seasonTag)}</span>` : ''}
          <span>${formatDate(episode.pubDate)}</span><span>${escapeHtml(episode.duration || '')}</span>
          ${catalogue ? `<span class="hero-marquee-meta-dim">${catalogue}</span>` : ''}
        </p>
        <p class="hero-marquee-desc">${escapeHtml(description || '')}</p>
        <div class="hero-cta-group">
          <button class="btn btn-primary hero-marquee-play" data-play="${episodeIndex}">${PLAY_ICON} Play it</button>
          <span class="hero-marquee-link" data-open-link="1">Show notes →</span>
        </div>
      </div>
    </div>
  </div>`;
}

/* ========================= the whole foreground =========================
   DOM order is panel, deck, sticker, flyer. The deck and the sticker are
   absolutely positioned on desktop; the stacked layout re-orders the deck back
   above the panel (see style.css). */

export function buildHeroMarqueeHtml({
  episode = null,
  episodeIndex = 0,
  episodeCount = 0,
  description = '',
  essayEntry = null,
  logoUrl = '',
  loading = false,
} = {}) {
  const panel = loading
    ? buildSkeletonPanelHtml()
    : (episode ? buildPanelHtml({ episode, episodeIndex, episodeCount, description }) : '');

  return `<div class="hero-marquee">
    ${panel}
    <div class="hero-deck">
      <p class="hero-deck-line">${DECK}</p>
      <p class="hero-deck-sub">${SUB}</p>
    </div>
    <img class="hero-sticker" src="${escapeHtml(logoUrl)}" alt="Cinema Slime Podcast" />
    ${buildFlyerHtml(essayEntry)}
  </div>`;
}
