import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildEpisodeHash } from './router.js';

test('parseHash returns home for empty, #, #/', () => {
  assert.deepEqual(parseHash(''), { type: 'home' });
  assert.deepEqual(parseHash('#'), { type: 'home' });
  assert.deepEqual(parseHash('#/'), { type: 'home' });
  assert.deepEqual(parseHash(undefined), { type: 'home' });
});

test('parseHash parses episode route with guid', () => {
  const result = parseHash('#/episode/c363d1f1-832e-4add-9dcb-1f51225d0338');
  assert.equal(result.type, 'episode');
  assert.equal(result.guid, 'c363d1f1-832e-4add-9dcb-1f51225d0338');
});

test('parseHash decodes encoded guid', () => {
  const encoded = encodeURIComponent('guid-with/slash?and=stuff');
  const result = parseHash(`#/episode/${encoded}`);
  assert.equal(result.type, 'episode');
  assert.equal(result.guid, 'guid-with/slash?and=stuff');
});

test('parseHash returns home for non-episode hashes', () => {
  assert.deepEqual(parseHash('#episodes'), { type: 'home' });
  assert.deepEqual(parseHash('#about'), { type: 'home' });
  assert.deepEqual(parseHash('#/foo/bar'), { type: 'home' });
});

test('buildEpisodeHash builds correct hash', () => {
  const h = buildEpisodeHash('c363d1f1-832e-4add-9dcb-1f51225d0338');
  assert.equal(h, '#/episode/c363d1f1-832e-4add-9dcb-1f51225d0338');
});

test('buildEpisodeHash encodes special chars', () => {
  const h = buildEpisodeHash('guid with space');
  assert.equal(h, '#/episode/guid%20with%20space');
});

test('buildEpisodeHash returns # for falsy', () => {
  assert.equal(buildEpisodeHash(''), '#');
  assert.equal(buildEpisodeHash(null), '#');
});
