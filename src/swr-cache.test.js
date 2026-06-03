import test from 'node:test';
import assert from 'node:assert/strict';
import { createSWRCache } from './swr-cache.js';

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, val),
  };
}

test('read returns null for an absent key', () => {
  const cache = createSWRCache(fakeStorage(), 'v1');
  assert.equal(cache.read('missing'), null);
});

test('write then read returns the stored value', () => {
  const cache = createSWRCache(fakeStorage(), 'v1');
  cache.write('episodes', [{ title: 'The Matrix', guid: 'abc-123' }]);
  assert.deepEqual(cache.read('episodes'), [{ title: 'The Matrix', guid: 'abc-123' }]);
});

test('write then read round-trips a complex nested object', () => {
  const cache = createSWRCache(fakeStorage(), 'v1');
  const data = { count: 3, items: [{ id: 1 }, { id: 2 }], meta: { fetched: true } };
  cache.write('complex', data);
  assert.deepEqual(cache.read('complex'), data);
});

test('read returns null when stored version does not match', () => {
  const storage = fakeStorage();
  const writer = createSWRCache(storage, 'v1');
  writer.write('episodes', [{ title: 'Old data' }]);
  const reader = createSWRCache(storage, 'v2');
  assert.equal(reader.read('episodes'), null);
});

test('read returns null for a corrupt (non-JSON) entry', () => {
  const storage = fakeStorage();
  storage.setItem('episodes', '{not valid json!!!}');
  const cache = createSWRCache(storage, 'v1');
  assert.equal(cache.read('episodes'), null);
});

test('read returns null for a JSON entry with no version field', () => {
  const storage = fakeStorage();
  storage.setItem('episodes', JSON.stringify({ data: [1, 2, 3] }));
  const cache = createSWRCache(storage, 'v1');
  assert.equal(cache.read('episodes'), null);
});

test('read returns null for a JSON entry with wrong version field', () => {
  const storage = fakeStorage();
  storage.setItem('episodes', JSON.stringify({ v: 'old', data: [1, 2, 3] }));
  const cache = createSWRCache(storage, 'v1');
  assert.equal(cache.read('episodes'), null);
});

test('write silently ignores a storage write failure', () => {
  const brokenStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  const cache = createSWRCache(brokenStorage, 'v1');
  assert.doesNotThrow(() => cache.write('key', 'value'));
});

test('multiple keys are stored independently', () => {
  const cache = createSWRCache(fakeStorage(), 'v1');
  cache.write('a', 'alpha');
  cache.write('b', 'beta');
  assert.equal(cache.read('a'), 'alpha');
  assert.equal(cache.read('b'), 'beta');
});

test('write overwrites a previous value for the same key', () => {
  const cache = createSWRCache(fakeStorage(), 'v1');
  cache.write('key', 'first');
  cache.write('key', 'second');
  assert.equal(cache.read('key'), 'second');
});
