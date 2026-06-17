// Pure rendering function for episode cards in the Discovery View.
// No DOM access — returns an HTML string.

import { buildEpisodeHash } from './router.js';

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanTitle(title) {
  return title.replace(/\s*\|\s*Cinema Slime Podcast.*$/i, '')
              .replace(/\s*x\s*Cinema Slime Podcast.*$/i, '')
              .replace(/\s*Review & Deep Dive.*$/i, '');
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getEpLabel(ep) {
  if (ep.episodeType === 'bonus') return 'BONUS';
  if (ep.episodeType === 'trailer') return 'TRAILER';
  return ep.episode ? `EPISODE ${ep.episode}` : '';
}

export function buildEpisodeCardHtml(ep, realIdx) {
  const title = cleanTitle(ep.title);
  const label = getEpLabel(ep);
  const isBonus = ep.episodeType !== 'full';
  const href = buildEpisodeHash(ep.guid);
  return `<a href="${href}" class="episode-card-link"><article class="episode-card animate-in" data-idx="${realIdx}">
    <div class="episode-card-art">
      <img src="${escapeHtml(ep.image)}" alt="${escapeHtml(title)}" loading="lazy" />
      <button class="episode-card-play" aria-label="Play ${escapeHtml(title)}">${PLAY_ICON}</button>
      ${isBonus ? `<span class="episode-card-type">${escapeHtml(ep.episodeType)}</span>` : ''}
    </div>
    <div class="episode-card-body">
      ${label ? `<p class="card-ep">${label}</p>` : ''}
      <h3>${escapeHtml(title)}</h3>
      <div class="card-meta">
        <span>${formatDate(ep.pubDate)}</span>
        <span>${escapeHtml(ep.duration || '')}</span>
      </div>
    </div>
  </article></a>`;
}
