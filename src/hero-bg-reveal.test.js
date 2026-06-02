import test from 'node:test';
import assert from 'node:assert/strict';
import { revealHeroBgTiles } from './hero-bg-reveal.js';

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockImg() {
  const img = {
    dataset: {},
    _classes: new Set(),
    classList: { add(cls) { img._classes.add(cls); }, has(cls) { return img._classes.has(cls); } },
    _decodeResolvers: [],
    _decodeRejectors: [],
    _decodeCalls: 0,
    decode() {
      img._decodeCalls++;
      return new Promise((res, rej) => {
        img._decodeResolvers.push(res);
        img._decodeRejectors.push(rej);
      });
    },
    resolveDecodes() { img._decodeResolvers.forEach(fn => fn()); },
    rejectDecodes() { img._decodeRejectors.forEach(fn => fn(new Error('failed'))); },
  };
  return img;
}

function mockRoot(imgs) {
  return { querySelectorAll: (sel) => (sel === 'img.hero-bg-tile' ? imgs : []) };
}

// ── empty / missing ──────────────────────────────────────────────────────────

test('no tiles: does nothing without throwing', () => {
  assert.doesNotThrow(() => revealHeroBgTiles(mockRoot([])));
});

// ── wiring ────────────────────────────────────────────────────────────────────

test('marks the img as wired (sets dataset.revealWired)', () => {
  const img = makeMockImg();
  revealHeroBgTiles(mockRoot([img]));
  assert.equal(img.dataset.revealWired, '1');
});

test('adds .loaded class after decode() resolves', async () => {
  const img = makeMockImg();
  revealHeroBgTiles(mockRoot([img]));
  assert.ok(!img._classes.has('loaded'), 'should not be loaded before decode resolves');
  img.resolveDecodes();
  await Promise.resolve();
  assert.ok(img._classes.has('loaded'), 'should be loaded after decode resolves');
});

test('does not add .loaded if decode() rejects (failed/missing image)', async () => {
  const img = makeMockImg();
  revealHeroBgTiles(mockRoot([img]));
  img.rejectDecodes();
  await Promise.resolve();
  assert.ok(!img._classes.has('loaded'), 'failed tile must not enter loaded state');
});

// ── idempotency ───────────────────────────────────────────────────────────────

test('idempotent: calling twice only wires each img once', () => {
  const img = makeMockImg();
  const root = mockRoot([img]);
  revealHeroBgTiles(root);
  revealHeroBgTiles(root);
  assert.equal(img._decodeCalls, 1, 'decode() should only be called once per img');
});

test('idempotent: already-wired imgs are skipped on second call', () => {
  const img = makeMockImg();
  const root = mockRoot([img]);
  revealHeroBgTiles(root);
  const firstWiredValue = img.dataset.revealWired;
  revealHeroBgTiles(root);
  assert.equal(img.dataset.revealWired, firstWiredValue, 'wired marker should not be mutated on second call');
});

// ── multiple tiles ────────────────────────────────────────────────────────────

test('wires all tile imgs in a multi-tile layout', () => {
  const imgs = [makeMockImg(), makeMockImg(), makeMockImg()];
  revealHeroBgTiles(mockRoot(imgs));
  imgs.forEach((img, i) => {
    assert.equal(img.dataset.revealWired, '1', `img ${i} should be wired`);
  });
});

test('each tile reveals independently: one decode resolve does not affect others', async () => {
  const [imgA, imgB] = [makeMockImg(), makeMockImg()];
  revealHeroBgTiles(mockRoot([imgA, imgB]));
  imgA.resolveDecodes();
  await Promise.resolve();
  assert.ok(imgA._classes.has('loaded'), 'imgA should be loaded');
  assert.ok(!imgB._classes.has('loaded'), 'imgB should not yet be loaded');
  imgB.resolveDecodes();
  await Promise.resolve();
  assert.ok(imgB._classes.has('loaded'), 'imgB should now be loaded');
});

// ── back-navigation / re-render ───────────────────────────────────────────────

test('reads offsetWidth before adding .loaded to ensure CSS transition fires for cached images', async () => {
  const img = makeMockImg();
  let offsetWidthRead = false;
  Object.defineProperty(img, 'offsetWidth', {
    get() { offsetWidthRead = true; return 0; },
    configurable: true,
  });
  revealHeroBgTiles(mockRoot([img]));
  img.resolveDecodes();
  await Promise.resolve();
  assert.ok(offsetWidthRead, 'offsetWidth must be read before .loaded is added so the initial opacity:0 state is committed and the CSS transition fires on return navigation');
  assert.ok(img._classes.has('loaded'), '.loaded is still added after the layout read');
});

test('back-nav re-render: fresh img elements (new objects) are wired by a subsequent revealHeroBgTiles() call', async () => {
  const img1 = makeMockImg();
  revealHeroBgTiles(mockRoot([img1]));
  img1.resolveDecodes();
  await Promise.resolve();
  assert.ok(img1._classes.has('loaded'));

  // Simulate render() re-creating the DOM on return to Discovery View
  const img2 = makeMockImg(); // fresh object — no dataset.revealWired
  revealHeroBgTiles(mockRoot([img2]));
  assert.equal(img2.dataset.revealWired, '1', 'new img from re-render should be wired');
  assert.equal(img2._decodeCalls, 1, 'decode() should be called once on the new img');
  img2.resolveDecodes();
  await Promise.resolve();
  assert.ok(img2._classes.has('loaded'), 'new img from re-render should be revealed');
});

test('back-nav re-render: old wired imgs from a prior render do not block new imgs from being wired', () => {
  const oldImg = makeMockImg(); // from first render, never removed from mock
  oldImg.dataset.revealWired = '1'; // already wired (simulates being processed before re-render)

  const newImg = makeMockImg(); // fresh img from re-render
  revealHeroBgTiles(mockRoot([oldImg, newImg]));

  assert.equal(oldImg._decodeCalls, 0, 'already-wired old img should not get another decode() call');
  assert.equal(newImg.dataset.revealWired, '1', 'new img should be wired');
  assert.equal(newImg._decodeCalls, 1, 'new img should get exactly one decode() call');
});
