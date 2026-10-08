import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, buildEpisodePath, buildEssayPath, normalizeUrl, sectionFromHash, decideRouteScroll, replaceRoute, startRouter } from './router.js';

const PUBKEY = 'a'.repeat(64);

test('parseRoute returns home for root and empty paths', () => {
  assert.deepEqual(parseRoute('/'), { type: 'home' });
  assert.deepEqual(parseRoute(''), { type: 'home' });
  assert.deepEqual(parseRoute(undefined), { type: 'home' });
});

test('parseRoute parses episode route with guid', () => {
  const result = parseRoute('/episode/c363d1f1-832e-4add-9dcb-1f51225d0338');
  assert.equal(result.type, 'episode');
  assert.equal(result.guid, 'c363d1f1-832e-4add-9dcb-1f51225d0338');
});

test('parseRoute decodes encoded guid', () => {
  const encoded = encodeURIComponent('guid with space/slash');
  const result = parseRoute(`/episode/${encoded}`);
  assert.equal(result.type, 'episode');
  assert.equal(result.guid, 'guid with space/slash');
});

test('parseRoute returns home for unknown paths', () => {
  assert.deepEqual(parseRoute('/episodes'), { type: 'home' });
  assert.deepEqual(parseRoute('/foo/bar'), { type: 'home' });
  assert.deepEqual(parseRoute('/episode/a/b'), { type: 'home' });
  assert.deepEqual(parseRoute('/essay/'), { type: 'home' });
});

test('parseRoute tolerates a trailing slash and doubled slashes', () => {
  assert.equal(parseRoute('/essay/first/').slug, 'first');
  assert.equal(parseRoute('//episode/abc').guid, 'abc');
});

test('buildEpisodePath builds a clean path', () => {
  assert.equal(buildEpisodePath('c363d1f1-832e-4add-9dcb-1f51225d0338'), '/episode/c363d1f1-832e-4add-9dcb-1f51225d0338');
});

test('buildEpisodePath encodes special chars', () => {
  assert.equal(buildEpisodePath('guid with space'), '/episode/guid%20with%20space');
});

test('buildEpisodePath / buildEssayPath return / for falsy', () => {
  assert.equal(buildEpisodePath(''), '/');
  assert.equal(buildEpisodePath(null), '/');
  assert.equal(buildEssayPath(''), '/');
  assert.equal(buildEssayPath(null), '/');
});

test('parseRoute parses an essay route and decodes the coordinate', () => {
  const coord = `30023:${PUBKEY}:my-essay`;
  const result = parseRoute(`/essay/${encodeURIComponent(coord)}`);
  assert.equal(result.type, 'essay');
  assert.equal(result.coordinate, coord);
});

test('parseRoute keeps essay and episode routes distinct', () => {
  assert.equal(parseRoute('/episode/some-guid').type, 'episode');
  assert.equal(parseRoute(`/essay/30023:${PUBKEY}:x`).type, 'essay');
});

test('buildEssayPath → parseRoute round-trips a coordinate with colons in the identifier', () => {
  const coord = `30023:${PUBKEY}:part:2`;
  const result = parseRoute(buildEssayPath(coord));
  assert.equal(result.type, 'essay');
  assert.equal(result.coordinate, coord);
});

test('parseRoute returns slug for essay route when token is not a coordinate', () => {
  const result = parseRoute('/essay/first');
  assert.equal(result.type, 'essay');
  assert.equal(result.slug, 'first');
  assert.equal(result.coordinate, undefined);
});

// URLs used to carry the route in the hash (/#/essay/first). Those links are
// still out in the wild, so the app rewrites them to the clean path in place.

test('normalizeUrl leaves canonical URLs alone', () => {
  assert.equal(normalizeUrl({ pathname: '/', hash: '' }), null);
  assert.equal(normalizeUrl({ pathname: '/essay/first', hash: '' }), null);
  assert.equal(normalizeUrl({ pathname: '/episode/c363d1f1-832e-4add-9dcb-1f51225d0338', hash: '' }), null);
});

test('normalizeUrl redirects a legacy hash essay route to its clean path', () => {
  assert.equal(normalizeUrl({ pathname: '/', hash: '#/essay/harrys-spider' }), '/essay/harrys-spider');
});

test('normalizeUrl redirects a legacy hash episode route to its clean path', () => {
  assert.equal(
    normalizeUrl({ pathname: '/', hash: '#/episode/c363d1f1-832e-4add-9dcb-1f51225d0338' }),
    '/episode/c363d1f1-832e-4add-9dcb-1f51225d0338'
  );
});

test('normalizeUrl keeps a legacy coordinate percent-encoded so it round-trips', () => {
  const coord = `30023:${PUBKEY}:my-essay`;
  const normalized = normalizeUrl({ pathname: '/', hash: `#/essay/${encodeURIComponent(coord)}` });
  assert.equal(normalized, `/essay/${encodeURIComponent(coord)}`);
  assert.equal(parseRoute(normalized).coordinate, coord);
});

test('normalizeUrl prefers a legacy hash route over a stale path', () => {
  assert.equal(
    normalizeUrl({ pathname: '/essay/harrys-spider', hash: '#/episode/some-guid' }),
    '/episode/some-guid'
  );
});

test('normalizeUrl drops every non-route hash', () => {
  assert.equal(normalizeUrl({ pathname: '/', hash: '#/' }), '/');
  assert.equal(normalizeUrl({ pathname: '/', hash: '#about' }), '/');
  assert.equal(normalizeUrl({ pathname: '/', hash: '#/foo/bar' }), '/');
});

test('sectionFromHash names the legacy section, ignores routes and junk', () => {
  assert.equal(sectionFromHash('#about'), 'about');
  assert.equal(sectionFromHash('#episodes'), 'episodes');
  assert.equal(sectionFromHash('#/essay/first'), null);
  assert.equal(sectionFromHash('#'), null);
  assert.equal(sectionFromHash(''), null);
});

test('normalizeUrl collapses doubled and trailing slashes', () => {
  assert.equal(normalizeUrl({ pathname: '//essay/harrys-spider', hash: '' }), '/essay/harrys-spider');
  assert.equal(normalizeUrl({ pathname: '/essay/harrys-spider/', hash: '' }), '/essay/harrys-spider');
});

test('normalizeUrl drops a section hash on a sub-page', () => {
  assert.equal(normalizeUrl({ pathname: '/essay/first', hash: '#about' }), '/essay/first');
});

test('normalizeUrl sends unrecognized paths home', () => {
  assert.equal(normalizeUrl({ pathname: '/foo/bar', hash: '' }), '/');
  assert.equal(normalizeUrl({ pathname: '/essay/', hash: '' }), '/');
});

// Client routes are same-document navigations: the browser keeps the old scrollY,
// so a detail page would open at the Discovery View's depth unless reset.
test('decideRouteScroll: home → essay saves home depth and opens at top', () => {
  assert.deepEqual(decideRouteScroll('/', '/essay/on-cinema'), { saveHomeDepth: true, toTop: true });
});

test('decideRouteScroll: home → episode saves home depth and opens at top', () => {
  assert.deepEqual(decideRouteScroll('/', '/episode/abc'), { saveHomeDepth: true, toTop: true });
});

test('decideRouteScroll: detail → other detail opens at top without overwriting home depth', () => {
  assert.deepEqual(decideRouteScroll('/episode/abc', '/essay/on-cinema'), { saveHomeDepth: false, toTop: true });
});

test('decideRouteScroll: re-render of the same detail route (data refresh) keeps the reader in place', () => {
  assert.deepEqual(decideRouteScroll('/episode/abc', '/episode/abc'), { saveHomeDepth: false, toTop: false });
});

test('decideRouteScroll: boot straight onto a detail route opens at top, no home depth to save', () => {
  assert.deepEqual(decideRouteScroll(null, '/essay/on-cinema'), { saveHomeDepth: false, toTop: true });
});

test('decideRouteScroll: returning home leaves scroll to the home-depth restore', () => {
  assert.deepEqual(decideRouteScroll('/essay/on-cinema', '/'), { saveHomeDepth: false, toTop: false });
});

test('decideRouteScroll: a trailing-slash variant of the same route is not a route change', () => {
  assert.deepEqual(decideRouteScroll('/episode/abc', '/episode/abc/'), { saveHomeDepth: false, toTop: false });
});

test('replaceRoute swaps the URL in place (no new history entry) and renders the new route', (t) => {
  const location = { pathname: '/essay/old-slug', search: '', hash: '' };
  const entries = ['/essay/old-slug'];
  const history = {
    pushState: (_, __, url) => { entries.push(url); location.pathname = url; },
    replaceState: (_, __, url) => { entries[entries.length - 1] = url; location.pathname = url; },
  };
  const noop = { addEventListener: () => {} };
  Object.assign(globalThis, { window: { location, ...noop }, history, document: noop });
  t.after(() => { delete globalThis.window; delete globalThis.history; delete globalThis.document; });
  const rendered = [];
  startRouter(() => rendered.push(location.pathname));
  replaceRoute(buildEssayPath('new-slug'));
  assert.deepEqual(entries, ['/essay/new-slug']);
  assert.deepEqual(rendered, ['/essay/new-slug']);
});
