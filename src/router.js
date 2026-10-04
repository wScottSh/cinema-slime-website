import { parseCoordinate } from './essay-coordinate.js';

// Path-based client routing (History API). The SPA fallback (vite dev, nginx
// in prod) serves index.html for any path, so /episode/<guid> and
// /essay/<slug-or-coordinate> boot straight into their page.

function canonicalPath(pathname = '/') {
  return (pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

export function parseRoute(pathname = '/') {
  const path = canonicalPath(pathname);
  if (path === '/') return { type: 'home' };
  const episodeMatch = path.match(/^\/episode\/([^/]+)$/);
  if (episodeMatch) {
    const guid = decodeURIComponent(episodeMatch[1]);
    return { type: 'episode', guid };
  }
  const essayMatch = path.match(/^\/essay\/([^/]+)$/);
  if (essayMatch) {
    const token = decodeURIComponent(essayMatch[1]);
    // A coordinate token contains colons (kind:pubkey:identifier); a slug never does.
    // parseCoordinate is the authoritative discriminator — null means treat as slug.
    if (parseCoordinate(token)) return { type: 'essay', coordinate: token };
    return { type: 'essay', slug: token };
  }
  return { type: 'home' };
}

// Routes used to live in the hash (/#/episode/<guid>); links in the wild still
// do. Returns the canonical relative URL to history.replaceState to, or null
// when the URL is already canonical:
// - a legacy hash route becomes its clean path (the hash is the most recent
//   navigation intent, so it wins over whatever path it sat on);
// - stray slashes collapse, an empty '#/' is dropped;
// - an unrecognized path goes home.
// The segment stays percent-encoded so parseRoute decodes it exactly as before.
export function normalizeUrl({ pathname = '/', hash = '' } = {}) {
  const current = (pathname || '/') + (hash || '');
  const legacy = (hash || '').match(/^#(\/(?:episode|essay)\/.+)$/);
  let canonical;
  if (legacy) {
    canonical = canonicalPath(legacy[1]);
  } else {
    const path = canonicalPath(pathname);
    const keepHash = hash && hash !== '#' && hash !== '#/' ? hash : '';
    if (path === '/') canonical = '/' + keepHash;
    else if (parseRoute(path).type !== 'home') canonical = path;
    else canonical = '/';
  }
  return canonical === current ? null : canonical;
}

export function buildEpisodePath(guid) {
  if (!guid) return '/';
  return `/episode/${encodeURIComponent(guid.trim())}`;
}

export function buildEssayPath(coordinate) {
  if (!coordinate) return '/';
  return `/essay/${encodeURIComponent(coordinate.trim())}`;
}

// ===== Browser wiring =====

let onRouteChange = () => {};
let lastRouteKey = null;

// Re-render only when the route itself changes — a fragment-only history step
// (home ↔ /#episodes) must not repaint the page and lose the scroll position.
function routeChanged() {
  const key = JSON.stringify(parseRoute(window.location.pathname));
  if (key === lastRouteKey) return;
  lastRouteKey = key;
  onRouteChange();
}

function currentUrl() {
  return window.location.pathname + window.location.search + window.location.hash;
}

export function navigate(url) {
  if (url !== currentUrl()) history.pushState(null, '', url);
  routeChanged();
}

export function navigateToEpisode(guid) {
  navigate(buildEpisodePath(guid));
}

export function navigateToEssay(coordinate) {
  navigate(buildEssayPath(coordinate));
}

export function navigateHome() {
  navigate('/');
}

function canonicalize() {
  const url = normalizeUrl(window.location);
  if (url !== null) history.replaceState(null, '', url);
}

// Plain same-origin <a href="/essay/..."> links become in-app navigations.
// Handlers that already called preventDefault (episode cards, back links) win.
function interceptLinks(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href]');
  if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  const isRoute = canonicalPath(url.pathname) === '/' || parseRoute(url.pathname).type !== 'home';
  if (!isRoute) return;
  // A '/#section' link on the home page is a plain in-page scroll — leave it
  // to the browser.
  if (url.hash && url.pathname === window.location.pathname) return;
  e.preventDefault();
  navigate(url.pathname + url.hash);
}

// Canonicalizes the boot URL (rewriting legacy /#/... links in place, no extra
// history entry) and wires back/forward, legacy-hash edits, and link clicks to
// `render`. Call before the first render; the boot route counts as rendered.
export function startRouter(render) {
  onRouteChange = render;
  canonicalize();
  lastRouteKey = JSON.stringify(parseRoute(window.location.pathname));
  window.addEventListener('popstate', routeChanged);
  // Someone pastes/edits a legacy '#/episode/...' URL while on the site.
  window.addEventListener('hashchange', () => {
    canonicalize();
    routeChanged();
  });
  document.addEventListener('click', interceptLinks);
}
