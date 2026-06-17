// Returns an apply/hold decision for a background data revalidation.
// All inputs are plain data — no DOM, no globals — making the policy pure and testable.
// idKey: the property name used to detect identity changes (e.g. 'guid' for Episodes,
// 'coordinate' for Essays). Defaults to 'guid' for backward compatibility.
export function shouldApplyFreshData({ cached, fresh, interacting, idKey = 'guid' }) {
  if (cached === undefined) {
    return { decision: 'apply' };
  }
  if (!itemsChanged(cached, fresh, idKey)) {
    return { decision: 'hold', reason: 'no-change' };
  }
  if (interacting.searching || interacting.scrolled) {
    return { decision: 'hold', reason: 'interacting' };
  }
  return { decision: 'apply' };
}

// Decide how an Essay Page responds to fresh relay data when a cached copy may
// already be on screen (SWR, ADR 0006). Pure data in → verdict out:
//   'render-fresh' — paint the fresh essay (cold load, edit, or social proof arrived)
//   'keep-current' — nothing changed, or relays failed and the cached copy stands
//   'not-found'    — nothing to show, or the brand decurated the essay
// Fail-closed nuance: an empty curation is indistinguishable from a relay
// failure, so it only yields 'not-found' when there is no cached copy — a
// last-good copy is never evicted on ambiguous evidence.
export function decideEssayPageRevalidation({ cachedEventId, freshEventId, isOfficial, essayFetched, curationSize, socialProofChanged }) {
  const hasCached = cachedEventId != null;
  if (isOfficial) {
    if (hasCached && freshEventId === cachedEventId && !socialProofChanged) {
      return 'keep-current';
    }
    return 'render-fresh';
  }
  if (!hasCached) return 'not-found';
  if (essayFetched && curationSize > 0) return 'not-found';
  return 'keep-current';
}

function itemsChanged(prev, next, idKey) {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i][idKey] !== next[i][idKey]) return true;
  }
  return false;
}
