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
