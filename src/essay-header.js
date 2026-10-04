// Pure HTML-string builders for the Essay Page's projection header and rail
// (ADR 0018). No DOM access — every export returns an HTML string. Mirrors the
// essay-card.js pattern.
import { resolveCoverImage, buildFilmLeaderHtml } from './essay-cover.js';

const WORDS_PER_MINUTE = 230;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Whole minutes to read an Essay body, never less than one. URLs and tags are not words. */
export function readingMinutes(body) {
  const words = String(body ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\S*https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

// The screen: the Essay's cover, full-bleed and projector-lit, with the title
// struck across its bottom. The cover resolves through the same cascade as the
// Discovery cards (ADR 0009) — the film leader is always rendered underneath, so
// an image that 404s removes itself and reveals it.
//
// The `.hero-stencil` kicker needs the grunge <defs> in the document; the Essay
// Page renders them alongside this header.
//
// essay: { title, image, body }
export function buildEssayHeaderHtml(essay) {
  const title = (essay && essay.title) || '';
  const url = resolveCoverImage(essay);
  const img = url === null
    ? ''
    : `<img class="essay-screen-img" src="${escapeHtml(url)}" alt="${escapeHtml(title)}" onerror="this.remove()">`;

  return `<header class="essay-screen">
  <div class="essay-screen-cover">${buildFilmLeaderHtml(title)}${img}</div>
  <div class="essay-screen-light"></div>
  <span class="essay-screen-sprockets essay-screen-sprockets--l"></span>
  <span class="essay-screen-sprockets essay-screen-sprockets--r"></span>
  <div class="essay-screen-titleblock">
    <span class="hero-stencil">Essay</span>
    <h1 class="essay-screen-title">${escapeHtml(title || 'Untitled')}</h1>
  </div>
</header>`;
}

// The rail: pasted labels beside the reading column — way back, Cinema Slime
// Name byline, date, read time, and whatever social proof the caller has.
//
// essay: { authorName, publishedAt, body }
export function buildEssayRailHtml(essay, { socialProofHtml = '' } = {}) {
  const { authorName = '', publishedAt = 0, body = '' } = essay || {};

  const bylineHtml = authorName
    ? `<div class="essay-rail-block"><span class="essay-rail-k">Written by</span><span class="hero-chip essay-author">${escapeHtml(authorName)}</span></div>`
    : '';

  return `<aside class="essay-rail">
  <div class="essay-rail-inner">
    <a href="/" id="back-from-essay" class="essay-rail-back">← Back to Cinema Slime</a>
    ${bylineHtml}
    <div class="essay-rail-block"><span class="essay-rail-k">Posted</span><span class="essay-rail-v">${formatDate(publishedAt)}</span></div>
    <div class="essay-rail-block"><span class="essay-rail-k">Read</span><span class="essay-rail-v">${readingMinutes(body)} min</span></div>
    ${socialProofHtml ? `<div class="essay-rail-block">${socialProofHtml}</div>` : ''}
  </div>
</aside>`;
}

/** The summary deck opening the reading column, or '' when the Essay has none. */
export function buildEssayDeckHtml(essay) {
  const summary = essay && essay.summary;
  return summary ? `<p class="essay-deck">${escapeHtml(summary)}</p>` : '';
}
