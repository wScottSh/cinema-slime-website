export function parseHash(hash = '') {
  const h = hash || '';
  if (!h || h === '#' || h === '#/') {
    return { type: 'home' };
  }
  const episodeMatch = h.match(/^#\/episode\/(.+)$/);
  if (episodeMatch) {
    const guid = decodeURIComponent(episodeMatch[1]);
    return { type: 'episode', guid };
  }
  const essayMatch = h.match(/^#\/essay\/(.+)$/);
  if (essayMatch) {
    const coordinate = decodeURIComponent(essayMatch[1]);
    return { type: 'essay', coordinate };
  }
  return { type: 'home' };
}

export function buildEpisodeHash(guid) {
  if (!guid) return '#';
  return `#/episode/${encodeURIComponent(guid.trim())}`;
}

export function buildEssayHash(coordinate) {
  if (!coordinate) return '#';
  return `#/essay/${encodeURIComponent(coordinate.trim())}`;
}

export function navigateToEpisode(guid) {
  window.location.hash = buildEpisodeHash(guid);
}

export function navigateToEssay(coordinate) {
  window.location.hash = buildEssayHash(coordinate);
}

export function navigateHome() {
  window.location.hash = '';
}
