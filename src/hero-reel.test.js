import test from 'node:test';
import assert from 'node:assert/strict';
import { heroReelDimensions, buildHeroReelFrameHtml, buildHeroReelHtml } from './hero-reel.js';

const SHOW_ART = 'https://example.com/show-art.jpg';
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
