import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { runPresenceAudit } from '../scripts/check-curation.mjs';
import { createEssayVault } from './essay-vault.js';

// ─── runPresenceAudit — the read-only Guaranteed Presence audit (#160) ─────
//
// This is the read-only reporting counterpart to runPublishWorkflow (#158):
// it must report each Official Essay as openable/unavailable based on a real
// read-back through EssayVault.verifyPresence, never broadcast, exit-worthy
// (ok === false) on any gap, and name every failing coordinate — not just the
// first. Uses the same in-memory RelayPort pattern as essay-vault.test.js and
// publish-curation.test.js so the exact walled-garden (Idaho) failure is
// reproduced deterministically without touching real relays.

function makeEssayEvent({ sk, identifier = 'test-essay', createdAt, content = 'Hello.' }) {
  return finalizeEvent(
    {
      kind: 30023,
      created_at: createdAt ?? Math.floor(Date.now() / 1000),
      tags: [['d', identifier]],
      content,
    },
    sk,
  );
}

function createInMemoryRelayPort(seed = {}) {
  const relays = new Map(Object.entries(seed).map(([url, events]) => [url, [...events]]));

  function matches(event, filter) {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    const dFilter = filter['#d'];
    if (dFilter) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (!dFilter.includes(dTag)) return false;
    }
    return true;
  }

  return {
    publishCalls: [],
    async publish(publishRelays, event) {
      this.publishCalls.push({ relays: publishRelays, event });
      for (const url of publishRelays) {
        const list = relays.get(url) ?? [];
        if (!list.some((e) => e.id === event.id)) list.push(event);
        relays.set(url, list);
      }
    },
    async collect(readRelays, filter) {
      const found = new Map();
      for (const url of readRelays) {
        for (const event of relays.get(url) ?? []) {
          if (matches(event, filter)) found.set(event.id, event);
        }
      }
      return [...found.values()];
    },
  };
}

function createInMemoryVaultStore() {
  const byCoordinate = new Map();
  return {
    load(coordinate) {
      return byCoordinate.get(coordinate) ?? null;
    },
    save(coordinate, event) {
      byCoordinate.set(coordinate, event);
    },
  };
}

const READER_RELAYS = ['wss://reader-a.test', 'wss://reader-b.test'];

test('runPresenceAudit rejects a malformed call before touching the vault', async () => {
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });

  await assert.rejects(() => runPresenceAudit({ vault }), /essays must be an array/);
  await assert.rejects(() => runPresenceAudit({ essays: [{ coordinate: 'x' }] }), /vault must implement/);
  await assert.rejects(() => runPresenceAudit({ essays: [{}], vault }), /has no coordinate/);
});

test('runPresenceAudit reports a captured, reachable Essay as openable', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk });
  const relayPort = createInMemoryRelayPort();
  const vault = createEssayVault({ relayPort, store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });
  const coordinate = vault.captureEssay(event);
  await vault.ensurePresence([coordinate]); // mirror it onto the reader relays first

  const audit = await runPresenceAudit({ essays: [{ coordinate }], vault });

  assert.equal(audit.ok, true);
  assert.deepEqual(audit.unavailable, []);
  assert.deepEqual(audit.report, [{ coordinate, status: 'openable', reason: null }]);
});

test('runPresenceAudit reports an Essay with no captured body as unavailable, not skipped', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const coordinate = `30023:${pubkey}:never-captured`;
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });

  const audit = await runPresenceAudit({ essays: [{ coordinate }], vault });

  assert.equal(audit.ok, false);
  assert.deepEqual(audit.unavailable, [coordinate]);
  assert.equal(audit.report.length, 1, 'the uncaptured Essay is reported, never dropped from the report');
  assert.equal(audit.report[0].status, 'unavailable');
  assert.equal(audit.report[0].reason, 'not-captured');
});

test('runPresenceAudit reproduces the Idaho walled-garden failure: captured but unmirrored is unavailable', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk, identifier: 'my-own-private-idaho-x-1991' });
  const store = createInMemoryVaultStore();

  // The event exists somewhere (a walled-garden relay outside the reader
  // set), and the brand has captured it into the vault, but it was never
  // mirrored onto the reader relays — exactly the Idaho failure.
  const relayPort = createInMemoryRelayPort({ 'wss://walled-garden.test': [event] });
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });
  const coordinate = vault.captureEssay(event);

  const audit = await runPresenceAudit({ essays: [{ coordinate }], vault });

  assert.equal(audit.ok, false);
  assert.deepEqual(audit.unavailable, [coordinate]);
  assert.equal(audit.report[0].status, 'unavailable');
  assert.equal(audit.report[0].reason, 'unreachable');
  assert.equal(relayPort.publishCalls.length, 0, 'runPresenceAudit never broadcasts');
});

test('runPresenceAudit names every failing coordinate, not just the first', async () => {
  const skA = generateSecretKey();
  const skB = generateSecretKey();
  const coordA = `30023:${getPublicKey(skA)}:essay-a`;
  const coordB = `30023:${getPublicKey(skB)}:essay-b`;
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });

  const audit = await runPresenceAudit({ essays: [{ coordinate: coordA }, { coordinate: coordB }], vault });

  assert.equal(audit.ok, false);
  assert.deepEqual(new Set(audit.unavailable), new Set([coordA, coordB]));
});

test('runPresenceAudit reports a mix of openable and unavailable Essays independently', async () => {
  const skOpen = generateSecretKey();
  const skGone = generateSecretKey();
  const openEvent = makeEssayEvent({ sk: skOpen, identifier: 'reachable' });
  const store = createInMemoryVaultStore();
  const relayPort = createInMemoryRelayPort();
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });

  const openCoord = vault.captureEssay(openEvent);
  await vault.ensurePresence([openCoord]);
  const goneCoord = `30023:${getPublicKey(skGone)}:never-captured`;

  const audit = await runPresenceAudit({ essays: [{ coordinate: openCoord }, { coordinate: goneCoord }], vault });

  assert.equal(audit.ok, false);
  assert.deepEqual(audit.unavailable, [goneCoord]);
  const byCoord = new Map(audit.report.map((e) => [e.coordinate, e.status]));
  assert.equal(byCoord.get(openCoord), 'openable');
  assert.equal(byCoord.get(goneCoord), 'unavailable');
});

test('runPresenceAudit never broadcasts, even when every Essay is captured and reachable', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk });
  const relayPort = createInMemoryRelayPort();
  const vault = createEssayVault({ relayPort, store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });
  const coordinate = vault.captureEssay(event);
  await vault.ensurePresence([coordinate]);
  relayPort.publishCalls.length = 0; // reset — only assert on the audit call itself

  await runPresenceAudit({ essays: [{ coordinate }], vault });

  assert.equal(relayPort.publishCalls.length, 0);
});
