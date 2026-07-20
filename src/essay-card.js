// Pure rendering functions for the Essays collection in the Discovery View.
// No DOM access — all functions return HTML strings.

import { buildEssayHash } from './router.js';
import { buildEssayCoverHtml } from './essay-cover.js';

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

export function buildEssayCardHtml(coordinate, essay, slug) {
  const { title, authorName, publishedAt } = essay;
  const href = buildEssayHash(slug || coordinate);
  const date = formatDate(publishedAt);
  // The author line is always emitted, even with no Cinema Slime Name, so it reserves
  // its space and neighbouring cards in a row keep a common baseline.
  const authorHtml = authorName
    ? `<p class="essay-card-author">${escapeHtml(authorName)}</p>`
    : `<p class="essay-card-author essay-card-author--empty">&nbsp;</p>`;
  // Every card carries a cover band of identical aspect ratio: hero image, else the first
  // image in the body, else a generated film leader. This supersedes the earlier decision
  // to show no art at all when the hero image tag was absent — that reasoning was about
  // repeating the *brand mark* across the grid, which the film leader is not, and the
  // body-image step means the generated treatment is an edge case rather than the norm.
  const imageBandHtml = buildEssayCoverHtml(essay);
  return `<a href="${href}" class="episode-card-link"><article class="episode-card essay-card animate-in">
    ${imageBandHtml}<div class="episode-card-body">
      <p class="card-ep">ESSAY</p>
      <h3>${escapeHtml(title || 'Untitled')}</h3>
      ${authorHtml}
      <div class="card-meta"><span>${date}</span></div>
    </div>
  </article></a>`;
}

export function buildEssaysSectionHtml(entries) {
  if (entries === null || entries === undefined) {
    return `<p class="essays-state essays-state--failure">Essays are currently unreachable — relays unavailable. Please try again later.</p>`;
  }
  if (entries.length === 0) {
    return `<p class="essays-state essays-state--empty">No essays have been published yet.</p>`;
  }
  return entries.map(({ coordinate, essay, slug }) => buildEssayCardHtml(coordinate, essay, slug)).join('');
}
