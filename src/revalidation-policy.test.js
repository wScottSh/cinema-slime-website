import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyFreshData, decideEssayPageRevalidation } from './revalidation-policy.js';

const idle = { searching: false, scrolled: false };

test('identical guids → hold with reason no-change', () => {
  const cached = [{ guid: 'a' }, { guid: 'b' }];
  const fresh  = [{ guid: 'a' }, { guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'no-change');
});

test('changed guids + idle → apply', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'apply');
});

test('changed guids + searching → hold with reason interacting', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: true, scrolled: false } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('changed guids + scrolled → hold with reason interacting', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: false, scrolled: true } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('changed guids + searching and scrolled → hold with reason interacting', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: true, scrolled: true } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('undefined cached (cold load) → apply regardless of interacting state', () => {
  const fresh = [{ guid: 'a' }];
  const result = shouldApplyFreshData({ cached: undefined, fresh, interacting: { searching: true, scrolled: true } });
  assert.equal(result.decision, 'apply');
});

test('different guid count → changed → apply when idle', () => {
  const cached = [{ guid: 'a' }, { guid: 'b' }];
  const fresh  = [{ guid: 'a' }, { guid: 'b' }, { guid: 'c' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'apply');
});

test('different guid count + searching → hold', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'a' }, { guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: true, scrolled: false } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('empty cached array + non-empty fresh + idle → apply', () => {
  const cached = [];
  const fresh  = [{ guid: 'a' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'apply');
});

// Essay-specific: idKey = 'coordinate'

test('essay: identical coordinates → hold with reason no-change', () => {
  const cached = [{ coordinate: '30023:pubkey1:id1' }, { coordinate: '30023:pubkey2:id2' }];
  const fresh  = [{ coordinate: '30023:pubkey1:id1' }, { coordinate: '30023:pubkey2:id2' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle, idKey: 'coordinate' });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'no-change');
});

test('essay: new coordinate + idle → apply', () => {
  const cached = [{ coordinate: '30023:pubkey1:id1' }];
  const fresh  = [{ coordinate: '30023:pubkey1:id1' }, { coordinate: '30023:pubkey2:id2' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle, idKey: 'coordinate' });
  assert.equal(result.decision, 'apply');
});

test('essay: new coordinate + scrolled into essays → hold with reason interacting', () => {
  const cached = [{ coordinate: '30023:pubkey1:id1' }];
  const fresh  = [{ coordinate: '30023:pubkey1:id1' }, { coordinate: '30023:pubkey2:id2' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: false, scrolled: true }, idKey: 'coordinate' });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('essay: undefined cached (cold load) → apply', () => {
  const fresh = [{ coordinate: '30023:pubkey1:id1' }];
  const result = shouldApplyFreshData({ cached: undefined, fresh, interacting: { searching: false, scrolled: true }, idKey: 'coordinate' });
  assert.equal(result.decision, 'apply');
});

test('essay: empty cached + fresh entries + idle → apply', () => {
  const cached = [];
  const fresh  = [{ coordinate: '30023:pubkey1:id1' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle, idKey: 'coordinate' });
  assert.equal(result.decision, 'apply');
});

test('essay: coordinate replaced (same count, different value) + idle → apply', () => {
  const cached = [{ coordinate: '30023:pubkey1:id1' }];
  const fresh  = [{ coordinate: '30023:pubkey2:id2' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle, idKey: 'coordinate' });
  assert.equal(result.decision, 'apply');
});

test('essay: coordinate removed (fewer in fresh) + idle → apply', () => {
  const cached = [{ coordinate: '30023:pubkey1:id1' }, { coordinate: '30023:pubkey2:id2' }];
  const fresh  = [{ coordinate: '30023:pubkey1:id1' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle, idKey: 'coordinate' });
  assert.equal(result.decision, 'apply');
});

// Essay Page SWR revalidation (cached copy may already be on screen)

test('essay page: no cached copy + official fresh essay → render-fresh', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: null, freshEventId: 'ev1', isOfficial: true,
    essayFetched: true, curationSize: 3, socialProofChanged: false,
  });
  assert.equal(result, 'render-fresh');
});

test('essay page: no cached copy + nothing official → not-found', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: null, freshEventId: null, isOfficial: false,
    essayFetched: false, curationSize: 0, socialProofChanged: false,
  });
  assert.equal(result, 'not-found');
});

test('essay page: cached copy + identical fresh event + no social proof → keep-current', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: 'ev1', freshEventId: 'ev1', isOfficial: true,
    essayFetched: true, curationSize: 3, socialProofChanged: false,
  });
  assert.equal(result, 'keep-current');
});

test('essay page: cached copy + edited essay (new event id) → render-fresh', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: 'ev1', freshEventId: 'ev2', isOfficial: true,
    essayFetched: true, curationSize: 3, socialProofChanged: false,
  });
  assert.equal(result, 'render-fresh');
});

test('essay page: cached copy + identical event but social proof arrived → render-fresh', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: 'ev1', freshEventId: 'ev1', isOfficial: true,
    essayFetched: true, curationSize: 3, socialProofChanged: true,
  });
  assert.equal(result, 'render-fresh');
});

test('essay page: cached copy + essay fetched but excluded from a non-empty curation (decurated) → not-found', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: 'ev1', freshEventId: null, isOfficial: false,
    essayFetched: true, curationSize: 3, socialProofChanged: false,
  });
  assert.equal(result, 'not-found');
});

test('essay page: cached copy + essay fetched but empty curation (relay failure, fail-closed) → keep-current', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: 'ev1', freshEventId: null, isOfficial: false,
    essayFetched: true, curationSize: 0, socialProofChanged: false,
  });
  assert.equal(result, 'keep-current');
});

test('essay page: cached copy + essay fetch failed entirely → keep-current', () => {
  const result = decideEssayPageRevalidation({
    cachedEventId: 'ev1', freshEventId: null, isOfficial: false,
    essayFetched: false, curationSize: 3, socialProofChanged: false,
  });
  assert.equal(result, 'keep-current');
});
