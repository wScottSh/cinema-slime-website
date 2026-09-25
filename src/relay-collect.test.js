import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvents } from './relay-collect.js';

// Fake pool capturing the subscribeMany callbacks so tests can drive the
// relay conversation by hand: emit events, signal EOSE, observe close.
function fakePool() {
  const calls = [];
  let closed = 0;
  return {
    calls,
    get closedCount() {
      return closed;
    },
    subscribeMany(relays, filter, params) {
      calls.push({ relays, filter, params });
      return { close: () => { closed += 1; } };
    },
  };
}

const RELAYS = ['wss://a.example', 'wss://b.example'];
const FILTER = { kinds: [30023] };

test('resolves with all events when every relay EOSEs promptly', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800 });
  const { params } = pool.calls[0];
  params.onevent({ id: 'e1' });
  params.onevent({ id: 'e2' });
  params.oneose();
  assert.deepEqual(await promise, [{ id: 'e1' }, { id: 'e2' }]);
  assert.equal(pool.closedCount, 1);
});

test('settles shortly after the stream goes quiet when a relay never EOSEs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800 });
  const { params } = pool.calls[0];
  params.onevent({ id: 'e1' });
  // No EOSE ever arrives; the settle window elapses instead of maxWait.
  t.mock.timers.tick(800);
  assert.deepEqual(await promise, [{ id: 'e1' }]);
  assert.equal(pool.closedCount, 1);
});

test('trickling events keep extending the settle window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800 });
  const { params } = pool.calls[0];
  params.onevent({ id: 'e1' });
  t.mock.timers.tick(700); // inside the settle window
  params.onevent({ id: 'e2' }); // resets it
  t.mock.timers.tick(700); // still inside the new window
  params.onevent({ id: 'e3' });
  t.mock.timers.tick(800); // quiet — now it settles
  assert.deepEqual(await promise, [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]);
});

test('resolves empty at maxWait when no relay delivers anything', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800 });
  t.mock.timers.tick(8000);
  assert.deepEqual(await promise, []);
  assert.equal(pool.closedCount, 1);
});

test('maxWait caps a stream that never goes quiet', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 2000, settleMs: 800 });
  const { params } = pool.calls[0];
  // An event every 500ms always resets the settle window; maxWait still fires.
  for (let i = 0; i < 4; i++) {
    params.onevent({ id: `e${i}` });
    t.mock.timers.tick(500);
  }
  const events = await promise;
  assert.equal(events.length, 4);
});

test('late callbacks after settling are ignored (no double resolution, no growth)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800 });
  const { params } = pool.calls[0];
  params.onevent({ id: 'e1' });
  t.mock.timers.tick(800);
  const events = await promise;
  params.onevent({ id: 'late' });
  params.oneose();
  assert.deepEqual(events, [{ id: 'e1' }]);
  assert.equal(pool.closedCount, 1);
});

test('onclose (all relays failed) resolves with whatever was collected', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800 });
  const { params } = pool.calls[0];
  params.onclose(['connection refused', 'connection refused']);
  assert.deepEqual(await promise, []);
});

test('a synchronously throwing pool still resolves (empty)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = {
    subscribeMany() {
      throw new Error('boom');
    },
  };
  const events = await collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800 });
  assert.deepEqual(events, []);
});

test('isComplete: quiet window held open while the answer is incomplete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const isComplete = (events) => events.length >= 2;
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800, isComplete });
  const { params } = pool.calls[0];
  params.onevent({ id: 'e1' });
  t.mock.timers.tick(800); // settle window fires, but isComplete says no — must not resolve
  // A promise race against a fresh microtask flush confirms it hasn't settled yet.
  let settled = false;
  promise.then(() => { settled = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, 'must not resolve while incomplete');
  assert.equal(pool.closedCount, 0);
  // A second event completes the answer; its own settle window then resolves it.
  params.onevent({ id: 'e2' });
  t.mock.timers.tick(800);
  assert.deepEqual(await promise, [{ id: 'e1' }, { id: 'e2' }]);
  assert.equal(pool.closedCount, 1);
});

test('isComplete: an incomplete answer still resolves at maxWait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const isComplete = () => false; // never satisfied
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800, isComplete });
  const { params } = pool.calls[0];
  params.onevent({ id: 'e1' });
  t.mock.timers.tick(800); // settle fires but isComplete refuses — stays open
  t.mock.timers.tick(7200); // remaining time to maxWait
  assert.deepEqual(await promise, [{ id: 'e1' }]);
  assert.equal(pool.closedCount, 1);
});

test('isComplete: an incomplete answer still resolves when every relay EOSEs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const isComplete = () => false; // never satisfied
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 8000, settleMs: 800, isComplete });
  const { params } = pool.calls[0];
  params.onevent({ id: 'e1' });
  t.mock.timers.tick(800); // settle fires but isComplete refuses — stays open
  params.oneose(); // every relay finished — ends collection regardless of isComplete
  assert.deepEqual(await promise, [{ id: 'e1' }]);
  assert.equal(pool.closedCount, 1);
});

test('passes relays, filter and maxWait through to the pool subscription', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pool = fakePool();
  const promise = collectEvents(pool, RELAYS, FILTER, { maxWait: 6000, settleMs: 800 });
  const call = pool.calls[0];
  assert.deepEqual(call.relays, RELAYS);
  assert.deepEqual(call.filter, FILTER);
  assert.equal(call.params.maxWait, 6000);
  call.params.oneose();
  await promise;
});
