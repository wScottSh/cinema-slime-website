import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCurate, applyRename, curationFromEvent, curationToTags, nameOf } from './curation.js';

const RENN = '36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0';
const HARRISON = '2b245b2d9010cabc724d4f078d0d811891b67f8390c19038fb0982519addfd2a';
const NEWCOMER = 'ab'.repeat(32);
const IDAHO = `30023:${RENN}:my-own-private-idaho-x-1991`;
const MIRROR = `30023:${HARRISON}:fZKdoNy4ds6aFAtckJLuZ`;
const FRESH = `30023:${HARRISON}:c3pwRmDcBE1ND9ZgBi8RL`;

const TAGS = [
  ['d', 'cinema-slime-essays'],
  ['a', IDAHO, '', 'my-own-private-idaho'],
  ['a', MIRROR, '', 'the-mirror'],
  ['p', RENN, '', 'Renn'],
  ['p', HARRISON, '', 'Harrison'],
];
const EVENT = { kind: 30001, id: 'e1', created_at: 1000, tags: TAGS, content: '' };
const live = () => curationFromEvent(EVENT);

test('curationFromEvent reads entries in display order, names, and identity', () => {
  assert.deepEqual(live(), {
    entries: [{ coordinate: IDAHO, slug: 'my-own-private-idaho' }, { coordinate: MIRROR, slug: 'the-mirror' }],
    names: [{ pubkey: RENN, name: 'Renn' }, { pubkey: HARRISON, name: 'Harrison' }],
    createdAt: 1000,
    eventId: 'e1',
  });
});

test('curationToTags round-trips the live tags exactly', () => {
  assert.deepEqual(curationToTags(live()), TAGS);
});

test('an entry without a slug round-trips as a two-element a tag', () => {
  const event = { ...EVENT, tags: [['d', 'cinema-slime-essays'], ['a', IDAHO]] };
  assert.deepEqual(curationFromEvent(event).entries, [{ coordinate: IDAHO, slug: null }]);
  assert.deepEqual(curationToTags(curationFromEvent(event)), event.tags);
});

test('curationFromEvent refuses a list it must never republish', () => {
  const withTags = (...extra) => ({ ...EVENT, tags: [...TAGS, ...extra] });
  assert.throws(() => curationFromEvent(withTags(['a', IDAHO, '', 'other'])), /duplicate coordinate/);
  assert.throws(() => curationFromEvent(withTags(['a', FRESH, '', 'the-mirror'])), /duplicate slug/);
  assert.throws(() => curationFromEvent(withTags(['a', FRESH, '', 'Bad Slug'])), /malformed slug/);
  assert.throws(() => curationFromEvent({ ...EVENT, kind: 1 }), /kind:30001/);
  assert.throws(() => curationFromEvent({ ...EVENT, tags: [['d', 'other']] }), /cinema-slime-essays/);
});

const BIRTH_DATE = { coordinate: FRESH, title: 'Birth Date - Midnight Spider-Man #1 (Spoilers)', author: HARRISON, identifier: 'c3pwRmDcBE1ND9ZgBi8RL' };

test('applyCurate appends a new Essay under the picked slug', () => {
  const edit = applyCurate(live(), BIRTH_DATE);
  assert.equal(edit.change, 'added');
  assert.deepEqual(edit.entry, { coordinate: FRESH, slug: 'midnight-spider-man' });
  assert.deepEqual(edit.next.entries.at(-1), edit.entry);
  assert.equal(edit.next.entries.length, 3);
  assert.equal(edit.next.eventId, null);
});

test('applyCurate uses an explicit slug for a new Essay', () => {
  const edit = applyCurate(live(), { ...BIRTH_DATE, slug: 'birth-date' });
  assert.deepEqual(edit.entry, { coordinate: FRESH, slug: 'birth-date' });
});

test('applyCurate refuses an explicit slug another Essay owns', () => {
  assert.deepEqual(applyCurate(live(), { ...BIRTH_DATE, slug: 'the-mirror' }), { kind: 'refused', reason: 'slug-taken', slug: 'the-mirror' });
});

test('applyCurate suffixes a picked slug that collides', () => {
  const taken = curationFromEvent({ ...EVENT, tags: [...TAGS, ['a', `30023:${RENN}:x`, '', 'midnight-spider-man']] });
  assert.equal(applyCurate(taken, BIRTH_DATE).entry.slug, 'midnight-spider-man-2');
});

test('applyCurate on a listed Essay is unchanged and keeps its slug', () => {
  const edit = applyCurate(live(), { ...BIRTH_DATE, coordinate: MIRROR, title: 'Something Else - Entirely #4' });
  assert.equal(edit.change, 'unchanged');
  assert.deepEqual(edit.next, live());
  assert.deepEqual(edit.entry, { coordinate: MIRROR, slug: 'the-mirror' });
});

test('applyCurate refuses a different slug for a listed Essay and points at rename', () => {
  assert.deepEqual(applyCurate(live(), { ...BIRTH_DATE, coordinate: MIRROR, slug: 'mirror' }), {
    kind: 'refused', reason: 'slug-locked', slug: 'the-mirror', requested: 'mirror',
  });
});

test('applyCurate refuses a new author with no name rather than guessing one', () => {
  const edit = applyCurate(live(), { ...BIRTH_DATE, author: NEWCOMER, coordinate: `30023:${NEWCOMER}:x` });
  assert.deepEqual(edit, { kind: 'refused', reason: 'author-unnamed', author: NEWCOMER });
});

test('applyCurate names a new author when a name is given', () => {
  const edit = applyCurate(live(), { ...BIRTH_DATE, author: NEWCOMER, coordinate: `30023:${NEWCOMER}:x`, name: 'Sam' });
  assert.equal(edit.change, 'added');
  assert.equal(nameOf(edit.next, NEWCOMER), 'Sam');
  assert.equal(edit.next.names.length, 3);
});

test('applyRename moves a listed Essay to a free slug and reports the old one', () => {
  const edit = applyRename(live(), { coordinate: MIRROR, slug: 'mirror' });
  assert.equal(edit.change, 'renamed');
  assert.equal(edit.previousSlug, 'the-mirror');
  assert.deepEqual(edit.next.entries.map((e) => e.slug), ['my-own-private-idaho', 'mirror']);
});

test('applyRename refuses an unlisted Essay or a taken slug, and is unchanged on the same slug', () => {
  assert.equal(applyRename(live(), { coordinate: FRESH, slug: 'x' }).reason, 'not-listed');
  assert.equal(applyRename(live(), { coordinate: MIRROR, slug: 'my-own-private-idaho' }).reason, 'slug-taken');
  assert.equal(applyRename(live(), { coordinate: MIRROR, slug: 'the-mirror' }).change, 'unchanged');
});
