import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWindow, findFocusTarget } from './episode-window.js';

const CAP = 12;
const make = n => Array.from({ length: n }, (_, i) => ({ guid: `ep-${i}` }));

test('empty list → empty visible, no hasMore', () => {
  const result = applyWindow([], false, CAP);
  assert.deepEqual(result, { visible: [], hasMore: false, totalCount: 0 });
});

test('fewer than cap → all visible, no hasMore', () => {
  const list = make(5);
  const result = applyWindow(list, false, CAP);
  assert.equal(result.visible.length, 5);
  assert.equal(result.hasMore, false);
  assert.equal(result.totalCount, 5);
});

test('exactly cap → all visible, no hasMore', () => {
  const list = make(12);
  const result = applyWindow(list, false, CAP);
  assert.equal(result.visible.length, 12);
  assert.equal(result.hasMore, false);
  assert.equal(result.totalCount, 12);
});

test('more than cap, collapsed → first cap visible, hasMore true', () => {
  const list = make(20);
  const result = applyWindow(list, false, CAP);
  assert.equal(result.visible.length, 12);
  assert.equal(result.hasMore, true);
  assert.equal(result.totalCount, 20);
  assert.equal(result.visible[0].guid, 'ep-0');
  assert.equal(result.visible[11].guid, 'ep-11');
});

test('more than cap, expanded → all visible, no hasMore', () => {
  const list = make(20);
  const result = applyWindow(list, true, CAP);
  assert.equal(result.visible.length, 20);
  assert.equal(result.hasMore, false);
  assert.equal(result.totalCount, 20);
});

test('single item list → all visible, no hasMore', () => {
  const list = make(1);
  const result = applyWindow(list, false, CAP);
  assert.equal(result.visible.length, 1);
  assert.equal(result.hasMore, false);
});

test('visible slice preserves item references', () => {
  const list = make(15);
  const result = applyWindow(list, false, CAP);
  for (let i = 0; i < 12; i++) {
    assert.equal(result.visible[i], list[i]);
  }
});

test('findFocusTarget returns the element at the cap index (first newly-revealed card)', () => {
  const links = Array.from({ length: 20 }, (_, i) => ({ id: i }));
  assert.equal(findFocusTarget(links, CAP), links[CAP]);
});

test('findFocusTarget returns null when links list is shorter than cap', () => {
  const links = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  assert.equal(findFocusTarget(links, CAP), null);
});

test('findFocusTarget returns null for empty links list', () => {
  assert.equal(findFocusTarget([], CAP), null);
});

test('findFocusTarget returns null when links length equals cap (nothing newly revealed)', () => {
  const links = Array.from({ length: CAP }, (_, i) => ({ id: i }));
  assert.equal(findFocusTarget(links, CAP), null);
});
