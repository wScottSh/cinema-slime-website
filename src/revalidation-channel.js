import { shouldApplyFreshData } from './revalidation-policy.js';

// Factory that owns the { cached, pending } state for one background-revalidation
// source and delegates the apply/hold decision to shouldApplyFreshData. Each source
// (Episodes, Essays) creates its own instance and injects its own apply(freshData)
// callback. Flush triggers (navigation, search-clear) call flush() at their call sites.
export function createRevalidationChannel({ apply, idKey = 'guid' }) {
  let cached = undefined;
  let pending = null;

  function seed(value) {
    cached = value;
  }

  function receive(fresh, interacting) {
    const { decision, reason } = shouldApplyFreshData({ cached, fresh, interacting, idKey });
    if (decision === 'apply') {
      cached = fresh;
      pending = null;
      apply(fresh);
      return true;
    }
    if (reason === 'interacting') {
      pending = fresh;
    }
    return false;
  }

  function flush() {
    if (!pending) return;
    const data = pending;
    pending = null;
    cached = data;
    apply(data);
  }

  return { seed, receive, flush };
}
