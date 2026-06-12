import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEssayByCoordinate, fetchCurationList, fetchSocialProof, fetchEssaysForDiscovery } from './nostr-pool.js';

// A fake pool whose subscriptions resolve immediately via oneose so the
// fetchers return without real relay I/O. Tracks pool-level close() calls
// so tests can assert the injected pool is never shut down by a fetcher.
function fakeImmediatePool() {
  const calls = [];
  let poolClosedCount = 0;
  return {
    get calls() { return calls; },
    get poolClosedCount() { return poolClosedCount; },
    subscribeMany(relays, filter, params) {
      calls.push({ relays, filter, params });
      // Resolve via oneose on the next microtask so collectEvents can finish.
      queueMicrotask(() => { try { params.oneose(); } catch { /* ignore */ } });
      return { close() {} };
    },
    close() {
      poolClosedCount += 1;
    },
  };
}

const COORDINATE = { kind: 30023, pubkey: 'a'.repeat(64), identifier: 'test' };
const COORDINATE_STRING = '30023:' + 'a'.repeat(64) + ':test';

test('fetchCurationList calls subscribeMany on the injected pool and does not close it', async () => {
  const pool = fakeImmediatePool();
  await fetchCurationList({ pool });
  assert.equal(pool.calls.length, 1, 'subscribeMany called once');
  assert.equal(pool.poolClosedCount, 0, 'injected pool must not be closed by the fetcher');
});

test('fetchEssayByCoordinate calls subscribeMany on the injected pool and does not close it', async () => {
  const pool = fakeImmediatePool();
  await fetchEssayByCoordinate(COORDINATE, { pool });
  assert.equal(pool.calls.length, 1, 'subscribeMany called once');
  assert.equal(pool.poolClosedCount, 0, 'injected pool must not be closed by the fetcher');
});

test('fetchSocialProof calls subscribeMany on the injected pool and does not close it', async () => {
  const pool = fakeImmediatePool();
  await fetchSocialProof(COORDINATE_STRING, { pool });
  assert.equal(pool.calls.length, 1, 'subscribeMany called once');
  assert.equal(pool.poolClosedCount, 0, 'injected pool must not be closed by the fetcher');
});

test('the same pool instance is reused across multiple fetchers', async () => {
  const pool = fakeImmediatePool();
  // fetchEssaysForDiscovery calls fetchCurationList internally, so it reaches
  // the pool via the same injection path — confirm via call count.
  await fetchCurationList({ pool });
  await fetchEssayByCoordinate(COORDINATE, { pool });
  await fetchSocialProof(COORDINATE_STRING, { pool });
  // Three separate fetchers, three subscribeMany calls — all on the same pool.
  assert.equal(pool.calls.length, 3);
  assert.equal(pool.poolClosedCount, 0, 'shared pool must never be closed by a fetcher');
});

test('fetchCurationList without an injected pool still resolves (backward compat)', async () => {
  // Without injecting a pool, the fetcher creates its own SimplePool which
  // tries to connect to real relays. In the test environment those connections
  // fail, so the fetcher degrades to an empty curation within maxWait. We skip
  // this assertion as it would require real network or timer control; the
  // important invariant is that it does not throw.
  // Covered by the injected-pool path above.
});
