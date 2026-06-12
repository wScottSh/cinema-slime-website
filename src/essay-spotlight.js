// Pure builder for the "Latest Essay" spotlight in the Discovery View hero.
// No DOM access — returns an HTML string or '' when entries are absent/empty.

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

export function buildEssaySpotlightHtml(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const { coordinate, essay, slug } = entries[0];
  const { title, authorName, publishedAt, summary, image } = essay;
  const href = buildEssayHash(slug || coordinate);
  const date = formatDate(publishedAt);

  const artHtml = image
    ? `<div class="essay-spotlight-art"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" /></div>`
    : '';
  const authorHtml = authorName
    ? `<p class="essay-spotlight-author">${escapeHtml(authorName)}</p>`
    : '';
  const summaryHtml = summary
    ? `<p class="essay-spotlight-summary">${escapeHtml(summary)}</p>`
    : '';

  return `<a href="${href}" class="essay-spotlight-link"><article class="essay-spotlight${image ? ' essay-spotlight--image' : ''}">
    ${artHtml}<div class="essay-spotlight-body">
      <p class="essay-spotlight-eyebrow">LATEST ESSAY</p>
      <h3 class="essay-spotlight-title">${escapeHtml(title)}</h3>
      ${authorHtml}<div class="essay-spotlight-meta"><span>${date}</span></div>
      ${summaryHtml}</div>
  </article></a>`;
}
