// The single seam between an Episode's raw artwork URL and the URL the browser
// actually requests. Every place on the site that renders Episode artwork goes
// through here, so there is exactly one place that knows the mapping rule.
//
// Episode artwork is uploaded to one pinned CloudFront host as 3000x3000 JPEGs
// (~2.2 MB each). Nothing on the site displays them anywhere near that size, so
// every artwork reference on that host is rewritten to a same-origin derivative
// path — `/api/art/{width}/{path}` — which nginx on the droplet resizes once and
// then serves from its own cache (see docs/deploy/nginx-artwork-proxy.md and
// ADR 0013). Any URL that is NOT on the pinned host (a local asset, a data URI,
// an Essay Cover Image from an arbitrary Nostr host) passes through untouched.
//
// Pure: no DOM, no network, no config. Safe to call from any renderer.

// The one host whose artwork nginx is configured to fetch and resize. Hardcoded
// on the server side too — that is what keeps /api/art/ from ever becoming a
// general-purpose open image proxy.
export const ARTWORK_HOST = 'd3t3ozftmdmh3i.cloudfront.net';

// The same-origin prefix nginx serves derivatives from.
export const ARTWORK_PATH_PREFIX = '/api/art';

// The complete width ladder. nginx rejects anything not on this list, so this
// allowlist exists to keep the client from ever constructing a URL the server
// would refuse. Adding a rung means editing the nginx config too.
export const ARTWORK_WIDTHS = Object.freeze([160, 320, 640]);

// The rung each call site uses, named by slot rather than by number so a call
// site cannot drift onto an arbitrary width.
export const ARTWORK_WIDTH = Object.freeze({
  REEL: 160,    // hero film-reel frame: 270px slot, blurred to ~2.2px and dimmed to ~32%
  PLAYER: 160,  // sticky player thumbnail: 56px slot
  CARD: 320,    // Episode grid card: 220px slot
  FEATURE: 640, // latest-Episode card in the hero marquee: the largest slot on the page
});

/**
 * The derivative URL for `rawUrl` at `width`.
 *
 * Returns `rawUrl` unchanged when it is not a pinned-host artwork URL (falsy,
 * non-string, unparseable, or any other host) — Essay Cover Images and local
 * assets are deliberately left alone.
 *
 * Throws on a width outside ARTWORK_WIDTHS: there is no code path by which this
 * module can emit an unlisted width, because nginx would reject it anyway and a
 * silently-passed-through raw URL would reintroduce the multi-megabyte original.
 */
export function artworkUrl(rawUrl, width) {
  if (!ARTWORK_WIDTHS.includes(width)) {
    throw new Error(`artworkUrl: unsupported width ${width}; expected one of ${ARTWORK_WIDTHS.join(', ')}`);
  }
  if (typeof rawUrl !== 'string' || rawUrl === '') return rawUrl;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl; // relative path, data URI without a parseable form, garbage
  }
  if (parsed.hostname !== ARTWORK_HOST) return rawUrl;

  // pathname is already percent-encoded and always starts with "/". Query and
  // fragment are dropped: upload URLs never carry either, and keeping them out
  // of the derivative path keeps one image to one cache key.
  return `${ARTWORK_PATH_PREFIX}/${width}${parsed.pathname}`;
}
