import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEssaysSnapshot } from './essays-snapshot.js';

// Shared fixture pubkeys — arbitrary hex strings that stand in for real keys
const BRAND_PUBKEY = '3fe7d91eb4133567db1ad7abab7ae308ebd9ae2d109601a7257e995035651365';
const AUTHOR1 = '36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0';
const AUTHOR2 = '2cfce0fc7e8f5e8e29a42427ed5903b9cd846e33ace7a7ab79f03ce28e3584e6';
const AUTHOR3 = 'aaaa0000bbbb1111cccc2222dddd3333eeee4444ffff555566667777888899990';

// ── Fixture builders ──────────────────────────────────────────────────────────

function curationEvent({ coordinates = [], created_at = 1700000000 } = {}) {
  // Each coordinate entry is { coord, slug?, name? }
  const tags = [['d', 'cinema-slime-essays']];
  for (const { coord, slug, name, pubkey } of coordinates) {
    tags.push(['a', coord, '', slug ?? '']);
    if (name && pubkey) tags.push(['p', pubkey, '', name]);
  }
  return {
    id: 'curation-id-1',
    pubkey: BRAND_PUBKEY,
    created_at,
    kind: 30001,
    tags,
    content: '',
    sig: 'sig',
  };
}

function essayEvent({ pubkey = AUTHOR1, identifier = 'my-essay', title = 'My Essay', body = 'Hello.', published_at = 1700000001, created_at = 1700000001 } = {}) {
  return {
    id: `essay-${identifier}`,
    pubkey,
    created_at,
    kind: 30023,
    tags: [
      ['d', identifier],
      ['title', title],
      ['published_at', String(published_at)],
    ],
    content: body,
    sig: 'sig',
  };
}

function payload(events) {
  return { events };
}

// ── Core happy-path tests ─────────────────────────────────────────────────────

test('returns a curated essay entry with correct shape', () => {
  const coord = `30023:${AUTHOR1}:my-essay`;
  const curation = payload([curationEvent({ coordinates: [{ coord, slug: 'my-slug', pubkey: AUTHOR1, name: 'Scott' }] })]);
  const events = payload([essayEvent({ pubkey: AUTHOR1, identifier: 'my-essay', title: 'My Essay', body: 'Hello.' })]);

  const entries = parseEssaysSnapshot(curation, events);

  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.coordinate, coord);
  assert.equal(entry.slug, 'my-slug');
  assert.equal(entry.essay.title, 'My Essay');
  assert.equal(entry.essay.body, 'Hello.');
  assert.equal(entry.essay.authorName, 'Scott');
  assert.equal(entry.essay.pubkey, AUTHOR1);
});

test('applies the curation gate: non-curated essay coordinates are excluded', () => {
  const curatedCoord = `30023:${AUTHOR1}:curated`;
  const uncuratedCoord = `30023:${AUTHOR2}:uncurated`;
  const curation = payload([curationEvent({ coordinates: [{ coord: curatedCoord, slug: 'curated' }] })]);
  const events = payload([
    essayEvent({ pubkey: AUTHOR1, identifier: 'curated', title: 'Curated Essay' }),
    essayEvent({ pubkey: AUTHOR2, identifier: 'uncurated', title: 'NOT Official' }),
  ]);

  const entries = parseEssaysSnapshot(curation, events);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].coordinate, curatedCoord);
});

test('sorts entries newest-first by publishedAt', () => {
  const coord1 = `30023:${AUTHOR1}:old-essay`;
  const coord2 = `30023:${AUTHOR2}:new-essay`;
  const curation = payload([curationEvent({
    coordinates: [
      { coord: coord1, slug: 'old', pubkey: AUTHOR1, name: 'Scott' },
      { coord: coord2, slug: 'new', pubkey: AUTHOR2, name: 'Harrison' },
    ],
  })]);
  const events = payload([
    essayEvent({ pubkey: AUTHOR1, identifier: 'old-essay', published_at: 1700000001 }),
    essayEvent({ pubkey: AUTHOR2, identifier: 'new-essay', published_at: 1700000999 }),
  ]);

  const entries = parseEssaysSnapshot(curation, events);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].coordinate, coord2);
  assert.equal(entries[1].coordinate, coord1);
});

test('carries the brand-approved author name from the curation list', () => {
  const coord = `30023:${AUTHOR1}:essay`;
  const curation = payload([curationEvent({
    coordinates: [{ coord, pubkey: AUTHOR1, name: 'Cinema Slime Name' }],
  })]);
  const events = payload([essayEvent({ pubkey: AUTHOR1, identifier: 'essay' })]);

  const [entry] = parseEssaysSnapshot(curation, events);

  assert.equal(entry.essay.authorName, 'Cinema Slime Name');
});

test('entry slug is undefined when the curation a-tag carries no slug', () => {
  const coord = `30023:${AUTHOR1}:essay`;
  const curation = payload([curationEvent({
    coordinates: [{ coord }], // no slug
  })]);
  const events = payload([essayEvent({ pubkey: AUTHOR1, identifier: 'essay' })]);

  const [entry] = parseEssaysSnapshot(curation, events);

  // coordinateToSlug has no entry → undefined
  assert.equal(entry.slug, undefined);
});

test('returns empty array when the curation list is empty', () => {
  const curation = payload([curationEvent({ coordinates: [] })]);
  const events = payload([essayEvent()]);

  assert.deepEqual(parseEssaysSnapshot(curation, events), []);
});

test('returns empty array when no essay events match curated coordinates', () => {
  const coord = `30023:${AUTHOR1}:missing`;
  const curation = payload([curationEvent({ coordinates: [{ coord, slug: 'missing' }] })]);
  const events = payload([]); // no events at all

  assert.deepEqual(parseEssaysSnapshot(curation, events), []);
});

// ── Degradation tests ─────────────────────────────────────────────────────────

test('returns empty array and never throws when curationPayload is null', () => {
  assert.doesNotThrow(() => {
    const result = parseEssaysSnapshot(null, payload([essayEvent()]));
    assert.deepEqual(result, []);
  });
});

test('returns empty array and never throws when eventsPayload is null', () => {
  const coord = `30023:${AUTHOR1}:essay`;
  const curation = payload([curationEvent({ coordinates: [{ coord }] })]);
  assert.doesNotThrow(() => {
    const result = parseEssaysSnapshot(curation, null);
    assert.deepEqual(result, []);
  });
});

test('returns empty array and never throws when both payloads are null', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(parseEssaysSnapshot(null, null), []);
  });
});

test('returns empty array when curationPayload has no events array', () => {
  assert.deepEqual(parseEssaysSnapshot({}, payload([essayEvent()])), []);
});

test('returns empty array when eventsPayload has no events array', () => {
  const coord = `30023:${AUTHOR1}:essay`;
  const curation = payload([curationEvent({ coordinates: [{ coord }] })]);
  assert.deepEqual(parseEssaysSnapshot(curation, {}), []);
});

test('skips malformed essay events without throwing', () => {
  const coord = `30023:${AUTHOR1}:essay`;
  const curation = payload([curationEvent({ coordinates: [{ coord, slug: 'essay' }] })]);
  const events = payload([
    null,
    { kind: 99999, id: 'bad' }, // wrong kind
    'not an object',
    essayEvent({ pubkey: AUTHOR1, identifier: 'essay', title: 'Good' }),
  ]);

  const entries = parseEssaysSnapshot(curation, events);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].essay.title, 'Good');
});

test('uses the newest curation event when the payload includes duplicates', () => {
  const coord1 = `30023:${AUTHOR1}:essay1`;
  const coord2 = `30023:${AUTHOR2}:essay2`;
  // Two curation events: older lists coord1; newer supersedes with coord2
  const olderCuration = curationEvent({ coordinates: [{ coord: coord1 }], created_at: 1000 });
  const newerCuration = curationEvent({ coordinates: [{ coord: coord2, slug: 'essay2' }], created_at: 2000 });
  const curation = payload([olderCuration, newerCuration]);
  const events = payload([
    essayEvent({ pubkey: AUTHOR1, identifier: 'essay1' }),
    essayEvent({ pubkey: AUTHOR2, identifier: 'essay2', title: 'Newer Curated' }),
  ]);

  const entries = parseEssaysSnapshot(curation, events);

  // Only coord2 is in the newest curation list
  assert.equal(entries.length, 1);
  assert.equal(entries[0].coordinate, coord2);
  assert.equal(entries[0].essay.title, 'Newer Curated');
});

test('keeps only the newest essay when multiple events share a coordinate', () => {
  const coord = `30023:${AUTHOR1}:essay`;
  const curation = payload([curationEvent({ coordinates: [{ coord, slug: 'essay' }] })]);
  const events = payload([
    essayEvent({ pubkey: AUTHOR1, identifier: 'essay', title: 'Old Version', created_at: 1000 }),
    essayEvent({ pubkey: AUTHOR1, identifier: 'essay', title: 'New Version', created_at: 2000 }),
  ]);

  const [entry] = parseEssaysSnapshot(curation, events);

  assert.equal(entry.essay.title, 'New Version');
});
