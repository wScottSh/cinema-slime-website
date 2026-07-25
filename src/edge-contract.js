// The contract every same-origin `/api/…` endpoint must satisfy, expressed as
// pure data plus pure verdict functions. `scripts/verify-edge-contract.mjs` is
// the thin shell that fetches the real endpoints and feeds them through here.
//
// WHY THIS EXISTS (2026-07-25). The site serves four kinds of same-origin
// endpoint that are nothing but nginx configuration on the droplet:
//
//   /api/rss                  proxied+cached Anchor feed          (ADR 0006)
//   /api/essays/curation      proxied+cached api.nostr.band JSON  (ADR 0008)
//   /api/essays/events        proxied+cached api.nostr.band JSON  (ADR 0008)
//   /api/art/{width}/{path}   downscaled Episode artwork          (ADR 0013)
//
// None of that config lives in the deployed artifact, so it can drift out from
// under the code with nothing failing. It had. `/api/art/*` was answering 404
// for every request (the config was never installed), and `/api/essays/*` was
// answering **200 text/html** — the SPA shell — because with no matching
// `location` block, `location / { try_files $uri $uri/ /index.html; }` answers
// everything. Both clients degrade quietly (a dark placeholder; a fallback to
// the wss relays), so nothing surfaced for weeks.
//
// The lesson encoded here: a status code is not a contract. 200 is exactly what
// a missing endpoint returns. So every check asserts the *kind* of thing that
// came back — content type AND a parse of the body — and the negative checks
// assert what must NOT come back (an image from an off-ladder width). A check
// that only a human runs is a check that drifts, which is why this is a module
// with unit tests and a script, not a section of the deploy playbook.
//
// Pure: no network, no DOM, no filesystem. Everything here takes an
// already-fetched response descriptor and returns a verdict.

import { ARTWORK_PATH_PREFIX, ARTWORK_WIDTHS, artworkUrl, isArtworkUrl } from './artwork-url.js';

// A derivative that is not dramatically smaller than its source is not a
// derivative — it is the original with a new URL, which is the precise defect
// ADR 0013 exists to fix. Real 160/320/640 rungs land around 0.5–3 % of a
// ~2.4 MB source, so 25 % is a very loose ceiling that still catches "nginx
// quietly proxied the original through" and "image_filter did not run".
export const ARTWORK_MAX_SIZE_RATIO = 0.25;

// `image_filter_buffer` must exceed the LARGEST source, not the average: nginx
// answers 415 for any source bigger than the buffer, and the client shows its
// dark placeholder, so an undersized buffer fails invisibly. It already did —
// a 6M buffer was sized from the 2.35 MB mean while the max was 7.43 MB, and
// the two largest artworks 415'd silently. The headroom factor is the point:
// requiring max < 60 % of buffer means a growing catalogue trips this check
// while the site still works, rather than the first oversized upload breaking
// in production.
export const IMAGE_FILTER_BUFFER_HEADROOM = 0.6;

// Widths deliberately off the ladder. `/api/art/{width}/` is the one place a
// visitor's input reaches nginx, and the allowlist is what stops it becoming a
// resize-at-any-size endpoint (ADR 0013 decision 3) — so these are asserted as
// hard 404s, not merely "not 200". `161` is one off a real rung, `3000` is the
// source resolution (the tempting one), `abc` is not a number at all.
export const OFF_LADDER_WIDTHS = Object.freeze(['3000', '161', 'abc']);

const pass = (reason) => ({ pass: true, reason });
const fail = (reason) => ({ pass: false, reason });

// Accepts a plain lowercase-keyed object or anything Headers-like. `fetch`
// lowercases header names already; this only guards hand-built descriptors in
// tests from being subtly case-sensitive.
function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value == null ? '' : String(value);
  }
  return '';
}

function contentType(res) {
  return headerValue(res?.headers, 'content-type').toLowerCase();
}

// Body size in bytes. Binary bodies arrive as a Uint8Array/ArrayBuffer; text
// bodies as a string. `content-length` is the last resort rather than the first
// choice — a proxy may omit it, and the bytes we actually received are the
// honest measurement.
function bodyBytes(res) {
  const body = res?.body;
  if (body && typeof body.byteLength === 'number') return body.byteLength;
  if (typeof body === 'string') return body.length;
  const declared = Number(headerValue(res?.headers, 'content-length'));
  return Number.isFinite(declared) ? declared : 0;
}

function bodyText(res) {
  const body = res?.body;
  if (typeof body === 'string') return body;
  if (body && typeof body.byteLength === 'number') return new TextDecoder().decode(body);
  return '';
}

// The signature of the failure that started all this: nginx had no location for
// the path, so `try_files … /index.html` served the SPA. Called out by name in
// verdicts because "expected json, got text/html" reads like a gateway bug,
// while "the SPA shell" points straight at the missing location block.
function looksLikeSpaShell(res) {
  if (contentType(res).includes('text/html')) return true;
  return /^\s*<(!doctype html|html)/i.test(bodyText(res).slice(0, 200));
}

function statusFailure(res, expected = 200) {
  if (res?.status === expected) return null;
  return fail(`expected HTTP ${expected}, got ${res?.status}`);
}

/**
 * `/api/rss` must be the proxied Anchor feed: XML that actually parses to at
 * least one `<item>`. The item count matters because an empty-but-well-formed
 * document (an upstream error page, a truncated cache entry) would otherwise
 * satisfy "is XML" while leaving the site with no Episodes at all.
 */
export function verdictXmlFeed(res) {
  const bad = statusFailure(res);
  if (bad) return bad;

  const type = contentType(res);
  if (looksLikeSpaShell(res)) return fail(`content-type ${type || '(none)'} — this is the SPA shell, not the feed; nginx has no location for this path`);
  if (!/(^|\/|\+)xml\b/.test(type)) return fail(`content-type ${type || '(none)'} is not XML`);

  const items = countFeedItems(bodyText(res));
  if (items < 1) return fail('XML parsed but contains no <item> — the feed is empty');
  return pass(`${type}, ${items} <item>`);
}

/**
 * `/api/essays/curation` and `/api/essays/events` must be the proxied
 * api.nostr.band JSON (ADR 0008).
 *
 * BOTH halves are load-bearing and both are asserted deliberately. The real
 * outage returned 200 with `text/html`; a content-type check alone would still
 * miss a JSON-typed error blob, and a parse alone would accept an HTML shell
 * only if it happened to be unparseable — so we require the header to say json
 * AND the body to parse as json.
 */
export function verdictJsonEndpoint(res) {
  const bad = statusFailure(res);
  if (bad) return bad;

  const type = contentType(res);
  if (looksLikeSpaShell(res)) return fail(`content-type ${type || '(none)'} — this is the SPA shell, not JSON; nginx has no location for this path`);
  if (!type.includes('json')) return fail(`content-type ${type || '(none)'} is not JSON`);

  const text = bodyText(res);
  try {
    JSON.parse(text);
  } catch (err) {
    return fail(`content-type says JSON but the body does not parse: ${err.message}`);
  }
  return pass(`${type}, ${text.length} byte(s) of valid JSON`);
}

/**
 * One `/api/art/{width}/{path}` derivative. `originBytes` is the measured size
 * of the CloudFront original, so "materially smaller" is checked against the
 * real source rather than a guessed constant.
 *
 * An unknown origin size is a FAILURE, not a skip. Silently downgrading a check
 * whose input is missing is how the site got into this state in the first
 * place.
 */
export function verdictArtworkDerivative(res, { originBytes } = {}) {
  const bad = statusFailure(res);
  if (bad) return res?.status === 404
    ? fail('404 — nginx is not serving /api/art/ at all (config not installed?)')
    : bad;

  const type = contentType(res);
  if (looksLikeSpaShell(res)) return fail(`content-type ${type || '(none)'} — the SPA shell answered an artwork path; nginx has no /api/art/ location`);
  if (!type.startsWith('image/')) return fail(`content-type ${type || '(none)'} is not an image`);

  // MISS then HIT is how the two-tier cache proves it is caching the RESIZED
  // bytes (ADR 0013 decision 4). Absent header = the cache tier is bypassed and
  // every request is re-paying a GD decode, which looks fine and is not.
  const cache = headerValue(res.headers, 'x-cache-status');
  if (!cache) return fail('no X-Cache-Status header — the derivative is not coming through the cache tier');

  const bytes = bodyBytes(res);
  if (bytes < 1) return fail('image content-type but a zero-length body');
  if (!Number.isFinite(originBytes) || originBytes < 1) {
    return fail('origin size unknown — cannot prove the derivative is smaller than the original');
  }
  const ratio = bytes / originBytes;
  const budget = `${(ratio * 100).toFixed(1)}% of the ${kb(originBytes)} origin (must be under ${ARTWORK_MAX_SIZE_RATIO * 100}%)`;
  if (ratio >= ARTWORK_MAX_SIZE_RATIO) return fail(`${kb(bytes)} is ${budget} — image_filter did not downscale`);

  return pass(`${type}, ${kb(bytes)}, ${budget}, X-Cache-Status: ${cache}`);
}

/**
 * A path that must be refused: an off-ladder width, or a width with no path.
 *
 * Two assertions, not one. "Is 404" catches the ordinary case; "is never an
 * image" is the one that matters, because the allowlist is a security boundary
 * and a 200 image from `/api/art/3000/` would mean the endpoint had quietly
 * become a resize-at-any-size proxy.
 */
export function verdictRejected(res) {
  const type = contentType(res);
  if (type.startsWith('image/')) {
    return fail(`served ${res?.status} ${type} — the width allowlist is not being enforced`);
  }
  if (res?.status !== 404) return fail(`expected HTTP 404, got ${res?.status} (${type || 'no content-type'})`);
  return pass(`404, ${type || 'no content-type'}`);
}

/**
 * Is the configured `image_filter_buffer` big enough for the biggest source?
 *
 * Not an HTTP check — it compares repo config against measured reality, which
 * is the only way this particular bug is visible: an undersized buffer 415s
 * only the largest few artworks, and only on a cache miss.
 */
export function verdictImageFilterBuffer({ maxOriginBytes, bufferBytes, headroom = IMAGE_FILTER_BUFFER_HEADROOM } = {}) {
  if (!Number.isFinite(bufferBytes) || bufferBytes < 1) return fail('no image_filter_buffer value to check against');
  if (!Number.isFinite(maxOriginBytes) || maxOriginBytes < 1) return fail('no measured origin sizes to check the buffer against');

  const ceiling = bufferBytes * headroom;
  const used = `largest source ${mb(maxOriginBytes)} vs image_filter_buffer ${mb(bufferBytes)} (${(maxOriginBytes / bufferBytes * 100).toFixed(1)}% used)`;
  if (maxOriginBytes >= bufferBytes) return fail(`${used} — sources OVER the buffer are 415'd by nginx and show as a dark placeholder`);
  if (maxOriginBytes >= ceiling) return fail(`${used} — under the buffer but over the ${headroom * 100}% headroom; raise image_filter_buffer before the next upload breaks`);
  return pass(used);
}

/**
 * Pull `image_filter_buffer 16M;` out of an nginx config's text.
 *
 * The parse exists so the assertion and the deployed config cannot drift: the
 * verifier asserts against whatever `deploy/nginx/cinemaslime-art-cache.conf`
 * actually says, not against a number copied into a script once. Returns null
 * when the directive is absent.
 *
 * Comments are stripped first — that file discusses an earlier, wrong value in
 * prose, and a naive match would happily assert against the bug.
 */
export function parseImageFilterBuffer(confText) {
  if (typeof confText !== 'string') return null;
  const live = confText.split('\n').map((line) => line.replace(/#.*$/, '')).join('\n');
  const match = /\bimage_filter_buffer\s+(\d+)([kKmMgG]?)\s*;/.exec(live);
  if (!match) return null;
  const scale = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase()];
  return Number(match[1]) * scale;
}

/**
 * The checks for one Episode artwork: every rung of the ladder must be a real,
 * cached, materially smaller image.
 *
 * Takes the RAW CloudFront URL and goes through `artworkUrl`, so the verifier
 * asks for exactly the URLs the site asks for. Re-deriving the path here would
 * let the verifier pass while the browser 404s.
 */
export function artworkChecks(rawUrl, originBytes) {
  if (!isArtworkUrl(rawUrl)) {
    throw new Error(`artworkChecks: not a pinned-host artwork URL: ${String(rawUrl)}`);
  }
  const name = new URL(rawUrl).pathname.split('/').pop();
  return ARTWORK_WIDTHS.map((width) => ({
    id: `art-${width}-${name}`,
    path: artworkUrl(rawUrl, width),
    expectation: `image/*, under ${ARTWORK_MAX_SIZE_RATIO * 100}% of origin, X-Cache-Status present`,
    verdict: (res) => verdictArtworkDerivative(res, { originBytes }),
  }));
}

/**
 * The allowlist boundary checks, built from one real artwork path so the only
 * thing wrong with each request is the width.
 */
export function widthBoundaryChecks(rawUrl) {
  if (!isArtworkUrl(rawUrl)) {
    throw new Error(`widthBoundaryChecks: not a pinned-host artwork URL: ${String(rawUrl)}`);
  }
  const path = new URL(rawUrl).pathname;
  const refused = OFF_LADDER_WIDTHS.map((width) => `${ARTWORK_PATH_PREFIX}/${width}${path}`);
  // A valid width with no path at all: the regex location must not match, and
  // the request must not fall through to the SPA either.
  refused.push(`${ARTWORK_PATH_PREFIX}/${ARTWORK_WIDTHS[0]}/`);

  return refused.map((p) => ({
    id: `refuse-${p}`,
    path: p,
    expectation: '404, and never an image',
    verdict: verdictRejected,
  }));
}

// The endpoints that exist independently of any Episode: fixed paths, fixed
// expectations. Frozen because a check list that a caller can mutate is a check
// list that a caller can empty.
export const SNAPSHOT_CHECKS = Object.freeze([
  Object.freeze({
    id: 'rss',
    path: '/api/rss',
    expectation: 'XML with at least one <item> (proxied Anchor feed, ADR 0006)',
    verdict: verdictXmlFeed,
  }),
  Object.freeze({
    id: 'essays-curation',
    path: '/api/essays/curation',
    expectation: 'JSON content-type AND a parseable JSON body (ADR 0008)',
    verdict: verdictJsonEndpoint,
  }),
  Object.freeze({
    id: 'essays-events',
    path: '/api/essays/events',
    expectation: 'JSON content-type AND a parseable JSON body (ADR 0008)',
    verdict: verdictJsonEndpoint,
  }),
]);

/**
 * The whole contract, as a flat list of `{ id, path, expectation, verdict }`.
 * The shell GETs each `path` against the target site and applies `verdict` to
 * the response descriptor. `originBytes` maps raw CloudFront URL → measured
 * bytes.
 */
export function buildEdgeContract({ artworkUrls = [], originBytes = new Map() } = {}) {
  if (artworkUrls.length === 0) {
    throw new Error('buildEdgeContract: no artwork URLs — the feed yielded none, which is itself a failure');
  }
  return [
    ...SNAPSHOT_CHECKS,
    ...artworkUrls.flatMap((raw) => artworkChecks(raw, originBytes.get(raw))),
    ...widthBoundaryChecks(artworkUrls[0]),
  ];
}

/**
 * Evenly spaced picks from `urls`, always including the first and last.
 *
 * Checking all ~70 artworks at all three rungs would be a 210-request run that
 * duplicates `warm:artwork`; a spread sample proves the endpoint works without
 * that. Deterministic on purpose — a random sample makes a flaky failure
 * impossible to reproduce.
 */
export function pickArtworkSample(urls, count) {
  if (count >= urls.length) return [...urls];
  if (count < 1) return [];
  if (count === 1) return [urls[0]];
  const step = (urls.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => urls[Math.round(i * step)]);
}

// Counting `<item>` open tags rather than XML-parsing: this module stays pure
// and dependency-free (the DOMParser used elsewhere is a devDependency the
// browser bundle never sees), and "does the feed contain episodes at all" needs
// no more resolution than this.
function countFeedItems(xml) {
  return (xml.match(/<item(\s|>)/g) || []).length;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
