import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCurationList, getLatestCurationList, selectCuratedEssay } from './essay-curation.js';

const BRAND = 'f'.repeat(64);
const AUTHOR_A = 'a'.repeat(64);
const AUTHOR_B = 'b'.repeat(64);

// A well-formed brand curation list: `a` tags carry the curated Essay
// coordinates, `p` tags carry the brand-approved display name in the NIP-02
// petname position (4th element).
const baseList = {
  id: 'list1',
  kind: 30001,
  pubkey: BRAND,
  created_at: 1700000000,
  content: '',
  tags: [
    ['d', 'cinema-slime-essays'],
    ['a', `30023:${AUTHOR_A}:essay-one`],
    ['a', `30023:${AUTHOR_B}:essay-two`],
    ['p', AUTHOR_A, '', 'Harrison Jensen'],
    ['p', AUTHOR_B, '', 'Renn Jensen'],
  ],
};

test('parseCurationList collects curated Essay coordinates from the a tags', () => {
  const { coordinates } = parseCurationList(baseList);
  assert.ok(coordinates.has(`30023:${AUTHOR_A}:essay-one`));
  assert.ok(coordinates.has(`30023:${AUTHOR_B}:essay-two`));
  assert.equal(coordinates.size, 2);
});

test('parseCurationList builds a pubkey-to-display-name map from the p tag petnames', () => {
  const { names } = parseCurationList(baseList);
  assert.equal(names.get(AUTHOR_A), 'Harrison Jensen');
  assert.equal(names.get(AUTHOR_B), 'Renn Jensen');
  assert.equal(names.size, 2);
});

test('parseCurationList ignores non-30001 events and malformed input (safe empty result)', () => {
  // A brand-key social note (kind:1) carrying a/p tags must NOT be read as a
  // curation list — only the dedicated kind:30001 list event counts.
  const brandNote = {
    kind: 1,
    pubkey: BRAND,
    tags: [['a', `30023:${AUTHOR_A}:sneaky`], ['p', AUTHOR_A, '', 'Mallory']],
  };
  for (const bad of [null, undefined, {}, 'nope', 42, brandNote, { kind: 30001 }]) {
    const { coordinates, names } = parseCurationList(bad);
    assert.equal(coordinates.size, 0);
    assert.equal(names.size, 0);
  }
});

test('parseCurationList survives malformed tags without throwing', () => {
  const messy = {
    kind: 30001,
    pubkey: BRAND,
    tags: [
      ['d', 'cinema-slime-essays'],
      ['a'], // missing coordinate
      ['a', ''], // empty coordinate
      'not-an-array',
      ['p', AUTHOR_A], // no petname
      ['p', '', '', 'Ghost'], // no pubkey
      ['a', `30023:${AUTHOR_A}:real`],
      ['p', AUTHOR_A, '', 'Harrison Jensen'],
    ],
  };
  const { coordinates, names } = parseCurationList(messy);
  assert.deepEqual([...coordinates], [`30023:${AUTHOR_A}:real`]);
  assert.equal(names.get(AUTHOR_A), 'Harrison Jensen');
  assert.equal(names.size, 1);
});

test('getLatestCurationList parses only the newest version (latest list fully replaces older)', () => {
  const older = {
    ...baseList,
    id: 'old',
    created_at: 1700000000,
    tags: [['d', 'cinema-slime-essays'], ['a', `30023:${AUTHOR_A}:essay-one`]],
  };
  const newer = {
    ...baseList,
    id: 'new',
    created_at: 1700009999,
    tags: [['d', 'cinema-slime-essays'], ['a', `30023:${AUTHOR_B}:essay-two`], ['p', AUTHOR_B, '', 'Renn Jensen']],
  };
  const { coordinates, names } = getLatestCurationList([older, newer]);
  assert.ok(coordinates.has(`30023:${AUTHOR_B}:essay-two`));
  assert.ok(!coordinates.has(`30023:${AUTHOR_A}:essay-one`)); // superseded version is gone
  assert.equal(names.get(AUTHOR_B), 'Renn Jensen');
});

test('getLatestCurationList returns an empty curation when no list event is present', () => {
  const { coordinates, names } = getLatestCurationList([{ kind: 1, tags: [] }, null, 'x']);
  assert.equal(coordinates.size, 0);
  assert.equal(names.size, 0);
});

// A parsed Essay, shaped like the output of parseLongFormEvent.
const essayA = {
  coordinateString: `30023:${AUTHOR_A}:essay-one`,
  pubkey: AUTHOR_A,
  title: 'Essay One',
  body: 'hello',
  eventId: 'evt-a',
};

test('selectCuratedEssay returns the Essay with the brand display name when its coordinate is curated', () => {
  const official = selectCuratedEssay(essayA, parseCurationList(baseList));
  assert.equal(official.coordinateString, `30023:${AUTHOR_A}:essay-one`);
  assert.equal(official.authorName, 'Harrison Jensen');
  assert.equal(official.title, 'Essay One'); // original fields preserved
});

test('selectCuratedEssay rejects an Essay whose coordinate is not on the list', () => {
  const notCurated = { ...essayA, coordinateString: `30023:${AUTHOR_A}:other-writing` };
  assert.equal(selectCuratedEssay(notCurated, parseCurationList(baseList)), null);
});

test('selectCuratedEssay fails closed for an empty/missing curation or missing Essay', () => {
  assert.equal(selectCuratedEssay(essayA, parseCurationList(null)), null); // empty list
  assert.equal(selectCuratedEssay(essayA, null), null); // relays unreachable
  assert.equal(selectCuratedEssay(null, parseCurationList(baseList)), null);
});

test('selectCuratedEssay yields an empty name when the curated author is absent from the name map', () => {
  // Curated coordinate, but the brand supplied no display name for this author.
  const listNoName = {
    ...baseList,
    tags: [['d', 'cinema-slime-essays'], ['a', `30023:${AUTHOR_A}:essay-one`]],
  };
  const official = selectCuratedEssay(essayA, parseCurationList(listNoName));
  assert.equal(official.authorName, ''); // never falls back to kind:0 or the pubkey
});

// ─── slugToCoordinate map ────────────────────────────────────────────────────

const slugList = {
  id: 'slug-list',
  kind: 30001,
  pubkey: BRAND,
  created_at: 1700000001,
  content: '',
  tags: [
    ['d', 'cinema-slime-essays'],
    ['a', `30023:${AUTHOR_A}:essay-one`, '', 'first'],   // slug present at index 3
    ['a', `30023:${AUTHOR_B}:essay-two`],                // no slug
    ['p', AUTHOR_A, '', 'Harrison Jensen'],
  ],
};

test('parseCurationList builds a slugToCoordinate map from a-tag index 3', () => {
  const { slugToCoordinate } = parseCurationList(slugList);
  assert.equal(slugToCoordinate.get('first'), `30023:${AUTHOR_A}:essay-one`);
  assert.equal(slugToCoordinate.size, 1); // essay-two has no slug
});

test('parseCurationList ignores a tags that have no slug at index 3', () => {
  const { slugToCoordinate } = parseCurationList(slugList);
  assert.ok(!slugToCoordinate.has(undefined));
  assert.equal(slugToCoordinate.size, 1);
});

test('parseCurationList rejects a malformed slug at index 3 (does not add to map)', () => {
  const bad = {
    ...slugList,
    tags: [
      ['d', 'cinema-slime-essays'],
      ['a', `30023:${AUTHOR_A}:essay-one`, '', 'Bad Slug!'],  // invalid
      ['a', `30023:${AUTHOR_B}:essay-two`, '', 'ok-slug'],   // valid
    ],
  };
  const { slugToCoordinate } = parseCurationList(bad);
  assert.ok(!slugToCoordinate.has('Bad Slug!'));
  assert.equal(slugToCoordinate.get('ok-slug'), `30023:${AUTHOR_B}:essay-two`);
  assert.equal(slugToCoordinate.size, 1);
});

test('parseCurationList returns an empty slugToCoordinate map when no slugs are present', () => {
  const { slugToCoordinate } = parseCurationList(baseList);
  assert.equal(slugToCoordinate.size, 0);
});

test('parseCurationList returns an empty slugToCoordinate for invalid/missing events', () => {
  for (const bad of [null, undefined, {}, 'nope']) {
    const { slugToCoordinate } = parseCurationList(bad);
    assert.equal(slugToCoordinate.size, 0);
  }
});

test('getLatestCurationList supersedes older slugs — newest version wins', () => {
  const older = {
    ...slugList,
    id: 'old',
    created_at: 1700000000,
    tags: [['d', 'cinema-slime-essays'], ['a', `30023:${AUTHOR_A}:essay-one`, '', 'old-slug']],
  };
  const newer = {
    ...slugList,
    id: 'new',
    created_at: 1700009999,
    tags: [['d', 'cinema-slime-essays'], ['a', `30023:${AUTHOR_A}:essay-one`, '', 'new-slug']],
  };
  const { slugToCoordinate } = getLatestCurationList([older, newer]);
  assert.ok(!slugToCoordinate.has('old-slug'));
  assert.equal(slugToCoordinate.get('new-slug'), `30023:${AUTHOR_A}:essay-one`);
});

test('getLatestCurationList supersedes older coordinateToSlug — newest version wins', () => {
  const older = {
    ...slugList,
    id: 'old',
    created_at: 1700000000,
    tags: [['d', 'cinema-slime-essays'], ['a', `30023:${AUTHOR_A}:essay-one`, '', 'old-slug']],
  };
  const newer = {
    ...slugList,
    id: 'new',
    created_at: 1700009999,
    tags: [['d', 'cinema-slime-essays'], ['a', `30023:${AUTHOR_A}:essay-one`, '', 'new-slug']],
  };
  const { coordinateToSlug } = getLatestCurationList([older, newer]);
  assert.equal(coordinateToSlug.get(`30023:${AUTHOR_A}:essay-one`), 'new-slug');
});

test('selectCuratedEssay gates on coordinate, not version — an edited Essay stays official without re-curation', () => {
  const curation = parseCurationList(baseList); // unchanged list, points at the coordinate
  const original = { ...essayA, eventId: 'v1', body: 'first draft' };
  const edited = { ...essayA, eventId: 'v2', body: 'revised draft' };
  assert.equal(selectCuratedEssay(original, curation).body, 'first draft');
  assert.equal(selectCuratedEssay(edited, curation).body, 'revised draft');
  assert.equal(selectCuratedEssay(edited, curation).authorName, 'Harrison Jensen');
});

// ─── coordinateToSlug map ────────────────────────────────────────────────────

test('parseCurationList builds a coordinateToSlug map (reverse of slugToCoordinate)', () => {
  const { coordinateToSlug } = parseCurationList(slugList);
  assert.equal(coordinateToSlug.get(`30023:${AUTHOR_A}:essay-one`), 'first');
  assert.equal(coordinateToSlug.size, 1); // essay-two has no slug
});

test('parseCurationList coordinateToSlug excludes coordinates without a slug', () => {
  const { coordinateToSlug } = parseCurationList(slugList);
  assert.ok(!coordinateToSlug.has(`30023:${AUTHOR_B}:essay-two`));
});

test('parseCurationList coordinateToSlug excludes malformed slugs', () => {
  const bad = {
    ...slugList,
    tags: [
      ['d', 'cinema-slime-essays'],
      ['a', `30023:${AUTHOR_A}:essay-one`, '', 'Bad Slug!'],
      ['a', `30023:${AUTHOR_B}:essay-two`, '', 'ok-slug'],
    ],
  };
  const { coordinateToSlug } = parseCurationList(bad);
  assert.ok(!coordinateToSlug.has(`30023:${AUTHOR_A}:essay-one`));
  assert.equal(coordinateToSlug.get(`30023:${AUTHOR_B}:essay-two`), 'ok-slug');
  assert.equal(coordinateToSlug.size, 1);
});

test('parseCurationList returns an empty coordinateToSlug when no slugs are present', () => {
  const { coordinateToSlug } = parseCurationList(baseList);
  assert.equal(coordinateToSlug.size, 0);
});

test('parseCurationList returns an empty coordinateToSlug for invalid/missing events', () => {
  for (const bad of [null, undefined, {}, 'nope']) {
    const { coordinateToSlug } = parseCurationList(bad);
    assert.equal(coordinateToSlug.size, 0);
  }
});
