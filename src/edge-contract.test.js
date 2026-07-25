import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTWORK_MAX_SIZE_RATIO,
  IMAGE_FILTER_BUFFER_HEADROOM,
  OFF_LADDER_WIDTHS,
  SNAPSHOT_CHECKS,
  artworkChecks,
  buildEdgeContract,
  parseImageFilterBuffer,
  pickArtworkSample,
  verdictArtworkDerivative,
  verdictImageFilterBuffer,
  verdictJsonEndpoint,
  verdictRejected,
  verdictXmlFeed,
  widthBoundaryChecks,
} from './edge-contract.js';
import { ARTWORK_HOST, ARTWORK_WIDTHS } from './artwork-url.js';

const ART = `https://${ARTWORK_HOST}/staging/podcast_uploaded_nologo/43698817/43698817-1757516582372-2a574ca9eaf8e.jpg`;

// The exact bytes nginx serves when it has no `location` for a path: the SPA
// shell, via `try_files $uri $uri/ /index.html`. This is what /api/essays/* was
// really returning on 2026-07-25 while a status-code-only check called it green.
const SPA_SHELL = '<!doctype html><html lang="en"><head><title>Cinema Slime</title></head><body><div id="app"></div><script type="module" src="/assets/index.js"></script></body></html>';
const spaShellResponse = () => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: SPA_SHELL,
});

const FEED = '<?xml version="1.0"?><rss><channel><item><title>Ep 1</title></item><item><title>Ep 2</title></item></channel></rss>';
const feedResponse = (over = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  body: FEED,
  ...over,
});

const jsonResponse = (over = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: '{"events":[]}',
  ...over,
});

const ORIGIN_BYTES = 2_465_018; // a real catalogue average
const artResponse = (over = {}) => ({
  status: 200,
  headers: { 'content-type': 'image/jpeg', 'x-cache-status': 'HIT' },
  body: new Uint8Array(12_000),
  ...over,
});

// ── the regressions of 2026-07-25 ────────────────────────────────────────────
//
// These six are the regression lock for the outage this module was written
// for. Every one of them was 200-with-plausible-headers in production while the
// feature it belongs to was silently dead. If any of these starts passing, the
// verifier has stopped being able to see the outage it exists to catch.

test('REGRESSION: a JSON endpoint answering the SPA shell FAILS', () => {
  // /api/essays/curation and /api/essays/events, exactly as found in production:
  // HTTP 200, text/html, the Vite index. A status-code check calls this healthy;
  // the Essays snapshot silently falls back to the wss relays and readers wait.
  const verdict = verdictJsonEndpoint(spaShellResponse());
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /SPA shell/);
});

test('REGRESSION: an artwork path answering 404 FAILS, naming the missing config', () => {
  // /api/art/* 404'd for every request because the nginx config was never
  // installed on the droplet, while the client showed its dark placeholder.
  const verdict = verdictArtworkDerivative({ status: 404, headers: {}, body: '' }, { originBytes: ORIGIN_BYTES });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /404/);
  assert.match(verdict.reason, /not installed/);
});

test('REGRESSION: an image that is nearly origin-size FAILS', () => {
  // The shape of "nginx proxied the original straight through": correct
  // content-type, correct cache header, no resize. Indistinguishable from a
  // working derivative unless you compare against the source.
  const verdict = verdictArtworkDerivative(
    artResponse({ body: new Uint8Array(ORIGIN_BYTES - 10) }),
    { originBytes: ORIGIN_BYTES },
  );
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /did not downscale/);
});

test('REGRESSION: an off-ladder width that returns an image FAILS', () => {
  // The allowlist is a security boundary (ADR 0013 decision 3), not a tidy-up.
  // A 200 image from /api/art/3000/ means the endpoint became a resize-at-any-
  // size proxy, so this must fail even though the request "worked".
  const verdict = verdictRejected(artResponse());
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /allowlist/);
});

test('REGRESSION: a buffer smaller than the largest source FAILS', () => {
  // image_filter_buffer 6M sized from the 2.35 MB mean, against a real 7.43 MB
  // max. nginx 415'd the two largest artworks and nothing surfaced.
  const verdict = verdictImageFilterBuffer({
    maxOriginBytes: 7.43 * 1024 * 1024,
    bufferBytes: 6 * 1024 * 1024,
  });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /415/);
});

test('a fully healthy edge PASSES every check', () => {
  // The other half of the lock: the checks must be satisfiable, or a green run
  // means nothing.
  assert.equal(verdictXmlFeed(feedResponse()).pass, true);
  assert.equal(verdictJsonEndpoint(jsonResponse()).pass, true);
  assert.equal(verdictArtworkDerivative(artResponse(), { originBytes: ORIGIN_BYTES }).pass, true);
  assert.equal(verdictRejected({ status: 404, headers: { 'content-type': 'text/html' }, body: '' }).pass, true);
  assert.equal(verdictImageFilterBuffer({
    maxOriginBytes: 7.43 * 1024 * 1024,
    bufferBytes: 16 * 1024 * 1024,
  }).pass, true);
});

// ── /api/rss ─────────────────────────────────────────────────────────────────

test('the feed passes on any XML content-type flavor', () => {
  for (const type of ['application/rss+xml', 'text/xml', 'application/xml; charset=utf-8', 'APPLICATION/XML']) {
    assert.equal(verdictXmlFeed(feedResponse({ headers: { 'content-type': type } })).pass, true, type);
  }
});

test('well-formed XML with no <item> FAILS — an empty feed is not a working feed', () => {
  const empty = feedResponse({ body: '<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>' });
  const verdict = verdictXmlFeed(empty);
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /no <item>/);
});

test('the feed FAILS on a non-200, reporting the status', () => {
  for (const status of [404, 500, 502]) {
    const verdict = verdictXmlFeed(feedResponse({ status }));
    assert.equal(verdict.pass, false);
    assert.match(verdict.reason, new RegExp(String(status)));
  }
});

test('the feed FAILS on the SPA shell even when it is called XML', () => {
  // Belt and braces: the body sniff catches a shell mislabeled by a proxy.
  const verdict = verdictXmlFeed({ status: 200, headers: { 'content-type': 'application/xml' }, body: SPA_SHELL });
  assert.equal(verdict.pass, false);
});

// ── /api/essays/* ────────────────────────────────────────────────────────────

test('the JSON endpoints require BOTH a json content-type and a parseable body', () => {
  // A json-typed HTML error page, and a json body served as text/plain, are both
  // failures. Either check alone lets one of these through.
  const typedButUnparseable = jsonResponse({ body: 'upstream connect error or disconnect' });
  assert.equal(verdictJsonEndpoint(typedButUnparseable).pass, false);
  assert.match(verdictJsonEndpoint(typedButUnparseable).reason, /does not parse/);

  const parseableButUntyped = jsonResponse({ headers: { 'content-type': 'text/plain' } });
  assert.equal(verdictJsonEndpoint(parseableButUntyped).pass, false);
  assert.match(verdictJsonEndpoint(parseableButUntyped).reason, /not JSON/);
});

test('a JSON endpoint with no content-type at all FAILS', () => {
  assert.equal(verdictJsonEndpoint(jsonResponse({ headers: {} })).pass, false);
});

test('the JSON endpoints FAIL on a non-200 even with a valid JSON body', () => {
  assert.equal(verdictJsonEndpoint(jsonResponse({ status: 502 })).pass, false);
});

// ── /api/art/{width}/{path} ──────────────────────────────────────────────────

test('artwork FAILS without an X-Cache-Status header', () => {
  // No header means the request never went through the cache tier, so every hit
  // re-pays a GD decode — invisible in the response, expensive on the droplet.
  const verdict = verdictArtworkDerivative(artResponse({ headers: { 'content-type': 'image/jpeg' } }), { originBytes: ORIGIN_BYTES });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /X-Cache-Status/);
});

test('artwork passes on either cache status', () => {
  for (const cache of ['MISS', 'HIT']) {
    const res = artResponse({ headers: { 'content-type': 'image/jpeg', 'x-cache-status': cache } });
    assert.equal(verdictArtworkDerivative(res, { originBytes: ORIGIN_BYTES }).pass, true, cache);
  }
});

test('artwork FAILS when the origin size is unknown rather than skipping the check', () => {
  // Degrading a check whose input is missing is how this drift went unnoticed.
  for (const originBytes of [undefined, null, NaN, 0]) {
    const verdict = verdictArtworkDerivative(artResponse(), { originBytes });
    assert.equal(verdict.pass, false, String(originBytes));
    assert.match(verdict.reason, /origin size unknown/);
  }
});

test('artwork FAILS on a zero-length image body', () => {
  const verdict = verdictArtworkDerivative(artResponse({ body: new Uint8Array(0) }), { originBytes: ORIGIN_BYTES });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /zero-length/);
});

test('the size ratio boundary is exactly ARTWORK_MAX_SIZE_RATIO', () => {
  const at = Math.round(ORIGIN_BYTES * ARTWORK_MAX_SIZE_RATIO);
  assert.equal(verdictArtworkDerivative(artResponse({ body: new Uint8Array(at) }), { originBytes: ORIGIN_BYTES }).pass, false);
  assert.equal(verdictArtworkDerivative(artResponse({ body: new Uint8Array(at - 100) }), { originBytes: ORIGIN_BYTES }).pass, true);
});

test('body size falls back to content-length when the body was not retained', () => {
  const res = { status: 200, headers: { 'content-type': 'image/jpeg', 'x-cache-status': 'HIT', 'content-length': '12000' } };
  assert.equal(verdictArtworkDerivative(res, { originBytes: ORIGIN_BYTES }).pass, true);
});

// ── the width allowlist boundary ─────────────────────────────────────────────

test('none of the off-ladder widths is on the real allowlist', () => {
  // Guards against the ladder growing to include one of the "must 404" widths
  // and turning this suite into a lie.
  for (const width of OFF_LADDER_WIDTHS) {
    assert.ok(!ARTWORK_WIDTHS.includes(Number(width)), `${width} is on the allowlist`);
  }
});

test('a refused path FAILS when it 200s with the SPA shell', () => {
  // Not an image, so the security property holds — but a 200 here means the
  // request fell through to `location /`, which is the same drift as /api/essays.
  const verdict = verdictRejected(spaShellResponse());
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /404/);
});

test('a refused path FAILS on an image even with a 404 status', () => {
  // The image assertion is independent of the status assertion on purpose.
  const verdict = verdictRejected(artResponse({ status: 404 }));
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /allowlist/);
});

test('widthBoundaryChecks covers every off-ladder width plus the empty path', () => {
  const paths = widthBoundaryChecks(ART).map((c) => c.path);
  for (const width of OFF_LADDER_WIDTHS) {
    assert.ok(paths.some((p) => p.startsWith(`/api/art/${width}/`)), `no check for width ${width}`);
  }
  assert.ok(paths.includes(`/api/art/${ARTWORK_WIDTHS[0]}/`), 'no check for a valid width with an empty path');
});

test('widthBoundaryChecks refuses to build from a non-artwork URL', () => {
  assert.throws(() => widthBoundaryChecks('https://example.com/a.jpg'), /not a pinned-host artwork URL/);
});

// ── image_filter_buffer ──────────────────────────────────────────────────────

test('the headroom band is what catches growth before it breaks', () => {
  const buffer = 16 * 1024 * 1024;
  const justUnderBuffer = buffer - 1;
  const justOverHeadroom = Math.ceil(buffer * IMAGE_FILTER_BUFFER_HEADROOM) + 1;

  // Both of these still "work" in production today; both must fail here.
  assert.equal(verdictImageFilterBuffer({ maxOriginBytes: justUnderBuffer, bufferBytes: buffer }).pass, false);
  const growing = verdictImageFilterBuffer({ maxOriginBytes: justOverHeadroom, bufferBytes: buffer });
  assert.equal(growing.pass, false);
  assert.match(growing.reason, /headroom/);

  assert.equal(verdictImageFilterBuffer({ maxOriginBytes: buffer * 0.5, bufferBytes: buffer }).pass, true);
});

test('the buffer check FAILS rather than passing when either input is missing', () => {
  assert.equal(verdictImageFilterBuffer({ maxOriginBytes: 1000 }).pass, false);
  assert.equal(verdictImageFilterBuffer({ bufferBytes: 1000 }).pass, false);
  assert.equal(verdictImageFilterBuffer().pass, false);
});

test('the real repo value comfortably clears the real measured maximum', () => {
  // 16M against the 2026-07 catalogue max of 7.43 MB.
  assert.equal(verdictImageFilterBuffer({
    maxOriginBytes: 7_790_000,
    bufferBytes: parseImageFilterBuffer('image_filter_buffer 16M;'),
  }).pass, true);
});

// ── parsing the nginx directive ──────────────────────────────────────────────

test('parseImageFilterBuffer understands the size suffixes nginx accepts', () => {
  assert.equal(parseImageFilterBuffer('image_filter_buffer 16M;'), 16 * 1024 * 1024);
  assert.equal(parseImageFilterBuffer('image_filter_buffer 1024k;'), 1024 * 1024);
  assert.equal(parseImageFilterBuffer('image_filter_buffer 1G;'), 1024 ** 3);
  assert.equal(parseImageFilterBuffer('image_filter_buffer 1048576;'), 1048576);
  assert.equal(parseImageFilterBuffer('    image_filter_buffer   16M ;\n'), 16 * 1024 * 1024);
});

test('parseImageFilterBuffer ignores the directive when it is commented out', () => {
  // The real config file discusses the earlier, wrong 6M value in prose. A naive
  // match would assert against the bug.
  const conf = [
    '# An earlier setting was image_filter_buffer 6M; sized from the mean.',
    'image_filter_buffer 16M;',
  ].join('\n');
  assert.equal(parseImageFilterBuffer(conf), 16 * 1024 * 1024);
  assert.equal(parseImageFilterBuffer('# image_filter_buffer 6M;'), null);
});

test('parseImageFilterBuffer returns null when the directive is absent', () => {
  assert.equal(parseImageFilterBuffer('server { listen 80; }'), null);
  assert.equal(parseImageFilterBuffer(''), null);
  assert.equal(parseImageFilterBuffer(null), null);
});

// ── the assembled contract ───────────────────────────────────────────────────

test('the contract covers all three snapshot endpoints', () => {
  const paths = SNAPSHOT_CHECKS.map((c) => c.path);
  assert.deepEqual(paths, ['/api/rss', '/api/essays/curation', '/api/essays/events']);
});

test('artworkChecks asks for exactly the paths artwork-url.js builds, one per rung', () => {
  const checks = artworkChecks(ART, ORIGIN_BYTES);
  assert.equal(checks.length, ARTWORK_WIDTHS.length);
  for (const width of ARTWORK_WIDTHS) {
    assert.ok(checks.some((c) => c.path.startsWith(`/api/art/${width}/`)), `no check at rung ${width}`);
  }
});

test('artworkChecks carries the origin size into its verdict', () => {
  const [check] = artworkChecks(ART, ORIGIN_BYTES);
  assert.equal(check.verdict(artResponse()).pass, true);
  const [starved] = artworkChecks(ART, undefined);
  assert.equal(starved.verdict(artResponse()).pass, false);
});

test('artworkChecks refuses a URL that is not pinned-host artwork', () => {
  assert.throws(() => artworkChecks('https://image.nostr.build/a.png', 1000), /not a pinned-host artwork URL/);
});

test('buildEdgeContract assembles snapshot + artwork + boundary checks, all with unique ids', () => {
  const other = `https://${ARTWORK_HOST}/staging/another/42-abc.jpg`;
  const contract = buildEdgeContract({
    artworkUrls: [ART, other],
    originBytes: new Map([[ART, ORIGIN_BYTES], [other, ORIGIN_BYTES]]),
  });
  const expected = SNAPSHOT_CHECKS.length + 2 * ARTWORK_WIDTHS.length + OFF_LADDER_WIDTHS.length + 1;
  assert.equal(contract.length, expected);
  assert.equal(new Set(contract.map((c) => c.id)).size, expected);
  for (const check of contract) {
    assert.equal(typeof check.path, 'string');
    assert.equal(typeof check.verdict, 'function');
    assert.ok(check.expectation, `check ${check.id} has no stated expectation`);
  }
});

test('buildEdgeContract treats an empty artwork list as a failure, not an empty run', () => {
  // A feed that yields no artwork would otherwise produce a green run with zero
  // artwork checks — the most dangerous possible outcome for this script.
  assert.throws(() => buildEdgeContract({ artworkUrls: [] }), /no artwork URLs/);
});

test('the snapshot check list cannot be emptied by a caller', () => {
  assert.ok(Object.isFrozen(SNAPSHOT_CHECKS));
  assert.ok(Object.isFrozen(OFF_LADDER_WIDTHS));
});

// ── sampling ─────────────────────────────────────────────────────────────────

test('pickArtworkSample spreads across the catalogue and is deterministic', () => {
  const urls = Array.from({ length: 70 }, (_, i) => `u${i}`);
  const sample = pickArtworkSample(urls, 3);
  assert.deepEqual(sample, ['u0', 'u35', 'u69']);
  assert.deepEqual(pickArtworkSample(urls, 3), sample);
});

test('pickArtworkSample degrades sanely at the edges', () => {
  assert.deepEqual(pickArtworkSample(['a', 'b'], 5), ['a', 'b']);
  assert.deepEqual(pickArtworkSample(['a', 'b', 'c'], 1), ['a']);
  assert.deepEqual(pickArtworkSample(['a', 'b', 'c'], 0), []);
});
