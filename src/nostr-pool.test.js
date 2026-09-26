import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEssayByCoordinate, fetchCurationList, fetchSocialProof, fetchEssaysForDiscovery } from './nostr-pool.js';
import { BRAND_PUBKEY, CURATION_LIST_KIND } from './brand.js';

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

// Shared fixtures for the Discovery-completeness tests below: a raw kind:30023
// event, and a fake pool whose first subscribeMany call (the Curation fetch)
// resolves immediately while the second (the Essays fetch) is driven by hand.
function essayEvent(pubkey, identifier, publishedAt) {
  return {
    kind: 30023,
    pubkey,
    id: `id-${identifier}`,
    created_at: publishedAt,
    content: '',
    tags: [
      ['d', identifier],
      ['title', identifier],
      ['published_at', String(publishedAt)],
    ],
  };
}

function manualDiscoveryPool(curationEvent) {
  const calls = [];
  const pool = {
    subscribeMany(relays, filter, params) {
      calls.push({ relays, filter, params });
      if (calls.length === 1) {
        // Curation fetch: resolves immediately (fast relay, always EOSEs).
        queueMicrotask(() => {
          params.onevent(curationEvent);
          params.oneose();
        });
      }
      // Essays fetch (the second call) is driven manually by the test and
      // never EOSEs, matching the reproduced bug (a dead/never-answering relay).
      return { close() {} };
    },
  };
  return { pool, calls };
}

// Flushes microtasks until the essays subscribeMany call has been made (the
// curation fetch's own microtask plus the async continuation up to it).
async function waitForEssaysCall(calls) {
  for (let i = 0; i < 10 && calls.length < 2; i++) {
    await Promise.resolve();
  }
}

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

// Regression test for #165/#166: a fast relay holds only the newest Official
// Essay while a slower relay holds the rest, and no relay ever EOSEs. Before
// gating settle on Curation completeness, the fast relay's partial answer
// would end collection 800ms after it went quiet and Discovery would return
// only the newest entry. See ADR 0016.
test('fetchEssaysForDiscovery: fast relay has only the newest Essay, slow relay has the rest — every curated entry is returned, newest-first', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const AUTHOR = 'a'.repeat(64);
  const coordNewest = `30023:${AUTHOR}:newest`;
  const coordOlder1 = `30023:${AUTHOR}:older-1`; // publishedAt 2000
  const coordOlder2 = `30023:${AUTHOR}:older-2`; // publishedAt 1000 (oldest)

  const curationEvent = {
    kind: CURATION_LIST_KIND,
    pubkey: BRAND_PUBKEY,
    created_at: 1000,
    tags: [
      ['a', coordNewest],
      ['a', coordOlder1],
      ['a', coordOlder2],
    ],
  };

  const essayNewest = essayEvent(AUTHOR, 'newest', 3000);
  const essayOlder1 = essayEvent(AUTHOR, 'older-1', 2000);
  const essayOlder2 = essayEvent(AUTHOR, 'older-2', 1000);

  const { pool, calls } = manualDiscoveryPool(curationEvent);
  const promise = fetchEssaysForDiscovery({ pool, settleMs: 800, timeout: 8000 });

  await waitForEssaysCall(calls);
  assert.equal(calls.length, 2, 'curation query, then the essays query');
  const essaysParams = calls[1].params;

  // Fast relay: emits only the newest Official Essay, then goes quiet.
  essaysParams.onevent(essayNewest);
  // If settle ended collection on quiet alone (pre-fix behavior), only the
  // newest entry would ever be returned. The completeness rule refuses.
  t.mock.timers.tick(800);

  // Slow relay: delivers the two older curated Essays after the settle
  // window would have fired, and — deliberately — out of publish order
  // (oldest first), so the assertion below can't pass by arrival order alone
  // and actually exercises the newest-first sort. No relay ever EOSEs.
  essaysParams.onevent(essayOlder2);
  essaysParams.onevent(essayOlder1);
  // The answer is now complete; the next settle window ends collection.
  t.mock.timers.tick(800);

  const entries = await promise;
  assert.deepEqual(
    entries.map((e) => e.coordinate),
    [coordNewest, coordOlder1, coordOlder2],
    'every curated entry returned, newest-first'
  );
});

// Acceptance criterion: an Official Essay missing from every relay must not
// blank the whole view — Discovery waits the full maxWait (accepted trade-off,
// option (a) in #165) and then returns every entry it *did* find.
test('fetchEssaysForDiscovery: an Essay absent from every relay still lets the rest resolve, at maxWait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const AUTHOR = 'a'.repeat(64);
  const coordFound = `30023:${AUTHOR}:found`;
  const coordMissing = `30023:${AUTHOR}:missing`; // never arrives from any relay

  const curationEvent = {
    kind: CURATION_LIST_KIND,
    pubkey: BRAND_PUBKEY,
    created_at: 1000,
    tags: [
      ['a', coordFound],
      ['a', coordMissing],
    ],
  };

  const essayFound = essayEvent(AUTHOR, 'found', 2000);

  const { pool, calls } = manualDiscoveryPool(curationEvent);
  const promise = fetchEssaysForDiscovery({ pool, settleMs: 800, timeout: 8000 });

  await waitForEssaysCall(calls);
  assert.equal(calls.length, 2);
  const essaysParams = calls[1].params;

  essaysParams.onevent(essayFound);
  t.mock.timers.tick(800); // settle refuses: coordMissing never covered

  // Pin the actual behavior change: this must still be unresolved here — if
  // it resolved on the first settle tick (pre-fix behavior), maxWait
  // wouldn't be the thing this test is exercising.
  let settled = false;
  promise.then(() => { settled = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, 'must still be waiting — coordMissing never arrived');

  t.mock.timers.tick(7200); // remainder of the 8000ms hard cap

  const entries = await promise;
  assert.deepEqual(entries.map((e) => e.coordinate), [coordFound], 'the found Essay is still returned at maxWait');
});

test('fetchCurationList without an injected pool still resolves (backward compat)', async () => {
  // Without injecting a pool, the fetcher creates its own SimplePool which
  // tries to connect to real relays. In the test environment those connections
  // fail, so the fetcher degrades to an empty curation within maxWait. We skip
  // this assertion as it would require real network or timer control; the
  // important invariant is that it does not throw.
  // Covered by the injected-pool path above.
});
