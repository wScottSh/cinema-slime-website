import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidSlug, pickSlug } from './essay-slug.js';

test('isValidSlug accepts well-formed slugs', () => {
  assert.equal(isValidSlug('first'), true);
  assert.equal(isValidSlug('hello-world'), true);
  assert.equal(isValidSlug('abc123'), true);
  assert.equal(isValidSlug('a-b-c'), true);
  assert.equal(isValidSlug('1st'), true);
});

test('isValidSlug rejects uppercase letters', () => {
  assert.equal(isValidSlug('First'), false);
  assert.equal(isValidSlug('HELLO'), false);
  assert.equal(isValidSlug('hEllo'), false);
});

test('isValidSlug rejects spaces', () => {
  assert.equal(isValidSlug('hello world'), false);
  assert.equal(isValidSlug(' first'), false);
  assert.equal(isValidSlug('first '), false);
});

test('isValidSlug rejects leading or trailing hyphens', () => {
  assert.equal(isValidSlug('-first'), false);
  assert.equal(isValidSlug('first-'), false);
});

test('isValidSlug rejects double hyphens', () => {
  assert.equal(isValidSlug('hello--world'), false);
});

test('isValidSlug rejects colons (can never be parsed as a coordinate)', () => {
  assert.equal(isValidSlug('30023:abc:slug'), false);
  assert.equal(isValidSlug('with:colon'), false);
});

test('isValidSlug rejects empty string', () => {
  assert.equal(isValidSlug(''), false);
});

test('isValidSlug rejects non-string inputs', () => {
  assert.equal(isValidSlug(null), false);
  assert.equal(isValidSlug(undefined), false);
  assert.equal(isValidSlug(42), false);
});

// Every historical Official Essay title, what pickSlug proposes, and what the
// operator actually chose. Changing the rule shows exactly which past choices
// it flips. Six disagree today; each is pinned on purpose.
const HISTORY = [
  ['Cats Eyes - Absolute Batman #3 (Spoilers)', 'absolute-batman-3', 'absolute-batman-3'],
  ['Needle in the Eye - Spider-Man Noir S1E7 (Spoilers)', 'needle-in-the-eye', 'needle-in-the-eye'],
  ['Birth Date - Midnight Spider-Man #1 (Spoilers)', 'midnight-spider-man', 'midnight-spider-man'],
  ['The Mirror - Spider-Man Noir S1E8 (Spoilers)', 'the-mirror', 'the-mirror'],
  ['Nightmare on a Gurney - S1E6 Spider-Man Noir', 'nightmare-on-a-gurney', 'nightmare-on-a-gurney'],
  ['Betrayal - S1E5 Spider-Man Noir', 'betrayal', 'betrayal'],
  ['Along Went the Spider: A Hero Walks Away - Spider-Man Noir S1E1', 'along-went-the-spider', 'along-went-the-spider'],
  ['Open Air - Spider-Man Noir S1E4', 'open-air', 'open-air'],
  ['Following the Threads - Spider-Man Noir S1E3', 'following-the-threads', 'following-the-threads'],
  ['Bats are CRAZY - Absolute Batman #1 (Spoilers)', 'absolute-batman', 'absolute-batman'],
  ['Feeling Alive 2007: A Daft Punk Odyssey', 'feeling-alive-2007', 'feeling-alive-2007'],
  ['Skull In The Pot - Absolute Batman #2 (Spoilers)', 'absolute-batman-2', 'cat-eyes'],
  ['Cash Is Fine... Or Vodka - Valhallaw #1', 'valhallaw', 'valhallaw-1'],
  [' The Tangled Web - Spider-Man Noir S1E2', 'the-tangled-web', 'tangled-web'],
  ['Curiosity & Recklessness - Web of Blood #1 (Spoilers)', 'web-of-blood', 'curiosity-and-recklessness'],
  ['The Empty City - The Cimmerian: Xuthal of the Dusk #1 (Spoilers)', 'the-cimmerian', 'the-empty-city'],
  ['My Own Private Idaho x 1991', 'my-own-private-idaho-x-1991', 'my-own-private-idaho'],
];

test('pickSlug proposes the pinned slug for every historical title', () => {
  for (const [title, picked] of HISTORY) {
    assert.equal(pickSlug(title, new Set()), picked, title);
  }
});

test('pickSlug agrees with the operator on 11 of the 17 historical titles', () => {
  const agreed = HISTORY.filter(([title, , chosen]) => pickSlug(title, new Set()) === chosen);
  assert.equal(agreed.length, 11);
});

test('pickSlug never returns a taken slug; it suffixes -2, -3, ...', () => {
  const title = 'Birth Date - Midnight Spider-Man #1 (Spoilers)';
  assert.equal(pickSlug(title, new Set(['midnight-spider-man'])), 'midnight-spider-man-2');
  assert.equal(pickSlug(title, new Set(['midnight-spider-man', 'midnight-spider-man-2'])), 'midnight-spider-man-3');
});

test('pickSlug falls back when the title yields no slug', () => {
  assert.equal(pickSlug('', new Set(), 'S03S87cLqOlX6ucZriwM6'), 's03s87clqolx6uczriwm6');
  assert.equal(pickSlug('!!!', new Set()), 'essay');
});

test('pickSlug output is always a valid slug', () => {
  for (const [title] of HISTORY) assert.equal(isValidSlug(pickSlug(title, new Set())), true);
});
