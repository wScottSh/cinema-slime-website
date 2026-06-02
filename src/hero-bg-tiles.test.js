import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHeroBgTileDescriptors, buildHeroBgTileHtml } from './hero-bg-tiles.js';

const SHOW_ART = 'https://example.com/show-art.jpg';
const DARK_FILL_RANGE = [
  '#0a0a0a', '#0d0d0d', '#111111', '#141414',
  '#161616', '#1a1a1a', '#1e1e1e', '#222222',
];

const ep = (image) => ({ image });

// ── tile count helpers ────────────────────────────────────────────────────────
// Matches the formula in hero-bg-tiles.js so we can assert exact counts.
function expectedTileCount(width, height) {
  const containerW = width * 1.1;
  const TILE_SIZE = 270;
  const cols = Math.ceil(containerW / TILE_SIZE) + 1;
  const rows = Math.ceil(height / TILE_SIZE) + 1;
  return cols * rows;
}

// ── empty episodes array ──────────────────────────────────────────────────────

test('empty episodes array: correct tile count', () => {
  const vp = { width: 1280, height: 720 };
  const tiles = buildHeroBgTileDescriptors([], vp, SHOW_ART);
  assert.equal(tiles.length, expectedTileCount(vp.width, vp.height));
});

test('empty episodes array: all tiles have null src', () => {
  const tiles = buildHeroBgTileDescriptors([], { width: 1280, height: 720 }, SHOW_ART);
  assert.ok(tiles.length > 0, 'should produce tiles even without episodes');
  tiles.forEach((t, i) => assert.equal(t.src, null, `tile ${i} src should be null`));
});

test('empty episodes array: tiles still have dark fills', () => {
  const tiles = buildHeroBgTileDescriptors([], { width: 1280, height: 720 }, SHOW_ART);
  tiles.forEach(t => {
    assert.ok(DARK_FILL_RANGE.includes(t.darkFill), `unexpected fill: ${t.darkFill}`);
  });
});

// ── all images equal to SHOW_ART ──────────────────────────────────────────────

test('all-SHOW_ART episodes: tiles have null src (filtered out)', () => {
  const episodes = [ep(SHOW_ART), ep(SHOW_ART), ep(SHOW_ART)];
  const tiles = buildHeroBgTileDescriptors(episodes, { width: 1280, height: 720 }, SHOW_ART);
  assert.ok(tiles.length > 0);
  tiles.forEach(t => assert.equal(t.src, null));
});

test('mix of SHOW_ART and real images: only real images used as src', () => {
  const episodes = [ep(SHOW_ART), ep('real-a.jpg'), ep(SHOW_ART), ep('real-b.jpg')];
  const tiles = buildHeroBgTileDescriptors(episodes, { width: 1280, height: 720 }, SHOW_ART);
  tiles.forEach(t => {
    assert.notEqual(t.src, SHOW_ART, 'SHOW_ART should never appear as a tile src');
  });
  const srcs = new Set(tiles.map(t => t.src));
  assert.ok(srcs.has('real-a.jpg'));
  assert.ok(srcs.has('real-b.jpg'));
});

// ── large viewport: many tiles + image cycling ────────────────────────────────

test('large viewport: generates more tiles than a small viewport', () => {
  const episodes = [ep('img.jpg')];
  const large = buildHeroBgTileDescriptors(episodes, { width: 1920, height: 1080 }, SHOW_ART);
  const small = buildHeroBgTileDescriptors(episodes, { width: 320, height: 568 }, SHOW_ART);
  assert.ok(large.length > small.length, `large(${large.length}) should exceed small(${small.length})`);
});

test('large viewport: all tile srcs cycle through the available episode images', () => {
  const images = ['img-a.jpg', 'img-b.jpg', 'img-c.jpg'];
  const episodes = images.map(ep);
  const tiles = buildHeroBgTileDescriptors(episodes, { width: 1920, height: 1080 }, SHOW_ART);
  assert.ok(tiles.length > 20, `expected >20 tiles, got ${tiles.length}`);
  tiles.forEach(t => assert.ok(images.includes(t.src), `unexpected src: ${t.src}`));
  const srcs = new Set(tiles.map(t => t.src));
  assert.equal(srcs.size, 3, 'all 3 episode images should appear');
});

test('large viewport: cycling is index-based (i % thumbs.length)', () => {
  const images = ['a.jpg', 'b.jpg', 'c.jpg'];
  const tiles = buildHeroBgTileDescriptors(images.map(ep), { width: 1920, height: 1080 }, SHOW_ART);
  tiles.forEach((t, i) => {
    assert.equal(t.src, images[i % images.length], `tile ${i} src mismatch`);
  });
});

// ── small viewport ────────────────────────────────────────────────────────────

test('small viewport: tile count matches formula', () => {
  const vp = { width: 320, height: 568 };
  const tiles = buildHeroBgTileDescriptors([ep('img.jpg')], vp, SHOW_ART);
  assert.equal(tiles.length, expectedTileCount(vp.width, vp.height));
});

test('small viewport: at least one tile produced', () => {
  const tiles = buildHeroBgTileDescriptors([ep('img.jpg')], { width: 320, height: 568 }, SHOW_ART);
  assert.ok(tiles.length >= 1);
});

// ── dark fills ────────────────────────────────────────────────────────────────

test('dark fills are all within the documented design-token range', () => {
  const tiles = buildHeroBgTileDescriptors([ep('img.jpg')], { width: 1280, height: 720 }, SHOW_ART);
  tiles.forEach(t => {
    assert.ok(DARK_FILL_RANGE.includes(t.darkFill), `out-of-range fill: ${t.darkFill}`);
  });
});

test('dark fills vary across tiles (no single uniform colour)', () => {
  const tiles = buildHeroBgTileDescriptors([ep('img.jpg')], { width: 1280, height: 720 }, SHOW_ART);
  const fills = new Set(tiles.map(t => t.darkFill));
  assert.ok(fills.size > 1, `expected varied fills, got ${fills.size} unique value(s)`);
});

test('all 8 dark fill values appear across a large viewport', () => {
  const tiles = buildHeroBgTileDescriptors([ep('img.jpg')], { width: 1920, height: 1080 }, SHOW_ART);
  const fills = new Set(tiles.map(t => t.darkFill));
  assert.equal(fills.size, DARK_FILL_RANGE.length, 'all 8 fill values should appear on a large viewport');
});

// ── descriptor shape ──────────────────────────────────────────────────────────

test('each descriptor has exactly src and darkFill properties', () => {
  const tiles = buildHeroBgTileDescriptors([ep('img.jpg')], { width: 800, height: 600 }, SHOW_ART);
  tiles.forEach((t, i) => {
    assert.ok('src' in t, `tile ${i} missing src`);
    assert.ok('darkFill' in t, `tile ${i} missing darkFill`);
  });
});

test('function is deterministic: same inputs produce identical output', () => {
  const episodes = [ep('a.jpg'), ep('b.jpg')];
  const vp = { width: 1280, height: 720 };
  const first = buildHeroBgTileDescriptors(episodes, vp, SHOW_ART);
  const second = buildHeroBgTileDescriptors(episodes, vp, SHOW_ART);
  assert.deepEqual(first, second);
});

// ── buildHeroBgTileHtml: accessibility + non-interactive ──────────────────────

test('tile html: img with src has empty alt attribute', () => {
  const html = buildHeroBgTileHtml({ src: 'https://example.com/ep.jpg', darkFill: '#111' });
  assert.ok(html.includes('alt=""'), 'img must have alt="" for decorative image');
});

test('tile html: null src produces no img element', () => {
  const html = buildHeroBgTileHtml({ src: null, darkFill: '#111' });
  assert.ok(!html.includes('<img'), 'null-src tile must not render an img element');
});

test('tile html: no tabindex attributes (not keyboard-focusable)', () => {
  const htmlWithSrc = buildHeroBgTileHtml({ src: 'https://example.com/ep.jpg', darkFill: '#111' });
  const htmlNoSrc = buildHeroBgTileHtml({ src: null, darkFill: '#111' });
  assert.ok(!htmlWithSrc.includes('tabindex'), 'tile with src must not have tabindex');
  assert.ok(!htmlNoSrc.includes('tabindex'), 'placeholder tile must not have tabindex');
});

test('tile html: no interactive elements (no <a> or <button>)', () => {
  const html = buildHeroBgTileHtml({ src: 'https://example.com/ep.jpg', darkFill: '#111' });
  assert.ok(!html.includes('<a'), 'tile must not contain anchor elements');
  assert.ok(!html.includes('<button'), 'tile must not contain button elements');
});

test('tile html: wrapper has hero-bg-tile-wrap class', () => {
  const html = buildHeroBgTileHtml({ src: null, darkFill: '#161616' });
  assert.ok(html.includes('hero-bg-tile-wrap'), 'wrapper must have hero-bg-tile-wrap class');
});

test('tile html: placeholder div is always present with the provided darkFill', () => {
  const html = buildHeroBgTileHtml({ src: null, darkFill: '#1a1a1a' });
  assert.ok(html.includes('hero-bg-tile-placeholder'), 'must contain placeholder div');
  assert.ok(html.includes('#1a1a1a'), 'placeholder must apply the darkFill colour');
});
