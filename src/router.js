import { parseCoordinate } from './essay-coordinate.js';

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
    const token = decodeURIComponent(essayMatch[1]);
    // A coordinate token contains colons (kind:pubkey:identifier); a slug never does.
    // parseCoordinate is the authoritative discriminator — null means treat as slug.
    if (parseCoordinate(token)) return { type: 'essay', coordinate: token };
    return { type: 'essay', slug: token };
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
