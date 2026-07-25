import test from 'node:test';
import assert from 'node:assert/strict';
import {
  artworkUrl, isArtworkUrl, ARTWORK_HOST, ARTWORK_WIDTH, ARTWORK_WIDTHS, ARTWORK_PATH_PREFIX,
} from './artwork-url.js';

const ART = `https://${ARTWORK_HOST}/staging/podcast_uploaded_nologo/43698817/43698817-1757516582372-2a574ca9eaf8e.jpg`;

// ── pinned-host artwork is rewritten ─────────────────────────────────────────

test('rewrites a pinned-host artwork URL to a same-origin derivative path', () => {
  assert.equal(
    artworkUrl(ART, 320),
    '/api/art/320/staging/podcast_uploaded_nologo/43698817/43698817-1757516582372-2a574ca9eaf8e.jpg',
  );
});

test('the derivative path is same-origin (no scheme, no host)', () => {
  for (const width of ARTWORK_WIDTHS) {
    const out = artworkUrl(ART, width);
    assert.ok(out.startsWith(`${ARTWORK_PATH_PREFIX}/`), `not same-origin: ${out}`);
    assert.ok(!out.includes(ARTWORK_HOST), `raw host leaked: ${out}`);
    assert.ok(!out.includes('://'), `absolute URL emitted: ${out}`);
  }
});

test('the same source at different widths yields different paths', () => {
  const paths = new Set(ARTWORK_WIDTHS.map((w) => artworkUrl(ART, w)));
  assert.equal(paths.size, ARTWORK_WIDTHS.length);
});

test('multi-segment CloudFront paths survive intact', () => {
  assert.equal(artworkUrl(`https://${ARTWORK_HOST}/a/b/c/d.jpg`, 160), '/api/art/160/a/b/c/d.jpg');
});

test('percent-encoded path segments are preserved as-is', () => {
  const out = artworkUrl(`https://${ARTWORK_HOST}/staging/my%20art.jpg`, 160);
  assert.equal(out, '/api/art/160/staging/my%20art.jpg');
});

test('a space in the path is encoded rather than emitted raw', () => {
  const out = artworkUrl(`https://${ARTWORK_HOST}/staging/my art.jpg`, 160);
  assert.ok(!out.includes(' '), `unencoded space in: ${out}`);
});

test('query and fragment are dropped so one image is one cache key', () => {
  assert.equal(artworkUrl(`https://${ARTWORK_HOST}/a.jpg?v=2#x`, 160), '/api/art/160/a.jpg');
});

test('http and https on the pinned host are both rewritten', () => {
  assert.equal(artworkUrl(`http://${ARTWORK_HOST}/a.jpg`, 160), '/api/art/160/a.jpg');
});

// ── the width allowlist is the whole point ───────────────────────────────────

test('every width the module can be asked for emits an allowed width', () => {
  for (const width of Object.values(ARTWORK_WIDTH)) {
    assert.ok(ARTWORK_WIDTHS.includes(width), `named rung ${width} is not on the allowlist`);
    const emitted = Number(artworkUrl(ART, width).split('/')[3]);
    assert.ok(ARTWORK_WIDTHS.includes(emitted), `emitted width ${emitted} is not on the allowlist`);
  }
});

test('an unlisted width is refused rather than silently passed through', () => {
  for (const bad of [1, 161, 1600, 3000, 0, -160, '320', null, undefined, NaN, 320.5]) {
    assert.throws(() => artworkUrl(ART, bad), /unsupported width/, `width ${String(bad)} was accepted`);
  }
});

test('the allowlist is frozen so it cannot be widened at runtime', () => {
  assert.ok(Object.isFrozen(ARTWORK_WIDTHS));
  assert.ok(Object.isFrozen(ARTWORK_WIDTH));
});

// ── everything else passes through untouched ─────────────────────────────────

test('a URL on any other host passes through completely unchanged', () => {
  const others = [
    'https://example.com/art.jpg',
    'https://image.nostr.build/abc123.png',                  // Essay Cover Image
    'https://d3t3ozftmdmh3i.cloudfront.net.evil.test/a.jpg', // suffix-spoofed host
    'https://evil.test/?u=https://d3t3ozftmdmh3i.cloudfront.net/a.jpg',
  ];
  for (const url of others) assert.equal(artworkUrl(url, 320), url);
});

test('local assets and relative paths pass through unchanged', () => {
  for (const url of ['/cs-logo.png', 'cs-logo.png', '../a.jpg']) {
    assert.equal(artworkUrl(url, 640), url);
  }
});

test('a data URI passes through unchanged', () => {
  const uri = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  assert.equal(artworkUrl(uri, 160), uri);
});

test('missing or non-string artwork passes through unchanged', () => {
  for (const value of [null, undefined, '', 0, false, 42, {}]) {
    assert.equal(artworkUrl(value, 160), value);
  }
});

// ── isArtworkUrl agrees with artworkUrl about what gets rewritten ────────────

test('isArtworkUrl is true for exactly the URLs artworkUrl rewrites', () => {
  const candidates = [
    ART,
    `http://${ARTWORK_HOST}/a.jpg`,
    `https://${ARTWORK_HOST}/a.jpg?v=2`,
    'https://example.com/art.jpg',
    'https://d3t3ozftmdmh3i.cloudfront.net.evil.test/a.jpg',
    'https://evil.test/?u=https://d3t3ozftmdmh3i.cloudfront.net/a.jpg',
    '/cs-logo.png',
    'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    '',
    null,
    undefined,
    42,
  ];
  for (const url of candidates) {
    const rewritten = artworkUrl(url, 160) !== url;
    assert.equal(isArtworkUrl(url), rewritten, `disagreement about ${String(url)}`);
  }
});

test('isArtworkUrl rejects a host that merely contains the pinned name', () => {
  assert.equal(isArtworkUrl(`https://${ARTWORK_HOST}.evil.test/a.jpg`), false);
  assert.equal(isArtworkUrl(`https://evil.test/${ARTWORK_HOST}/a.jpg`), false);
});

// ── purity ───────────────────────────────────────────────────────────────────

test('deterministic: same inputs produce the same output', () => {
  assert.equal(artworkUrl(ART, 160), artworkUrl(ART, 160));
});
