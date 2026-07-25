import test from 'node:test';
import assert from 'node:assert/strict';
import { revealHeroReel } from './hero-reel-reveal.js';

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockImg() {
  const img = {
    _decodeCalls: 0,
    _resolvers: [],
    _rejectors: [],
    decode() {
      img._decodeCalls++;
      return new Promise((res, rej) => { img._resolvers.push(res); img._rejectors.push(rej); });
    },
    resolve() { img._resolvers.forEach(fn => fn()); },
    reject() { img._rejectors.forEach(fn => fn(new Error('decode failed'))); },
  };
  return img;
}

function makeMockLayer(imgs) {
  const classes = new Set();
  return {
    dataset: {},
    _offsetReads: 0,
    get offsetWidth() { this._offsetReads++; return 0; },
    classList: { add: c => classes.add(c), has: c => classes.has(c) },
    querySelectorAll: sel => (sel === 'img.hero-reel-art-img' ? imgs : []),
    _classes: classes,
  };
}

function mockRoot(layers) {
  return { querySelectorAll: sel => (sel === '.hero-reel-layer' ? layers : []) };
}

// ── empty / missing ──────────────────────────────────────────────────────────

test('no layers: does nothing without throwing', () => {
  assert.doesNotThrow(() => revealHeroReel(mockRoot([])));
});

test('layer with no images: reveals immediately', () => {
  const layer = makeMockLayer([]);
  revealHeroReel(mockRoot([layer]));
  assert.ok(layer._classes.has('reel-loaded'), 'empty layer should reveal at once');
  assert.equal(layer.dataset.reelRevealed, '1');
});

// ── decode-driven reveal ──────────────────────────────────────────────────────

test('reveals once the first frames decode', async () => {
  const imgs = [makeMockImg(), makeMockImg()];
  const layer = makeMockLayer(imgs);
  revealHeroReel(mockRoot([layer]));
  assert.ok(!layer._classes.has('reel-loaded'), 'should wait for decode');
  imgs.forEach(i => i.resolve());
  await Promise.resolve(); await Promise.resolve();
  assert.ok(layer._classes.has('reel-loaded'), 'should reveal after decodes settle');
});

test('reveals even when decode() rejects (allSettled swallows failures)', async () => {
  const img = makeMockImg();
  const layer = makeMockLayer([img]);
  revealHeroReel(mockRoot([layer]));
  img.reject();
  await Promise.resolve(); await Promise.resolve();
  assert.ok(layer._classes.has('reel-loaded'), 'a rejected decode must not leave the layer hidden');
});

test('only the first 8 frames are decoded (avoids decoding hundreds of frames)', () => {
  const imgs = Array.from({ length: 40 }, makeMockImg);
  const layer = makeMockLayer(imgs);
  revealHeroReel(mockRoot([layer]));
  const decoded = imgs.filter(i => i._decodeCalls > 0).length;
  assert.equal(decoded, 8, 'reveal should sample at most the first 8 frames');
});

test('reads offsetWidth before adding .reel-loaded so the fade transition fires', async () => {
  const layer = makeMockLayer([]); // empty → synchronous reveal path
  revealHeroReel(mockRoot([layer]));
  assert.ok(layer._offsetReads > 0, 'offsetWidth must be read to commit opacity:0 before the class flip');
  assert.ok(layer._classes.has('reel-loaded'));
});

// ── idempotency ───────────────────────────────────────────────────────────────

test('idempotent: an already-revealed layer is skipped (no re-fade, no re-decode)', () => {
  const img = makeMockImg();
  const layer = makeMockLayer([img]);
  const root = mockRoot([layer]);
  revealHeroReel(root);
  revealHeroReel(root); // e.g. a resize rebuild
  assert.equal(img._decodeCalls, 1, 'decode() must not fire again for an already-revealed layer');
});

test('multiple layers are each revealed independently', () => {
  const a = makeMockLayer([]);
  const b = makeMockLayer([]);
  revealHeroReel(mockRoot([a, b]));
  assert.ok(a._classes.has('reel-loaded') && b._classes.has('reel-loaded'));
});
