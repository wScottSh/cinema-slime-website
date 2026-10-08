// RelayPort — the single external seam EssayVault uses to talk to relays.
//
// { publish(relays, event), collect(relays, filter, { maxWait, settleMs }) }
//
// This generalizes the existing injected-`pool` pattern (nostr-pool.js,
// relay-collect.js) into the two operations EssayVault needs: broadcasting a
// captured event to the writer relays, and reading a coordinate back from the
// reader relays to confirm it round-trips. Production wraps SimplePool;
// EssayVault's tests use an in-memory adapter instead (see essay-vault.test.js).
import { collectEvents } from './relay-collect.js';

// Wrap a SimplePool (or any pool exposing `.publish` and the subscribeMany
// shape collectEvents expects) as a RelayPort. The pool is injected so this
// module never constructs its own WebSocket connections.
export function createRelayPort(pool) {
  return {
    // Broadcast `event` to every relay in `relays`. Best-effort: a relay that
    // rejects or fails to connect does not fail the whole publish — presence
    // is judged later by reading the event back, not by write acknowledgement.
    // Resolves to each relay's outcome, in relay order, for callers that
    // report them.
    async publish(relays, event) {
      const settled = await Promise.allSettled(pool.publish(relays, event));
      return relays.map((relay, i) => ({
        relay,
        ok: settled[i].status === 'fulfilled',
        reason: settled[i].status === 'rejected' ? String(settled[i].reason?.message ?? settled[i].reason) : null,
      }));
    },

    // Read events matching `filter` back from `relays`. Delegates to the
    // existing early-settle collector (see ADR 0007) so read-back has the
    // same latency behavior as the site's own Essay fetches.
    collect(relays, filter, { maxWait = 6000, settleMs = 800 } = {}) {
      return collectEvents(pool, relays, filter, { maxWait, settleMs });
    },
  };
}
