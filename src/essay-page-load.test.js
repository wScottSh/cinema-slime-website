import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEssayPageByCoordinate, loadEssayPageBySlug } from './essay-page-load.js';

const PUBKEY = 'a'.repeat(64);
const SLUG = 'my-essay';
const COORD = `30023:${PUBKEY}:${SLUG}`;
const INVALID_COORD = 'not-a-coord';

const ZERO_SOCIAL_PROOF = { totalSats: 0, largestZap: 0, heartCount: 0 };
const SOME_SOCIAL_PROOF = { totalSats: 1000, largestZap: 500, heartCount: 3 };

const makeEssay = (overrides = {}) => ({
  coordinateString: COORD,
  pubkey: PUBKEY,
  title: 'Test Essay',
  body: 'body text',
  eventId: 'evt-1',
  publishedAt: 1700000000,
  ...overrides,
});

const makeCuration = (coordSet = new Set([COORD])) => ({
  coordinates: coordSet,
  names: new Map([[PUBKEY, 'Test Author']]),
  slugToCoordinate: new Map(),
  coordinateToSlug: new Map(),
});

const makePorts = (overrides = {}) => ({
  fetchEssayByCoordinate: async () => makeEssay(),
  fetchCurationList: async () => makeCuration(),
  fetchSocialProof: async () => ZERO_SOCIAL_PROOF,
  getCachedEssay: () => null,
  isRouteActive: () => true,
  ...overrides,
});

const makeSink = () => {
  const calls = [];
  return {
    calls,
    paintCached:       (essay) =>            calls.push({ method: 'paintCached', essay }),
    paintLoading:      () =>                 calls.push({ method: 'paintLoading' }),
    paintFresh:        (official, sp, opts) => calls.push({ method: 'paintFresh', official, socialProof: sp, opts }),
    paintNotFound:     (coord) =>            calls.push({ method: 'paintNotFound', coord }),
    foldInSocialProof: (official, sp) =>     calls.push({ method: 'foldInSocialProof', official, socialProof: sp }),
  };
};

// ─── invalid coordinate ──────────────────────────────────────────────────────

test('invalid coordinate → paintNotFound immediately, no relay fetch', async () => {
  let fetched = false;
  const ports = makePorts({
    fetchEssayByCoordinate: async () => { fetched = true; return null; },
    fetchCurationList: async () => { fetched = true; return makeCuration(); },
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(INVALID_COORD, ports, sink);
  assert.equal(sink.calls.length, 1);
  assert.equal(sink.calls[0].method, 'paintNotFound');
  assert.equal(sink.calls[0].coord, INVALID_COORD);
  assert.equal(fetched, false);
});

// ─── cached SWR fast-paint ────────────────────────────────────────────────────

test('cached SWR fast-paint: paintCached called first with the cached essay', async () => {
  const cached = makeEssay({ eventId: 'cached-1' });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, makePorts({ getCachedEssay: () => cached }), sink);
  assert.equal(sink.calls[0].method, 'paintCached');
  assert.equal(sink.calls[0].essay, cached);
});

test('cached SWR fast-paint: paintLoading not called when cache is warm', async () => {
  const cached = makeEssay();
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, makePorts({ getCachedEssay: () => cached }), sink);
  assert.ok(!sink.calls.some(c => c.method === 'paintLoading'));
});

// ─── cold load ────────────────────────────────────────────────────────────────

test('cold load: paintLoading shown when no cache', async () => {
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, makePorts({ getCachedEssay: () => null }), sink);
  assert.equal(sink.calls[0].method, 'paintLoading');
});

test('cold load + official curation → paintFresh called with official essay', async () => {
  const essay = makeEssay();
  const ports = makePorts({
    getCachedEssay: () => null,
    fetchEssayByCoordinate: async () => essay,
    fetchCurationList: async () => makeCuration(),
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  const freshCall = sink.calls.find(c => c.method === 'paintFresh');
  assert.ok(freshCall, 'paintFresh must be called');
  assert.equal(freshCall.official.title, 'Test Essay');
  assert.equal(freshCall.official.authorName, 'Test Author');
  assert.deepEqual(freshCall.socialProof, ZERO_SOCIAL_PROOF);
  assert.equal(freshCall.opts.restoreScroll, false); // no cached copy to restore from
});

test('cold load + not in curation (non-empty) → paintNotFound', async () => {
  const otherCoord = `30023:${'b'.repeat(64)}:other`;
  const ports = makePorts({
    getCachedEssay: () => null,
    fetchEssayByCoordinate: async () => makeEssay(),
    fetchCurationList: async () => makeCuration(new Set([otherCoord])), // COORD absent
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  const methods = sink.calls.map(c => c.method);
  assert.ok(methods.includes('paintLoading'));
  assert.ok(methods.includes('paintNotFound'));
  assert.ok(!methods.includes('paintFresh'));
});

// ─── cached + relay revalidation ─────────────────────────────────────────────

test('cached + relay confirms same event ID → keep-current, paintFresh not called', async () => {
  const essay = makeEssay({ eventId: 'ev1' });
  const ports = makePorts({
    getCachedEssay: () => essay,
    fetchEssayByCoordinate: async () => essay,
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  assert.ok(sink.calls.some(c => c.method === 'paintCached'));
  assert.ok(!sink.calls.some(c => c.method === 'paintFresh'));
});

test('cached + relay brings updated version → paintFresh with restoreScroll=true', async () => {
  const cached = makeEssay({ eventId: 'ev1' });
  const fresh  = makeEssay({ eventId: 'ev2' }); // updated essay
  const ports = makePorts({
    getCachedEssay: () => cached,
    fetchEssayByCoordinate: async () => fresh,
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  const freshCall = sink.calls.find(c => c.method === 'paintFresh');
  assert.ok(freshCall, 'paintFresh called for updated version');
  assert.equal(freshCall.opts.restoreScroll, true); // preserve reading position
});

// ─── decuration → not-found ───────────────────────────────────────────────────

test('decuration: cached essay + now absent from non-empty curation → paintNotFound', async () => {
  const cached = makeEssay({ eventId: 'ev1' });
  const otherCoord = `30023:${'b'.repeat(64)}:other`;
  const ports = makePorts({
    getCachedEssay: () => cached,
    fetchEssayByCoordinate: async () => makeEssay({ eventId: 'ev1' }),
    fetchCurationList: async () => makeCuration(new Set([otherCoord])), // COORD removed
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  const methods = sink.calls.map(c => c.method);
  assert.ok(methods.includes('paintCached'), 'first-frame paint from cache');
  assert.ok(methods.includes('paintNotFound'), 'then removed from curation → not-found');
  assert.ok(!methods.includes('paintFresh'));
});

// ─── fail-closed (empty curation = relay failure) ────────────────────────────

test('fail-closed: cached + empty curation (relay failure) → keep-current, no paintNotFound', async () => {
  const cached = makeEssay();
  const ports = makePorts({
    getCachedEssay: () => cached,
    fetchEssayByCoordinate: async () => makeEssay(),
    fetchCurationList: async () => makeCuration(new Set()), // empty — relay unreachable
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  const methods = sink.calls.map(c => c.method);
  assert.ok(!methods.includes('paintNotFound'), 'cached copy must not be evicted on ambiguous evidence');
  assert.ok(!methods.includes('paintFresh'));
});

// ─── route-active guard ───────────────────────────────────────────────────────

test('route-active guard: navigate away during relay fetch → no commit over new view', async () => {
  const ports = makePorts({
    getCachedEssay: () => null,
    isRouteActive: () => false, // user navigated away before relays returned
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  const methods = sink.calls.map(c => c.method);
  assert.ok(methods.includes('paintLoading'), 'spinner shown before navigation');
  assert.ok(!methods.includes('paintFresh'), 'in-flight result must not commit');
  assert.ok(!methods.includes('paintNotFound'), 'in-flight result must not commit');
});

// ─── social-proof fold-in ────────────────────────────────────────────────────

test('social-proof fold-in: foldInSocialProof called when zaps/hearts arrive', async () => {
  const essay = makeEssay();
  const ports = makePorts({
    fetchEssayByCoordinate: async () => essay,
    fetchSocialProof: async () => SOME_SOCIAL_PROOF,
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  const foldCall = sink.calls.find(c => c.method === 'foldInSocialProof');
  assert.ok(foldCall, 'foldInSocialProof must be called when social proof is non-zero');
  assert.equal(foldCall.socialProof.totalSats, 1000);
  assert.equal(foldCall.socialProof.heartCount, 3);
  assert.ok(foldCall.official, 'official essay passed through for scroll restore');
});

test('social-proof fold-in: zero social proof → foldInSocialProof not called', async () => {
  const ports = makePorts({
    fetchSocialProof: async () => ZERO_SOCIAL_PROOF,
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  assert.ok(!sink.calls.some(c => c.method === 'foldInSocialProof'));
});

test('social proof not folded when route inactive at time of arrival', async () => {
  let routeCheckCount = 0;
  const essay = makeEssay();
  const ports = makePorts({
    fetchEssayByCoordinate: async () => essay,
    fetchSocialProof: async () => SOME_SOCIAL_PROOF,
    // Active for the body-fetch guard (check 1), inactive for social-proof guard (check 2)
    isRouteActive: () => { routeCheckCount++; return routeCheckCount === 1; },
  });
  const sink = makeSink();
  await loadEssayPageByCoordinate(COORD, ports, sink);
  assert.ok(!sink.calls.some(c => c.method === 'foldInSocialProof'));
});

// ─── loadEssayPageBySlug ─────────────────────────────────────────────────────

const makeSlugCuration = (overrides = {}) => ({
  coordinates: new Set([COORD]),
  names: new Map([[PUBKEY, 'Test Author']]),
  slugToCoordinate: new Map([[SLUG, COORD]]),
  coordinateToSlug: new Map([[COORD, SLUG]]),
  ...overrides,
});

const makeSlugPorts = (overrides = {}) => ({
  fetchCurationList: async () => makeSlugCuration(),
  fetchEssayByCoordinate: async () => makeEssay(),
  fetchSocialProof: async () => ZERO_SOCIAL_PROOF,
  getCachedEssay: () => null,
  isRouteActive: () => true,
  ...overrides,
});

test('slug resolution: slug resolves to coordinate → paintFresh with official essay', async () => {
  const essay = makeEssay();
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: () => null,
    fetchEssayByCoordinate: async () => essay,
  }), sink);
  const freshCall = sink.calls.find(c => c.method === 'paintFresh');
  assert.ok(freshCall, 'paintFresh must be called');
  assert.equal(freshCall.official.title, 'Test Essay');
  assert.equal(freshCall.official.authorName, 'Test Author');
  assert.equal(freshCall.opts.restoreScroll, false);
});

test('slug cached fast-paint: getCachedEssay called with slug, paintCached called first', async () => {
  const cached = makeEssay({ eventId: 'slug-cached-1' });
  let lookupArg;
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: (s) => { lookupArg = s; return cached; },
  }), sink);
  assert.equal(lookupArg, SLUG, 'getCachedEssay must receive the slug');
  assert.equal(sink.calls[0].method, 'paintCached');
  assert.equal(sink.calls[0].essay, cached);
});

test('slug cached fast-paint: paintFresh with restoreScroll=true when cache was warm', async () => {
  const cached = makeEssay({ eventId: 'ev1' });
  const fresh = makeEssay({ eventId: 'ev2' });
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: () => cached,
    fetchEssayByCoordinate: async () => fresh,
  }), sink);
  const freshCall = sink.calls.find(c => c.method === 'paintFresh');
  assert.ok(freshCall, 'paintFresh must be called for updated essay');
  assert.equal(freshCall.opts.restoreScroll, true);
});

test('slug cached fast-paint: paintLoading not called when cache is warm', async () => {
  const cached = makeEssay();
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: () => cached,
  }), sink);
  assert.ok(!sink.calls.some(c => c.method === 'paintLoading'));
});

test('missing slug + empty curation + cached → fail-closed, keep cached, no paintNotFound', async () => {
  const cached = makeEssay();
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: () => cached,
    fetchCurationList: async () => makeSlugCuration({
      coordinates: new Set(),
      slugToCoordinate: new Map(),
      coordinateToSlug: new Map(),
    }),
  }), sink);
  assert.ok(!sink.calls.some(c => c.method === 'paintNotFound'), 'cached copy must not be evicted on relay failure');
});

test('missing slug + non-empty curation → paintNotFound with slug', async () => {
  const otherCoord = `30023:${'b'.repeat(64)}:other`;
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: () => null,
    fetchCurationList: async () => makeSlugCuration({
      coordinates: new Set([otherCoord]),
      slugToCoordinate: new Map(),
      coordinateToSlug: new Map(),
    }),
  }), sink);
  const notFoundCall = sink.calls.find(c => c.method === 'paintNotFound');
  assert.ok(notFoundCall, 'paintNotFound must be called for unknown slug');
  assert.equal(notFoundCall.coord, SLUG);
});

test('missing slug + empty curation + no cached → paintNotFound', async () => {
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: () => null,
    fetchCurationList: async () => makeSlugCuration({
      coordinates: new Set(),
      slugToCoordinate: new Map(),
      coordinateToSlug: new Map(),
    }),
  }), sink);
  assert.ok(sink.calls.some(c => c.method === 'paintNotFound'), 'no cached copy → show not-found even on relay failure');
});

test('slug route-active guard after curation: navigate away → no body paint', async () => {
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    getCachedEssay: () => null,
    isRouteActive: () => false,
  }), sink);
  const methods = sink.calls.map(c => c.method);
  assert.ok(methods.includes('paintLoading'), 'spinner shown before navigation');
  assert.ok(!methods.includes('paintFresh'), 'in-flight result must not commit');
  assert.ok(!methods.includes('paintNotFound'), 'in-flight result must not commit');
});

test('slug route: social-proof fold-in when zaps arrive', async () => {
  const essay = makeEssay();
  const sink = makeSink();
  await loadEssayPageBySlug(SLUG, makeSlugPorts({
    fetchEssayByCoordinate: async () => essay,
    fetchSocialProof: async () => SOME_SOCIAL_PROOF,
  }), sink);
  const foldCall = sink.calls.find(c => c.method === 'foldInSocialProof');
  assert.ok(foldCall, 'foldInSocialProof must be called when social proof is non-zero');
  assert.equal(foldCall.socialProof.totalSats, 1000);
  assert.equal(foldCall.socialProof.heartCount, 3);
});
