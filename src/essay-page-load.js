import { parseCoordinate } from './essay-coordinate.js';
import { selectCuratedEssay } from './essay-curation.js';
import { decideEssayPageRevalidation } from './revalidation-policy.js';

const ZERO_SOCIAL_PROOF = { totalSats: 0, largestZap: 0, heartCount: 0 };

// Runs the Essay Page load lifecycle for a coordinate route.
//
// ports: injected fetchers and state lookup (testable without relay or DOM)
//   fetchEssayByCoordinate(coordinate) → essay | null
//   fetchCurationList()                → curation
//   fetchSocialProof(coordinateString) → { totalSats, largestZap, heartCount }
//   getCachedEssay(coordinateString)   → essay | null
//   isRouteActive(coordinateString)    → boolean
//
// sink: view callbacks (DOM-painting in production, recording stubs in tests)
//   paintCached(essay)                              — first-frame SWR fast-paint
//   paintLoading()                                  — spinner (cold load)
//   paintFresh(official, socialProof, { restoreScroll }) — relay result
//   paintNotFound(coordinateString)                 — unavailable
//   foldInSocialProof(official, socialProof)        — social proof fold-in post-body
export async function loadEssayPageByCoordinate(coordinateString, ports, sink) {
  const {
    fetchEssayByCoordinate,
    fetchCurationList,
    fetchSocialProof,
    getCachedEssay,
    isRouteActive,
  } = ports;
  const {
    paintCached,
    paintLoading,
    paintFresh,
    paintNotFound,
    foldInSocialProof,
  } = sink;

  const coordinate = parseCoordinate(coordinateString);
  if (!coordinate) {
    paintNotFound(coordinateString);
    return;
  }

  // SWR: if Discovery has already cached this essay, paint on the first frame
  // instead of showing the spinner — relays only revalidate.
  const cached = getCachedEssay(coordinateString);
  if (cached) {
    paintCached(cached);
  } else {
    paintLoading();
  }

  // Start social proof in parallel; don't let it gate the body paint.
  const socialProofPromise = fetchSocialProof(coordinateString);

  // Fetch essay content and curation list in parallel.
  const [essay, curation] = await Promise.all([
    fetchEssayByCoordinate(coordinate),
    fetchCurationList(),
  ]);

  // Route-active guard: user may have navigated away while awaiting relays.
  if (!isRouteActive(coordinateString)) return;

  // Gate on curation: only a curated coordinate renders as an Official Essay.
  const official = selectCuratedEssay(essay, curation);

  const bodyDecision = decideEssayPageRevalidation({
    cachedEventId: cached?.eventId ?? null,
    freshEventId: official?.eventId ?? null,
    isOfficial: Boolean(official),
    essayFetched: Boolean(essay),
    curationSize: curation?.coordinates?.size ?? 0,
    socialProofChanged: false,
  });

  if (bodyDecision === 'not-found') {
    paintNotFound(coordinateString);
    return;
  }
  if (bodyDecision === 'render-fresh') {
    paintFresh(official, ZERO_SOCIAL_PROOF, { restoreScroll: Boolean(cached) });
  }
  // 'keep-current': cached copy stands, no DOM change needed.

  // Phase 2: social proof arrives after the body; fold it in without gating paint.
  if (!official) return;
  const socialProof = await socialProofPromise;
  if (!isRouteActive(coordinateString)) return;

  const socialDecision = decideEssayPageRevalidation({
    cachedEventId: official.eventId,
    freshEventId: official.eventId,
    isOfficial: true,
    essayFetched: true,
    curationSize: curation?.coordinates?.size ?? 0,
    socialProofChanged: socialProof.totalSats > 0 || socialProof.heartCount > 0,
  });

  if (socialDecision === 'render-fresh') {
    foldInSocialProof(official, socialProof);
  }
}

// Runs the Essay Page load lifecycle for a slug route.
//
// The slug path adds one serial hop before the shared coordinate lifecycle:
// it resolves the brand slug → coordinate via the Curation list.
//
// ports: same shape as loadEssayPageByCoordinate except:
//   getCachedEssay(slug)   — looks up the Discovery cache by slug, not coordinate
//   isRouteActive(slug)    — checks by slug throughout (the URL shows the slug)
//   fetchCurationList, fetchEssayByCoordinate, fetchSocialProof — unchanged
//
// sink: same as loadEssayPageByCoordinate
export async function loadEssayPageBySlug(slug, ports, sink) {
  const {
    fetchCurationList,
    fetchEssayByCoordinate,
    fetchSocialProof,
    getCachedEssay,
    isRouteActive,
  } = ports;
  const { paintCached, paintLoading, paintNotFound } = sink;

  // SWR fast path: Discovery entries carry the brand slug, so a cached essay
  // paints immediately even before the serial slug → coordinate hop resolves.
  const cached = getCachedEssay(slug);
  if (cached) {
    paintCached(cached);
  } else {
    paintLoading();
  }

  // Fetch curation list to resolve slug → coordinate (serial; coordinate is
  // required before essay fetch or social proof can begin).
  const curation = await fetchCurationList();

  // Route-active guard: user may have navigated away while awaiting curation.
  if (!isRouteActive(slug)) return;

  const coordinateString = curation.slugToCoordinate?.get(slug);
  if (!coordinateString) {
    // Fail-closed: an empty curation signals relay failure, not a definitive
    // removal. Keep a cached copy on screen rather than flashing not-found.
    if (cached && !(curation.coordinates?.size > 0)) return;
    paintNotFound(slug);
    return;
  }

  // Delegate to the shared coordinate lifecycle. Pass the already-fetched
  // curation (avoids a second fetch) and close over the slug for all
  // route-active checks (the URL shows the slug, not the coordinate).
  // Suppress the initial-paint calls — we already painted above by slug.
  await loadEssayPageByCoordinate(coordinateString, {
    fetchEssayByCoordinate,
    fetchCurationList: async () => curation,
    fetchSocialProof,
    getCachedEssay: () => cached,
    isRouteActive: () => isRouteActive(slug),
  }, {
    ...sink,
    paintCached: () => {},
    paintLoading: () => {},
  });
}
