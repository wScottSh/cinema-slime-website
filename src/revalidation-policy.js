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

function itemsChanged(prev, next, idKey) {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i][idKey] !== next[i][idKey]) return true;
  }
  return false;
}
