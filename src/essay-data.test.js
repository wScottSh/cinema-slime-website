import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLongFormEvent, getLatestByCoordinate, getEssayByCoordinate } from './essay-data.js';

const PUBKEY = 'b'.repeat(64);

const baseEvent = {
  id: 'evt1',
  kind: 30023,
  pubkey: PUBKEY,
  created_at: 1700000000,
  content: '# Hello\n\nThis is the body.',
  tags: [
    ['d', 'hello-world'],
    ['title', 'Hello World'],
    ['published_at', '1699990000'],
    ['summary', 'A short summary'],
    ['image', 'https://example.com/img.png'],
  ],
};

test('parseLongFormEvent extracts title, body, identifier, and coordinate from a kind:30023 event', () => {
  const essay = parseLongFormEvent(baseEvent);
  assert.equal(essay.title, 'Hello World');
  assert.equal(essay.body, '# Hello\n\nThis is the body.');
  assert.equal(essay.coordinate.identifier, 'hello-world');
  assert.equal(essay.coordinateString, `30023:${PUBKEY}:hello-world`);
  assert.equal(essay.publishedAt, 1699990000);
});

test('parseLongFormEvent rejects non-long-form, non-object, and unaddressable events', () => {
  assert.equal(parseLongFormEvent(null), null);
  assert.equal(parseLongFormEvent({}), null); // no kind
  assert.equal(parseLongFormEvent({ ...baseEvent, kind: 1 }), null); // a note, not long-form
  assert.equal(parseLongFormEvent({ ...baseEvent, pubkey: 'nothex' }), null); // unaddressable
});

test('parseLongFormEvent falls back to created_at when published_at is absent', () => {
  const ev = { ...baseEvent, tags: [['d', 'no-pub'], ['title', 'No Pub']] };
  assert.equal(parseLongFormEvent(ev).publishedAt, 1700000000);
});

test('getLatestByCoordinate keeps only the newest version of each coordinate (edits win)', () => {
  const older = { ...baseEvent, id: 'old', created_at: 1700000000, content: 'old body' };
  const newer = { ...baseEvent, id: 'new', created_at: 1700009999, content: 'edited body' };
  const latest = getLatestByCoordinate([older, newer]);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].body, 'edited body');
  assert.equal(latest[0].eventId, 'new');
});

test('getLatestByCoordinate keeps distinct coordinates and drops malformed events', () => {
  const a = { ...baseEvent, id: 'a', tags: [['d', 'aaa'], ['title', 'A']] };
  const b = { ...baseEvent, id: 'b', tags: [['d', 'bbb'], ['title', 'B']] };
  const junk = { kind: 1, pubkey: PUBKEY, content: 'just a note' };
  const result = getLatestByCoordinate([a, b, junk, null]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((e) => e.coordinate.identifier).sort(), ['aaa', 'bbb']);
});

test('getEssayByCoordinate selects the essay matching a coordinate string', () => {
  const essays = getLatestByCoordinate([
    { ...baseEvent, id: 'a', tags: [['d', 'aaa'], ['title', 'A']] },
    { ...baseEvent, id: 'b', tags: [['d', 'bbb'], ['title', 'B']] },
  ]);
  assert.equal(getEssayByCoordinate(`30023:${PUBKEY}:bbb`, essays).title, 'B');
});

test('getEssayByCoordinate returns null for unknown coordinate or invalid input', () => {
  assert.equal(getEssayByCoordinate(`30023:${PUBKEY}:missing`, []), null);
  assert.equal(getEssayByCoordinate('  ', []), null);
  assert.equal(getEssayByCoordinate(null, []), null);
  assert.equal(getEssayByCoordinate(`30023:${PUBKEY}:aaa`, null), null);
});
