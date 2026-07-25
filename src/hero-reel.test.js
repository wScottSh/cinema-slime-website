import test from 'node:test';
import assert from 'node:assert/strict';
import { heroReelDimensions, buildHeroReelFrameHtml, buildHeroReelHtml, shuffleEpisodes } from './hero-reel.js';
import { ARTWORK_HOST, ARTWORK_WIDTHS } from './artwork-url.js';

const SHOW_ART = 'https://example.com/show-art.jpg';
const cloudfront = (name) => `https://${ARTWORK_HOST}/staging/podcast_uploaded_nologo/43698817/${name}`;
const DARK_FILL_RANGE = [
  '#0a0a0a', '#0d0d0d', '#111111', '#141414',
  '#161616', '#1a1a1a', '#1e1e1e', '#222222',
];

const ep = (image) => ({ image });

// Matches the formula in hero-reel.js so we can assert exact counts.
function expectedDims(width, height) {
  const FRAME_SIZE = 270;
  const OVERFILL = 1.9;
  const cols = Math.ceil((width * OVERFILL) / FRAME_SIZE) + 1;
  const rows = Math.ceil((height * OVERFILL) / FRAME_SIZE) + 1;
  return { cols, rows };
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Pull the src cycling order out of the rendered markup (in document order).
function srcsInOrder(html) {
  return [...html.matchAll(/src="([^"]*)"/g)].map(m => m[1]);
}
function fillsInOrder(html) {
  return [...html.matchAll(/background:([^"]*)"/g)].map(m => m[1]);
}

// ── heroReelDimensions ────────────────────────────────────────────────────────

test('dimensions: match the overfill formula', () => {
  const vp = { width: 1280, height: 720 };
  assert.deepEqual(heroReelDimensions(vp), expectedDims(vp.width, vp.height));
});

test('dimensions: larger viewport yields more strips and rows', () => {
  const large = heroReelDimensions({ width: 1920, height: 1080 });
  const small = heroReelDimensions({ width: 320, height: 568 });
  assert.ok(large.cols > small.cols);
  assert.ok(large.rows > small.rows);
});

// ── strip / frame structure ───────────────────────────────────────────────────

test('markup: one .hero-reel-strip (and its track) per column', () => {
  const vp = { width: 1280, height: 720 };
  const { cols } = expectedDims(vp.width, vp.height);
  const html = buildHeroReelHtml({ episodes: [ep('a.jpg')], viewport: vp, showArt: SHOW_ART });
  // Exactly one drifting track per strip.
  assert.equal(countOccurrences(html, 'hero-reel-strip-track"'), cols);
});

test('markup: alternate strips get the --rev modifier', () => {
  const vp = { width: 1280, height: 720 };
  const { cols } = expectedDims(vp.width, vp.height);
  const html = buildHeroReelHtml({ episodes: [ep('a.jpg')], viewport: vp, showArt: SHOW_ART });
  assert.equal(countOccurrences(html, 'hero-reel-strip--rev'), Math.floor(cols / 2));
});

test('markup: frame set is duplicated per strip for a seamless loop', () => {
  const vp = { width: 1280, height: 720 };
  const { cols, rows } = expectedDims(vp.width, vp.height);
  const html = buildHeroReelHtml({ episodes: [ep('a.jpg')], viewport: vp, showArt: SHOW_ART });
  // cols strips × rows frames × 2 (duplicated).
  assert.equal(countOccurrences(html, 'hero-reel-frame"'), cols * rows * 2);
});

test('markup: wraps everything in a single .hero-reel canvas', () => {
  const html = buildHeroReelHtml({ episodes: [ep('a.jpg')], viewport: { width: 800, height: 600 }, showArt: SHOW_ART });
  assert.ok(html.startsWith('<div class="hero-reel">'));
  assert.equal(countOccurrences(html, 'class="hero-reel"'), 1);
});

// ── src cycling + filtering ───────────────────────────────────────────────────

test('src cycling: is index-based within the duplicated frame set', () => {
  const images = ['a.jpg', 'b.jpg', 'c.jpg'];
  const vp = { width: 1920, height: 1080 };
  const html = buildHeroReelHtml({ episodes: images.map(ep), viewport: vp, showArt: SHOW_ART });
  const srcs = srcsInOrder(html);
  assert.ok(srcs.length > 20);
  srcs.forEach((src, i) => assert.equal(src, images[i % images.length], `frame ${i} src mismatch`));
});

test('all episode images appear across a large viewport', () => {
  const images = ['img-a.jpg', 'img-b.jpg', 'img-c.jpg'];
  const html = buildHeroReelHtml({ episodes: images.map(ep), viewport: { width: 1920, height: 1080 }, showArt: SHOW_ART });
  const srcs = new Set(srcsInOrder(html));
  assert.equal(srcs.size, 3);
});

test('SHOW_ART is filtered out and never appears as a frame src', () => {
  const episodes = [ep(SHOW_ART), ep('real-a.jpg'), ep(SHOW_ART), ep('real-b.jpg')];
  const html = buildHeroReelHtml({ episodes, viewport: { width: 1280, height: 720 }, showArt: SHOW_ART });
  const srcs = srcsInOrder(html);
  assert.ok(!srcs.includes(SHOW_ART));
  assert.ok(srcs.includes('real-a.jpg') && srcs.includes('real-b.jpg'));
});

test('no usable images: no img elements rendered (dark placeholders only)', () => {
  for (const episodes of [[], [ep(SHOW_ART)], [ep(null)], [ep(undefined)], [ep('')], null, undefined]) {
    const html = buildHeroReelHtml({ episodes, viewport: { width: 800, height: 600 }, showArt: SHOW_ART });
    assert.ok(!html.includes('<img'), `expected no img for episodes=${JSON.stringify(episodes)}`);
    assert.ok(html.includes('hero-reel-frame'), 'frames still render as placeholders');
  }
});

test('mixed missing/valid images: only valid images become frame srcs', () => {
  const episodes = [ep(null), ep('valid.jpg'), ep(''), ep(undefined)];
  const html = buildHeroReelHtml({ episodes, viewport: { width: 1280, height: 720 }, showArt: SHOW_ART });
  srcsInOrder(html).forEach(src => assert.equal(src, 'valid.jpg'));
});

// ── artwork derivatives (the regression guard for issue #106) ─────────────────

test('no raw CloudFront artwork URL appears anywhere in the rendered reel', () => {
  const episodes = [cloudfront('a.jpg'), cloudfront('b/c.jpg'), cloudfront('d.jpg')].map(ep);
  const html = buildHeroReelHtml({ episodes, viewport: { width: 2560, height: 1200 }, showArt: SHOW_ART });
  assert.ok(!html.includes(ARTWORK_HOST), 'a raw CloudFront URL reached the rendered page');
});

test('every emitted src is a same-origin derivative at an allowed width', () => {
  const episodes = [cloudfront('a.jpg'), cloudfront('b/c.jpg')].map(ep);
  const html = buildHeroReelHtml({ episodes, viewport: { width: 1920, height: 1080 }, showArt: SHOW_ART });
  const srcs = srcsInOrder(html);
  assert.ok(srcs.length > 20);
  for (const src of srcs) {
    const match = /^\/api\/art\/(\d+)\/.+$/.exec(src);
    assert.ok(match, `not a same-origin derivative path: ${src}`);
    assert.ok(ARTWORK_WIDTHS.includes(Number(match[1])), `width off the allowlist: ${src}`);
  }
});

test('the reel uses the smallest rung — its slot is blurred and dimmed', () => {
  const html = buildHeroReelHtml({ episodes: [ep(cloudfront('a.jpg'))], viewport: { width: 1280, height: 720 }, showArt: SHOW_ART });
  srcsInOrder(html).forEach((src) => assert.ok(src.startsWith('/api/art/160/'), `unexpected rung: ${src}`));
});

test('every distinct Episode artwork is still eligible to appear — nothing is capped', () => {
  const episodes = Array.from({ length: 70 }, (_, i) => ep(cloudfront(`ep-${i}.jpg`)));
  const html = buildHeroReelHtml({ episodes, viewport: { width: 2560, height: 1200 }, showArt: SHOW_ART });
  assert.equal(new Set(srcsInOrder(html)).size, 70);
});

// ── loading attributes ────────────────────────────────────────────────────────

test('frame images are low-priority and decode asynchronously', () => {
  const html = buildHeroReelFrameHtml({ src: '/api/art/160/a.jpg', darkFill: '#111' });
  assert.ok(html.includes('fetchpriority="low"'));
  assert.ok(html.includes('decoding="async"'));
});

test('frame images are NOT lazy — tilted tracks may never cross the lazy threshold', () => {
  const html = buildHeroReelFrameHtml({ src: '/api/art/160/a.jpg', darkFill: '#111' });
  assert.ok(!html.includes('loading="lazy"'));
});

// ── shuffle (Fisher-Yates, injectable randomness) ─────────────────────────────

test('shuffle: a known random sequence produces the exact Fisher-Yates permutation', () => {
  // Fisher-Yates walks i = 4..1, drawing j = floor(r * (i + 1)).
  // r = [0, 0, 0, 0] always picks j = 0, which rotates the head to the tail:
  //   i=4 swap 4,0 -> e b c d a
  //   i=3 swap 3,0 -> d b c e a
  //   i=2 swap 2,0 -> c b d e a
  //   i=1 swap 1,0 -> b c d e a
  const zeros = [0, 0, 0, 0];
  let n = 0;
  assert.deepEqual(
    shuffleEpisodes(['a', 'b', 'c', 'd', 'e'], () => zeros[n++]),
    ['b', 'c', 'd', 'e', 'a'],
  );

  // A different fixed sequence must produce a different, equally exact result.
  const seq = [0.99, 0.0, 0.5, 0.99];
  let m = 0;
  //   i=4 j=floor(.99*5)=4 -> no-op            a b c d e
  //   i=3 j=0              -> swap 3,0         d b c a e
  //   i=2 j=floor(.5*3)=1  -> swap 2,1         d c b a e
  //   i=1 j=floor(.99*2)=1 -> no-op            d c b a e
  assert.deepEqual(shuffleEpisodes(['a', 'b', 'c', 'd', 'e'], () => seq[m++]), ['d', 'c', 'b', 'a', 'e']);
});

test('shuffle: every element survives exactly once, nothing dropped or duplicated', () => {
  const input = Array.from({ length: 70 }, (_, i) => `ep-${i}`);
  for (let run = 0; run < 20; run++) {
    const out = shuffleEpisodes(input);
    assert.equal(out.length, input.length);
    assert.deepEqual([...out].sort(), [...input].sort());
  }
});

test('shuffle: does not mutate the input list', () => {
  const input = ['a', 'b', 'c', 'd'];
  const copy = [...input];
  shuffleEpisodes(input, () => 0);
  assert.deepEqual(input, copy);
});

test('shuffle: empty and single-element lists are handled', () => {
  assert.deepEqual(shuffleEpisodes([]), []);
  assert.deepEqual(shuffleEpisodes(['only']), ['only']);
});

// ── dark fills ────────────────────────────────────────────────────────────────

test('dark fills are all within the documented design-token range', () => {
  const html = buildHeroReelHtml({ episodes: [ep('a.jpg')], viewport: { width: 1280, height: 720 }, showArt: SHOW_ART });
  fillsInOrder(html).forEach(fill => assert.ok(DARK_FILL_RANGE.includes(fill), `out-of-range fill: ${fill}`));
});

test('all 8 dark fill values appear across a large viewport', () => {
  const html = buildHeroReelHtml({ episodes: [ep('a.jpg')], viewport: { width: 1920, height: 1080 }, showArt: SHOW_ART });
  assert.equal(new Set(fillsInOrder(html)).size, DARK_FILL_RANGE.length);
});

// ── determinism ───────────────────────────────────────────────────────────────

test('deterministic: same inputs produce identical markup', () => {
  const args = { episodes: [ep('a.jpg'), ep('b.jpg')], viewport: { width: 1280, height: 720 }, showArt: SHOW_ART };
  assert.equal(buildHeroReelHtml(args), buildHeroReelHtml(args));
});

// ── buildHeroReelFrameHtml: accessibility + non-interactive ───────────────────

test('frame html: img with src has empty alt (decorative)', () => {
  const html = buildHeroReelFrameHtml({ src: 'https://example.com/ep.jpg', darkFill: '#111' });
  assert.ok(html.includes('alt=""'));
});

test('frame html: null src produces no img element', () => {
  const html = buildHeroReelFrameHtml({ src: null, darkFill: '#111' });
  assert.ok(!html.includes('<img'));
});

test('frame html: no tabindex and no interactive elements', () => {
  const html = buildHeroReelFrameHtml({ src: 'https://example.com/ep.jpg', darkFill: '#111' });
  assert.ok(!html.includes('tabindex'));
  assert.ok(!html.includes('<a') && !html.includes('<button'));
});

test('frame html: placeholder fill is always present with the provided colour', () => {
  const html = buildHeroReelFrameHtml({ src: null, darkFill: '#1a1a1a' });
  assert.ok(html.includes('hero-reel-art-fill'));
  assert.ok(html.includes('#1a1a1a'));
});

test('frame html: has the film-frame and cover-window classes', () => {
  const html = buildHeroReelFrameHtml({ src: null, darkFill: '#161616' });
  assert.ok(html.includes('hero-reel-frame'));
  assert.ok(html.includes('hero-reel-art'));
});
