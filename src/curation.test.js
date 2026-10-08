import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCurate, applyRename, applyStandardize, curationFromEvent, curationToTags, nameOf } from './curation.js';
import { LIVE_CREATED_AT, LIVE_NAMES, LIVE_ROWS } from './live-curation.fixture.js';

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
    aliases: [],
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
  assert.deepEqual(edit.entry, { coordinate: FRESH, slug: 'midnight-spider-man-1' });
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
  const taken = curationFromEvent({ ...EVENT, tags: [...TAGS, ['a', `30023:${RENN}:x`, '', 'midnight-spider-man-1']] });
  assert.equal(applyCurate(taken, BIRTH_DATE).entry.slug, 'midnight-spider-man-1-2');
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

const ALIASED_TAGS = [
  ['d', 'cinema-slime-essays'],
  ['a', IDAHO, '', 'my-own-private-idaho-1991'],
  ['a', MIRROR, '', 'spider-man-noir-s1e8'],
  ['alias', 'my-own-private-idaho', IDAHO],
  ['alias', 'the-mirror', MIRROR],
  ['p', HARRISON, '', 'Harrison'],
];
const aliased = () => curationFromEvent({ ...EVENT, tags: ALIASED_TAGS });

test('Slug Aliases round-trip through the codec', () => {
  assert.deepEqual(aliased().aliases, [
    { slug: 'my-own-private-idaho', coordinate: IDAHO },
    { slug: 'the-mirror', coordinate: MIRROR },
  ]);
  assert.deepEqual(curationToTags(aliased()), ALIASED_TAGS);
});

test('curationFromEvent refuses an alias that points nowhere or shadows another slug', () => {
  const withTags = (...extra) => ({ ...EVENT, tags: [...ALIASED_TAGS, ...extra] });
  assert.throws(() => curationFromEvent(withTags(['alias', 'gone', FRESH])), /alias "gone" points at unlisted/);
  assert.throws(() => curationFromEvent(withTags(['alias', 'spider-man-noir-s1e8', IDAHO])), /duplicate slug "spider-man-noir-s1e8"/);
  assert.throws(() => curationFromEvent(withTags(['alias', 'the-mirror', IDAHO])), /duplicate slug "the-mirror"/);
  assert.throws(() => curationFromEvent(withTags(['alias', 'Bad Alias', IDAHO])), /malformed alias/);
  // Tag order does not matter: an alias before the slug it shadows is still caught.
  assert.throws(() => curationFromEvent({ ...EVENT, tags: [['d', 'cinema-slime-essays'], ['alias', 'x', IDAHO], ['a', IDAHO, '', 'x']] }), /duplicate slug "x"/);
});

test('an alias is taken: an explicit slug is refused and a picked one steps past it', () => {
  assert.deepEqual(applyCurate(aliased(), { ...BIRTH_DATE, slug: 'the-mirror' }), { kind: 'refused', reason: 'slug-taken', slug: 'the-mirror' });
  const taken = curationFromEvent({ ...EVENT, tags: [...ALIASED_TAGS, ['alias', 'midnight-spider-man-1', IDAHO]] });
  assert.equal(applyCurate(taken, BIRTH_DATE).entry.slug, 'midnight-spider-man-1-2');
});

test('applyRename keeps the previous slug as an alias, and renaming back reclaims it', () => {
  const renamed = applyRename(live(), { coordinate: MIRROR, slug: 'mirror' });
  assert.deepEqual(renamed.next.aliases, [{ slug: 'the-mirror', coordinate: MIRROR }]);
  const back = applyRename(renamed.next, { coordinate: MIRROR, slug: 'the-mirror' });
  assert.equal(back.change, 'renamed');
  assert.deepEqual(back.next.entries.map((e) => e.slug), ['my-own-private-idaho', 'the-mirror']);
  assert.deepEqual(back.next.aliases, [{ slug: 'mirror', coordinate: MIRROR }]);
});

test("applyRename refuses another Essay's alias", () => {
  assert.equal(applyRename(aliased(), { coordinate: MIRROR, slug: 'my-own-private-idaho' }).reason, 'slug-taken');
});

const liveCuration = () => curationFromEvent({
  kind: 30001,
  id: 'live',
  created_at: LIVE_CREATED_AT,
  tags: [['d', 'cinema-slime-essays'], ...LIVE_ROWS.map(([coordinate, slug]) => ['a', coordinate, '', slug]), ...LIVE_NAMES],
  content: '',
});
const LIVE_TITLES = new Map(LIVE_ROWS.map(([coordinate, , title]) => [coordinate, title]));

test('applyStandardize moves the live list to the standard slugs and keeps every old slug as an alias', () => {
  const edit = applyStandardize(liveCuration(), LIVE_TITLES);
  assert.equal(edit.change, 'standardized');
  assert.deepEqual(edit.next.entries.map((e) => e.slug), [
    'feeling-alive-2007',
    'spider-man-noir-s1e1',
    'spider-man-noir-s1e2',
    'spider-man-noir-s1e3',
    'my-own-private-idaho-1991',
    'spider-man-noir-s1e4',
    'valhallaw-1',
    'web-of-blood-1',
    'spider-man-noir-s1e5',
    'the-cimmerian-1',
    'spider-man-noir-s1e6',
    'absolute-batman-1',
    'absolute-batman-2',
    'spider-man-noir-s1e7',
    'absolute-batman-3',
    'spider-man-noir-s1e8',
    'midnight-spider-man-1',
  ]);
  assert.deepEqual(edit.next.entries.map((e) => e.coordinate), LIVE_ROWS.map(([c]) => c), 'display order and coordinates are kept');
  const unchanged = new Set(['feeling-alive-2007', 'valhallaw-1', 'absolute-batman-3']);
  assert.deepEqual(
    edit.next.aliases,
    LIVE_ROWS.filter(([, slug]) => !unchanged.has(slug)).map(([coordinate, slug]) => ({ slug, coordinate })),
  );
  assert.equal(edit.changes.length, 14);
  assert.equal(edit.next.eventId, null);
  assert.deepEqual(edit.next.names, liveCuration().names);
  const republished = curationFromEvent({ kind: 30001, id: 'n', created_at: 1, tags: curationToTags(edit.next) });
  assert.deepEqual(republished.aliases, edit.next.aliases, 'the result passes the strict codec');
});

test('applyStandardize on a standard list is unchanged', () => {
  const once = applyStandardize(liveCuration(), LIVE_TITLES).next;
  const again = applyStandardize(once, LIVE_TITLES);
  assert.equal(again.change, 'unchanged');
  assert.equal(again.next, once);
  assert.deepEqual(again.changes, []);
});

test('applyStandardize never hands out a slug another Essay still owns', () => {
  const OTHER = `30023:${RENN}:other`;
  const curation = curationFromEvent({
    ...EVENT,
    tags: [
      ['d', 'cinema-slime-essays'],
      ['a', MIRROR, '', 'old-mirror'],
      ['a', FRESH, '', 'spider-man-noir-s1e8'],
      ['a', OTHER, '', 'other'],
      ['alias', 'heat', OTHER],
    ],
  });
  const titles = new Map([
    [MIRROR, 'The Mirror - Spider-Man Noir S1E8'],
    [FRESH, 'Duplicate - Spider-Man Noir S1E8'],
    [OTHER, 'Heat'],
  ]);
  const edit = applyStandardize(curation, titles);
  // MIRROR comes first but FRESH still holds spider-man-noir-s1e8, so MIRROR is suffixed;
  // OTHER reclaims its own alias.
  assert.deepEqual(edit.next.entries.map((e) => e.slug), ['spider-man-noir-s1e8-2', 'spider-man-noir-s1e8', 'heat']);
  assert.deepEqual(edit.next.aliases, [{ slug: 'old-mirror', coordinate: MIRROR }, { slug: 'other', coordinate: OTHER }]);
});

test('applyStandardize refuses when a listed Essay has no title to derive from', () => {
  const titles = new Map(LIVE_TITLES);
  titles.delete(LIVE_ROWS[3][0]);
  assert.deepEqual(applyStandardize(liveCuration(), titles), { kind: 'refused', reason: 'titles-missing', missing: [LIVE_ROWS[3][0]] });
});
