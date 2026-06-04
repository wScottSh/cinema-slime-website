import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildEpisodeHash, buildEssayHash } from './router.js';

const PUBKEY = 'a'.repeat(64);

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

test('parseHash parses an essay route and decodes the coordinate', () => {
  const coord = `30023:${PUBKEY}:my-essay`;
  const result = parseHash(`#/essay/${encodeURIComponent(coord)}`);
  assert.equal(result.type, 'essay');
  assert.equal(result.coordinate, coord);
});

test('parseHash keeps essay and episode routes distinct', () => {
  assert.equal(parseHash(`#/episode/some-guid`).type, 'episode');
  assert.equal(parseHash(`#/essay/30023:${PUBKEY}:x`).type, 'essay');
});

test('buildEssayHash → parseHash round-trips a coordinate with colons in the identifier', () => {
  const coord = `30023:${PUBKEY}:2026:slimiest-scenes`;
  const result = parseHash(buildEssayHash(coord));
  assert.equal(result.type, 'essay');
  assert.equal(result.coordinate, coord);
});

test('buildEssayHash returns # for falsy', () => {
  assert.equal(buildEssayHash(''), '#');
  assert.equal(buildEssayHash(null), '#');
});

test('parseHash returns slug for essay route when token is not a coordinate', () => {
  const result = parseHash('#/essay/first');
  assert.equal(result.type, 'essay');
  assert.equal(result.slug, 'first');
  assert.equal(result.coordinate, undefined);
});

test('parseHash returns coordinate for essay route when token is a well-formed coordinate', () => {
  const coord = `30023:${PUBKEY}:my-essay`;
  const result = parseHash(`#/essay/${encodeURIComponent(coord)}`);
  assert.equal(result.type, 'essay');
  assert.equal(result.coordinate, coord);
  assert.equal(result.slug, undefined);
});

test('parseHash treats an unknown non-coordinate token as a slug', () => {
  const result = parseHash('#/essay/unknown-slug-xyz');
  assert.equal(result.type, 'essay');
  assert.equal(result.slug, 'unknown-slug-xyz');
  assert.equal(result.coordinate, undefined);
});
