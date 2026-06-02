import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSocialProof } from './essay-social-proof.js';

const PUBKEY = 'a'.repeat(64);
const COORDINATE = `30023:${PUBKEY}:my-essay`;

test('aggregateSocialProof returns zero counts when given no events', () => {
  const result = aggregateSocialProof(COORDINATE, []);
  assert.deepEqual(result, { totalSats: 0, largestZap: 0, heartCount: 0 });
});

const makeZap = (amountMsats, coordinate = COORDINATE) => ({
  kind: 9735,
  tags: [['a', coordinate], ['amount', String(amountMsats)]],
});

test('aggregateSocialProof counts a single matching zap receipt (msats → sats)', () => {
  const result = aggregateSocialProof(COORDINATE, [makeZap(21000)]);
  assert.deepEqual(result, { totalSats: 21, largestZap: 21, heartCount: 0 });
});

test('aggregateSocialProof sums multiple zaps and tracks the largest', () => {
  const events = [makeZap(10000), makeZap(50000), makeZap(5000)];
  const result = aggregateSocialProof(COORDINATE, events);
  assert.deepEqual(result, { totalSats: 65, largestZap: 50, heartCount: 0 });
});

test('aggregateSocialProof ignores malformed zap receipts', () => {
  const noAmount = { kind: 9735, tags: [['a', COORDINATE]] };
  const nanAmount = { kind: 9735, tags: [['a', COORDINATE], ['amount', 'not-a-number']] };
  const negativeAmount = { kind: 9735, tags: [['a', COORDINATE], ['amount', '-5000']] };
  const noATag = { kind: 9735, tags: [['amount', '21000']] };
  const nullEvent = null;
  const result = aggregateSocialProof(COORDINATE, [noAmount, nanAmount, negativeAmount, noATag, nullEvent, makeZap(1000)]);
  assert.deepEqual(result, { totalSats: 1, largestZap: 1, heartCount: 0 });
});

test('aggregateSocialProof ignores zaps for a different coordinate', () => {
  const OTHER = `30023:${'b'.repeat(64)}:other-essay`;
  const result = aggregateSocialProof(COORDINATE, [makeZap(100000, OTHER), makeZap(21000)]);
  assert.deepEqual(result, { totalSats: 21, largestZap: 21, heartCount: 0 });
});

const makeReaction = (coordinate = COORDINATE) => ({
  kind: 7,
  content: '+',
  tags: [['a', coordinate]],
});

test('aggregateSocialProof counts kind:7 reactions for the coordinate', () => {
  const events = [makeReaction(), makeReaction(), makeReaction()];
  const result = aggregateSocialProof(COORDINATE, events);
  assert.deepEqual(result, { totalSats: 0, largestZap: 0, heartCount: 3 });
});

test('aggregateSocialProof combines zaps and hearts correctly from mixed events', () => {
  const OTHER = `30023:${'b'.repeat(64)}:other-essay`;
  const events = [
    makeZap(100000),
    makeZap(21000),
    makeZap(5000, OTHER),
    makeReaction(),
    makeReaction(),
    makeReaction(OTHER),
    { kind: 1, content: 'just a note', tags: [] },
  ];
  const result = aggregateSocialProof(COORDINATE, events);
  assert.deepEqual(result, { totalSats: 121, largestZap: 100, heartCount: 2 });
});

test('aggregateSocialProof ignores kind:7 reactions for a different coordinate', () => {
  const OTHER = `30023:${'b'.repeat(64)}:other-essay`;
  const result = aggregateSocialProof(COORDINATE, [makeReaction(OTHER), makeReaction()]);
  assert.deepEqual(result, { totalSats: 0, largestZap: 0, heartCount: 1 });
});
