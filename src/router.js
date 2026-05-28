export function parseHash(hash = '') {
  const h = hash || '';
  if (!h || h === '#' || h === '#/') {
    return { type: 'home' };
  }
  const match = h.match(/^#\/episode\/(.+)$/);
  if (match) {
    const guid = decodeURIComponent(match[1]);
    return { type: 'episode', guid };
  }
  return { type: 'home' };
}

export function buildEpisodeHash(guid) {
  if (!guid) return '#';
  return `#/episode/${encodeURIComponent(guid.trim())}`;
}

export function navigateToEpisode(guid) {
  window.location.hash = buildEpisodeHash(guid);
}

export function navigateHome() {
  window.location.hash = '';
}
