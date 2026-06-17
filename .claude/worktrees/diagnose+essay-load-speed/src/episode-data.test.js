import test from 'node:test';
import assert from 'node:assert/strict';
import { getEpisodeByIdentifier } from './episode-data.js';

const sampleEpisodes = [
  {
    guid: 'c363d1f1-832e-4add-9dcb-1f51225d0338',
    title: 'The Matrix (1999)',
    episodeType: 'full',
    episode: '1'
  },
  {
    guid: '1cf638d6-aeac-4288-9b72-2757ee2e5ea0',
    title: 'Bonus: Behind the Slime',
    episodeType: 'bonus'
  },
  {
    guid: 'b25aff3c-8609-4ad3-ad84-a72a142d5837',
    title: 'Trailer for Next Month',
    episodeType: 'trailer'
  }
];

test('getEpisodeByIdentifier finds episode by exact guid', () => {
  const result = getEpisodeByIdentifier('c363d1f1-832e-4add-9dcb-1f51225d0338', sampleEpisodes);
  assert.equal(result, sampleEpisodes[0]);
  assert.equal(result.title, 'The Matrix (1999)');
});

test('getEpisodeByIdentifier returns null for unknown identifier', () => {
  const result = getEpisodeByIdentifier('00000000-0000-0000-0000-000000000000', sampleEpisodes);
  assert.equal(result, null);
});

test('getEpisodeByIdentifier returns null for null/undefined/empty identifier', () => {
  assert.equal(getEpisodeByIdentifier(null, sampleEpisodes), null);
  assert.equal(getEpisodeByIdentifier(undefined, sampleEpisodes), null);
  assert.equal(getEpisodeByIdentifier('', sampleEpisodes), null);
  assert.equal(getEpisodeByIdentifier('   ', sampleEpisodes), null);
});

test('getEpisodeByIdentifier returns null for non-string identifier', () => {
  assert.equal(getEpisodeByIdentifier(123, sampleEpisodes), null);
  assert.equal(getEpisodeByIdentifier({}, sampleEpisodes), null);
  assert.equal(getEpisodeByIdentifier([], sampleEpisodes), null);
});

test('getEpisodeByIdentifier returns null for non-array episodes', () => {
  assert.equal(getEpisodeByIdentifier('c363d1f1-832e-4add-9dcb-1f51225d0338', null), null);
  assert.equal(getEpisodeByIdentifier('c363d1f1-832e-4add-9dcb-1f51225d0338', undefined), null);
  assert.equal(getEpisodeByIdentifier('c363d1f1-832e-4add-9dcb-1f51225d0338', {}), null);
  assert.equal(getEpisodeByIdentifier('c363d1f1-832e-4add-9dcb-1f51225d0338', 'not an array'), null);
});

test('getEpisodeByIdentifier trims whitespace on input identifier', () => {
  const result = getEpisodeByIdentifier('  c363d1f1-832e-4add-9dcb-1f51225d0338  ', sampleEpisodes);
  assert.equal(result, sampleEpisodes[0]);
});

test('getEpisodeByIdentifier works with filtered subset of episodes', () => {
  const bonuses = sampleEpisodes.filter(e => e.episodeType === 'bonus');
  const result = getEpisodeByIdentifier('1cf638d6-aeac-4288-9b72-2757ee2e5ea0', bonuses);
  assert.equal(result, bonuses[0]);
  assert.equal(result.episodeType, 'bonus');
});

test('getEpisodeByIdentifier is case sensitive (UUIDs are)', () => {
  const upper = getEpisodeByIdentifier('C363D1F1-832E-4ADD-9DCB-1F51225D0338', sampleEpisodes);
  assert.equal(upper, null);
});

test('getEpisodeByIdentifier returns the original episode object (stable reference)', () => {
  const ep = sampleEpisodes[1];
  const result = getEpisodeByIdentifier(ep.guid, sampleEpisodes);
  assert.equal(result, ep); // same reference
});
