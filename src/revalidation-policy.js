// Returns an apply/hold decision for a background Episode revalidation.
// All inputs are plain data — no DOM, no globals — making the policy pure and testable.
export function shouldApplyFreshData({ cached, fresh, interacting }) {
  if (cached === undefined) {
    return { decision: 'apply' };
  }
  if (!episodesChanged(cached, fresh)) {
    return { decision: 'hold', reason: 'no-change' };
  }
  if (interacting.searching || interacting.scrolled) {
    return { decision: 'hold', reason: 'interacting' };
  }
  return { decision: 'apply' };
}

function episodesChanged(prev, next) {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].guid !== next[i].guid) return true;
  }
  return false;
}
