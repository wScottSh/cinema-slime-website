// Early-settle event collection over a relay pool (see ADR 0007).
//
// SimplePool.querySync resolves only when EVERY relay has sent EOSE (or the
// whole maxWait expires). In practice some default relays never EOSE for our
// queries, so every cold load used to burn the full maxWait even though the
// data had already arrived from the fastest relay within a second.
//
// collectEvents trades exhaustiveness for latency: it resolves as soon as the
// event stream goes quiet. The pool is injected so this module never touches
// nostr-tools or a WebSocket.
//
// Resolves with the (relay-deduplicated) events collected so far when the
// first of these fires:
//   1. every relay has EOSE'd or closed (the complete answer),
//   2. settleMs has passed since the last event arrived (the stream went
//      quiet — trailing relays would only duplicate replaceable events), or
//   3. maxWait has elapsed (hard cap; also the only exit when no relay
//      delivers anything).
export function collectEvents(pool, relays, filter, { maxWait, settleMs }) {
  return new Promise((resolve) => {
    const events = [];
    let settleTimer = null;
    let done = false;
    let sub = null;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      try {
        sub?.close();
      } catch {
        /* ignore close errors */
      }
      resolve(events);
    };

    const maxTimer = setTimeout(finish, maxWait);
    try {
      sub = pool.subscribeMany(relays, filter, {
        maxWait,
        onevent(event) {
          if (done) return; // the resolved array must not grow afterwards
          events.push(event);
          clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, settleMs);
        },
        oneose: finish,
        onclose: finish,
      });
    } catch {
      finish();
    }
  });
}
