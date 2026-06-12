// Pure rendering functions for the Essays collection in the Discovery View.
// No DOM access — all functions return HTML strings.

import { buildEssayHash } from './router.js';

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
  const { title, authorName, publishedAt, image } = essay;
  const href = buildEssayHash(slug || coordinate);
  const date = formatDate(publishedAt);
  const authorHtml = authorName
    ? `<p class="essay-card-author">${escapeHtml(authorName)}</p>`
    : '';
  // No brand-mark fallback when image is absent — intentional asymmetry with the Essay Page
  // hero (which falls back to the brand mark). Showing repeated logos across the grid would
  // dilute the mark; text-only cards are the clean default here.
  const imageBandHtml = typeof image === 'string' && image.trim() !== ''
    ? `<div class="essay-card-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.parentElement.remove()"></div>`
    : '';
  return `<a href="${href}" class="episode-card-link"><article class="episode-card essay-card animate-in">
    ${imageBandHtml}<div class="episode-card-body">
      <p class="card-ep">ESSAY</p>
      <h3>${escapeHtml(title)}</h3>
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
