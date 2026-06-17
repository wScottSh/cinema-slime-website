// Pure HTML-string builder for the Essay Page hero + structured header.
// No DOM access — returns an HTML string. Mirrors the essay-card.js pattern.

export const BRAND_MARK_URL = '/cs-logo.png';

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

// Builds the full hero + header block for an Essay Page.
// Output order: hero → title → Cinema Slime Name byline → date → summary deck.
//
// essay: { title, authorName, publishedAt, image, summary }
export function buildEssayHeaderHtml(essay) {
  const { title = '', authorName = '', publishedAt = 0, image = '', summary = '' } = essay;

  const hasCoverImage = typeof image === 'string' && image.trim() !== '';
  const heroClass = hasCoverImage ? 'essay-hero essay-hero--image' : 'essay-hero essay-hero--brand';
  const heroImgSrc = hasCoverImage ? image : BRAND_MARK_URL;
  const heroImgAlt = hasCoverImage ? escapeHtml(title) : 'Cinema Slime';

  const heroHtml = `<div class="${heroClass}"><img src="${escapeHtml(heroImgSrc)}" alt="${heroImgAlt}" class="essay-hero-img" loading="lazy"></div>`;

  const bylineHtml = authorName
    ? `<p class="essay-author">By <span>${escapeHtml(authorName)}</span></p>`
    : '';

  const dateHtml = `<p class="episode-date">${formatDate(publishedAt)}</p>`;

  const deckHtml = summary
    ? `<p class="essay-deck">${escapeHtml(summary)}</p>`
    : '';

  return `${heroHtml}
<div class="essay-header-meta">
  <span class="episode-label">ESSAY</span>
  <h1 class="episode-title">${escapeHtml(title || 'Untitled')}</h1>
  ${bylineHtml}
  ${dateHtml}
  ${deckHtml}
</div>`;
}
