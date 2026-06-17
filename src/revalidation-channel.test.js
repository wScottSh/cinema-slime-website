import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevalidationChannel } from './revalidation-channel.js';

const idle     = { searching: false, scrolled: false };
const searching = { searching: true,  scrolled: false };
const scrolled  = { searching: false, scrolled: true  };

function makeChannel(idKey = 'guid') {
  const applied = [];
  const channel = createRevalidationChannel({
    apply: (data) => applied.push(data),
    idKey,
  });
  return { channel, applied };
}

// ===== cold start =====

test('cold start (no seed) → apply immediately regardless of interacting state', () => {
  const { channel, applied } = makeChannel();
  const fresh = [{ guid: 'a' }];
  channel.receive(fresh, searching);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], fresh);
});

// ===== apply on idle =====

test('apply on idle — changed data, not interacting → apply called', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  const fresh = [{ guid: 'b' }];
  channel.receive(fresh, idle);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], fresh);
});

// ===== hold during interaction =====

test('hold during searching — apply not called', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  channel.receive([{ guid: 'b' }], searching);
  assert.equal(applied.length, 0);
});

test('hold during scrolled — apply not called', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  channel.receive([{ guid: 'b' }], scrolled);
  assert.equal(applied.length, 0);
});

// ===== no-op on no change =====

test('no-op when data unchanged after seed — apply not called', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  channel.receive([{ guid: 'a' }], idle);
  assert.equal(applied.length, 0);
});

test('no-op when data unchanged while interacting — nothing held either', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  channel.receive([{ guid: 'a' }], searching);
  assert.equal(applied.length, 0);
  channel.flush();
  assert.equal(applied.length, 0);
});

// ===== flush =====

test('flush after hold (searching) — held data applied', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  const fresh = [{ guid: 'b' }];
  channel.receive(fresh, searching);
  assert.equal(applied.length, 0);
  channel.flush();
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], fresh);
});

test('flush after hold (scrolled) — held data applied', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  const fresh = [{ guid: 'b' }];
  channel.receive(fresh, scrolled);
  assert.equal(applied.length, 0);
  channel.flush();
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], fresh);
});

test('flush with nothing pending — apply not called', () => {
  const { channel, applied } = makeChannel();
  channel.flush();
  assert.equal(applied.length, 0);
});

// ===== post-apply state =====

test('after apply, cached is updated — same data on next receive is no-op', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  const fresh = [{ guid: 'b' }];
  channel.receive(fresh, idle);
  assert.equal(applied.length, 1);
  channel.receive(fresh, idle);  // identical to what was just applied
  assert.equal(applied.length, 1);
});

test('after flush, pending is cleared — second flush is no-op', () => {
  const { channel, applied } = makeChannel();
  channel.seed([{ guid: 'a' }]);
  channel.receive([{ guid: 'b' }], searching);
  channel.flush();
  assert.equal(applied.length, 1);
  channel.flush();
  assert.equal(applied.length, 1);
});

// ===== essay variant (idKey = 'coordinate') =====

test('essay: hold during scrolled, then flush — apply called with held data', () => {
  const applied = [];
  const channel = createRevalidationChannel({
    apply: (data) => applied.push(data),
    idKey: 'coordinate',
  });
  const cached = [{ coordinate: '30023:a:1' }];
  const fresh  = [{ coordinate: '30023:b:2' }];
  channel.seed(cached);
  channel.receive(fresh, scrolled);
  assert.equal(applied.length, 0);
  channel.flush();
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], fresh);
});

test('essay: no-op when coordinates identical after seed', () => {
  const applied = [];
  const channel = createRevalidationChannel({
    apply: (data) => applied.push(data),
    idKey: 'coordinate',
  });
  const coord = '30023:a:1';
  channel.seed([{ coordinate: coord }]);
  channel.receive([{ coordinate: coord }], idle);
  assert.equal(applied.length, 0);
});
