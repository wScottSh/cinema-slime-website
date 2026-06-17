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

// The SPA fallback (vite dev, nginx in prod) serves index.html for any path,
// so the app can boot at a non-root path — typically a hash route whose '#'
// was deleted in the address bar. Left alone, that path sticks forever and
// every hash navigation compounds onto it (/essay/foo#/episode/bar).
// Returns the canonical relative URL to history.replaceState to, or null
// when the URL is already canonical.
export function normalizeBootUrl({ pathname = '/', hash = '' } = {}) {
  const path = (pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  if (path === '/') return null;
  // A live hash route is the most recent navigation intent — it wins.
  if (hash && hash !== '#') return '/' + hash;
  // A route shape that lost its '#' gets it restored; the segment stays
  // percent-encoded so parseHash decodes it exactly as a hash route would.
  if (/^\/(episode|essay)\/.+$/.test(path)) return '/#' + path;
  return '/';
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
