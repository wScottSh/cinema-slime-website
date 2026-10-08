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

// Every historical Official Essay title and its standard slug (ADR 0022).
// Changing the rule shows exactly which of these it flips.
const GOLDEN = [
  ['Feeling Alive 2007: A Daft Punk Odyssey', 'feeling-alive-2007'],
  ['Along Went the Spider: A Hero Walks Away - Spider-Man Noir S1E1', 'spider-man-noir-s1e1'],
  [' The Tangled Web - Spider-Man Noir S1E2', 'spider-man-noir-s1e2'],
  ['Following the Threads - Spider-Man Noir S1E3', 'spider-man-noir-s1e3'],
  ['My Own Private Idaho x 1991', 'my-own-private-idaho-1991'],
  ['Open Air - Spider-Man Noir S1E4', 'spider-man-noir-s1e4'],
  ['Cash Is Fine... Or Vodka - Valhallaw #1', 'valhallaw-1'],
  ['Curiosity & Recklessness - Web of Blood #1 (Spoilers)', 'web-of-blood-1'],
  ['Betrayal - S1E5 Spider-Man Noir', 'spider-man-noir-s1e5'],
  ['The Empty City - The Cimmerian: Xuthal of the Dusk #1 (Spoilers)', 'the-cimmerian-1'],
  ['Nightmare on a Gurney - S1E6 Spider-Man Noir', 'spider-man-noir-s1e6'],
  ['Bats are CRAZY - Absolute Batman #1 (Spoilers)', 'absolute-batman-1'],
  ['Skull In The Pot - Absolute Batman #2 (Spoilers)', 'absolute-batman-2'],
  ['Needle in the Eye - Spider-Man Noir S1E7 (Spoilers)', 'spider-man-noir-s1e7'],
  ['Cats Eyes - Absolute Batman #3 (Spoilers)', 'absolute-batman-3'],
  ['The Mirror - Spider-Man Noir S1E8 (Spoilers)', 'spider-man-noir-s1e8'],
  ['Birth Date - Midnight Spider-Man #1 (Spoilers)', 'midnight-spider-man-1'],
];

test('pickSlug gives every historical title its standard slug', () => {
  for (const [title, slug] of GOLDEN) assert.equal(pickSlug(title, new Set()), slug, title);
});

test('pickSlug keeps every number, finds the marker in any part, and names a standalone piece by itself', () => {
  assert.equal(pickSlug('Endgame - Spider-Man Noir S1E10', new Set()), 'spider-man-noir-s1e10');
  assert.equal(pickSlug('Late Run - Absolute Batman #12 (spoilers)', new Set()), 'absolute-batman-12');
  assert.equal(pickSlug('S2E3 Daredevil - Born Again', new Set()), 'daredevil-s2e3');
  assert.equal(pickSlug('Heat', new Set()), 'heat');
  assert.equal(pickSlug('Blade Runner x 1982 - A Retrospective', new Set()), 'blade-runner-1982');
  assert.equal(pickSlug('Malcolm X', new Set()), 'malcolm-x');
  assert.equal(pickSlug('#4', new Set()), '4');
});

test('pickSlug never returns a taken slug; it suffixes -2, -3, ...', () => {
  const title = 'Birth Date - Midnight Spider-Man #1 (Spoilers)';
  assert.equal(pickSlug(title, new Set(['midnight-spider-man-1'])), 'midnight-spider-man-1-2');
  assert.equal(pickSlug(title, new Set(['midnight-spider-man-1', 'midnight-spider-man-1-2'])), 'midnight-spider-man-1-3');
});

test('pickSlug falls back when the title yields no slug', () => {
  assert.equal(pickSlug('', new Set(), 'S03S87cLqOlX6ucZriwM6'), 's03s87clqolx6uczriwm6');
  assert.equal(pickSlug('!!!', new Set()), 'essay');
});

test('pickSlug output is always a valid slug', () => {
  for (const [title] of GOLDEN) assert.equal(isValidSlug(pickSlug(title, new Set())), true);
});
