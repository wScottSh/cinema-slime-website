import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEpisodes } from './episode-filter.js';

const make = (overrides = {}) => ({
  guid: 'ep-1',
  episodeType: 'full',
  title: 'Test Episode',
  description: 'A description',
  ...overrides,
});

test('type=all returns full list', () => {
  const list = [
    make({ guid: '1', episodeType: 'full' }),
    make({ guid: '2', episodeType: 'bonus' }),
    make({ guid: '3', episodeType: 'trailer' }),
  ];
  assert.equal(filterEpisodes(list, 'all', '').length, 3);
});

test('type=full returns only full episodes', () => {
  const list = [
    make({ guid: '1', episodeType: 'full' }),
    make({ guid: '2', episodeType: 'bonus' }),
    make({ guid: '3', episodeType: 'full' }),
  ];
  const result = filterEpisodes(list, 'full', '');
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(e => e.guid), ['1', '3']);
});

test('type=bonus returns only bonus episodes', () => {
  const list = [
    make({ guid: '1', episodeType: 'full' }),
    make({ guid: '2', episodeType: 'bonus' }),
    make({ guid: '3', episodeType: 'bonus' }),
  ];
  const result = filterEpisodes(list, 'bonus', '');
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(e => e.guid), ['2', '3']);
});

test('type=trailer returns only trailer episodes', () => {
  const list = [
    make({ guid: '1', episodeType: 'trailer' }),
    make({ guid: '2', episodeType: 'full' }),
  ];
  const result = filterEpisodes(list, 'trailer', '');
  assert.equal(result.length, 1);
  assert.equal(result[0].guid, '1');
});

test('query matches by title (case-insensitive)', () => {
  const list = [
    make({ guid: '1', title: 'Horror Movie Review', description: '' }),
    make({ guid: '2', title: 'Comedy Film', description: '' }),
  ];
  const result = filterEpisodes(list, 'all', 'horror');
  assert.equal(result.length, 1);
  assert.equal(result[0].guid, '1');
});

test('query matches by description (case-insensitive)', () => {
  const list = [
    make({ guid: '1', title: 'Ep 1', description: 'Slasher film deep dive' }),
    make({ guid: '2', title: 'Ep 2', description: 'Comedy discussion' }),
  ];
  const result = filterEpisodes(list, 'all', 'SLASHER');
  assert.equal(result.length, 1);
  assert.equal(result[0].guid, '1');
});

test('type + query combined: both constraints apply', () => {
  const list = [
    make({ guid: '1', episodeType: 'full', title: 'Horror Film', description: '' }),
    make({ guid: '2', episodeType: 'bonus', title: 'Horror Bonus', description: '' }),
    make({ guid: '3', episodeType: 'full', title: 'Comedy Film', description: '' }),
  ];
  const result = filterEpisodes(list, 'full', 'horror');
  assert.equal(result.length, 1);
  assert.equal(result[0].guid, '1');
});

test('empty query returns all items regardless of type filter', () => {
  const list = [make({ guid: '1' }), make({ guid: '2' })];
  assert.equal(filterEpisodes(list, 'all', '').length, 2);
});

test('empty list returns empty list', () => {
  assert.deepEqual(filterEpisodes([], 'all', ''), []);
});

test('preserves item identity (no copying)', () => {
  const ep = make({ guid: '1' });
  const result = filterEpisodes([ep], 'all', '');
  assert.equal(result[0], ep);
});
