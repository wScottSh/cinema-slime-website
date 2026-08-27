import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { createEssayVault } from './essay-vault.js';

// ─── Test fixtures ──────────────────────────────────────────────────────────

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

// An in-memory RelayPort keyed by relay URL, each holding its own list of
// events. This is the prior-art pattern (fakeImmediatePool in
// nostr-pool.test.js) generalized to publish + collect: it can model a
// "walled garden" relay that is never part of the reader set, reproducing the
// exact Idaho failure deterministically.
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
    collectCalls: [],
    async publish(publishRelays, event) {
      this.publishCalls.push({ relays: publishRelays, event });
      for (const url of publishRelays) {
        const list = relays.get(url) ?? [];
        if (!list.some((e) => e.id === event.id)) list.push(event);
        relays.set(url, list);
      }
    },
    async collect(readRelays, filter) {
      this.collectCalls.push({ relays: readRelays, filter });
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

// ─── captureEssay ───────────────────────────────────────────────────────────

test('captureEssay stores a valid event verbatim and returns its coordinate', () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const event = makeEssayEvent({ sk, identifier: 'my-essay' });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  const coordinate = vault.captureEssay(event);

  assert.equal(coordinate, `30023:${pubkey}:my-essay`);
  assert.deepEqual(store.load(coordinate), event, 'stored event is byte-identical to the captured original');
});

test('captureEssay accepts a raw JSON string (e.g. pasted "Copy Raw Data")', () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk, identifier: 'json-essay' });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  const coordinate = vault.captureEssay(JSON.stringify(event));

  assert.deepEqual(store.load(coordinate), event);
});

test('captureEssay rejects an event with an invalid signature', () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk });
  // Round-trip through JSON so the tampered copy does not inherit
  // finalizeEvent's internal "already verified" cache symbol (plain object
  // spread would carry it over, masking the tamper from verifyEvent).
  const tampered = { ...JSON.parse(JSON.stringify(event)), content: 'tampered content, signature no longer matches' };
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  assert.throws(() => vault.captureEssay(tampered), /invalid signature/);
  assert.equal(store.load(`30023:${event.pubkey}:test-essay`), null, 'nothing is stored on rejection');
});

test('captureEssay rejects the wrong kind', () => {
  const sk = generateSecretKey();
  const event = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'not an essay' }, sk);
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  assert.throws(() => vault.captureEssay(event), /expected kind 30023/);
});

test('captureEssay rejects an event with no "d" tag', () => {
  const sk = generateSecretKey();
  const event = finalizeEvent({ kind: 30023, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'no identifier' }, sk);
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  assert.throws(() => vault.captureEssay(event), /no "d" tag/);
});

test('captureEssay refuses a mispasted event whose computed coordinate does not match the expected one', () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk, identifier: 'not-idaho' });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });
  const expected = `30023:${event.pubkey}:my-own-private-idaho-x-1991`;

  assert.throws(() => vault.captureEssay(event, expected), /does not match the expected coordinate/);
  assert.equal(store.load(`30023:${event.pubkey}:not-idaho`), null, 'nothing is stored when the coordinate check fails');
});

test('captureEssay is idempotent per coordinate — newest created_at wins', () => {
  const sk = generateSecretKey();
  const older = makeEssayEvent({ sk, identifier: 'evolving', createdAt: 1000, content: 'v1' });
  const newer = makeEssayEvent({ sk, identifier: 'evolving', createdAt: 2000, content: 'v2' });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  const coordinate = vault.captureEssay(newer);
  vault.captureEssay(older); // stale re-capture must not clobber the newer copy

  assert.equal(store.load(coordinate).content, 'v2');
});

// ─── verifyPresence / ensurePresence — the Idaho walled-garden reproduction ─

test('verifyPresence reports not-ok for a captured Essay unreachable from the reader set; ensurePresence makes it reachable', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk, identifier: 'my-own-private-idaho-x-1991' });
  const store = createInMemoryVaultStore();

  // The exact Idaho shape: the event exists somewhere (a walled-garden relay
  // that mimics Primal's own cache), but nowhere the reader set serves.
  const relayPort = createInMemoryRelayPort({ 'wss://walled-garden.test': [event] });
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });

  const coordinate = vault.captureEssay(event);

  const before = await vault.verifyPresence([coordinate]);
  assert.equal(before.ok, false);
  assert.deepEqual(before.missing, [coordinate]);
  assert.equal(relayPort.publishCalls.length, 0, 'verifyPresence never broadcasts');

  const mirrored = await vault.ensurePresence([coordinate]);
  assert.equal(mirrored.ok, true);
  assert.deepEqual(mirrored.missing, []);
  assert.equal(relayPort.publishCalls.length, 1, 'ensurePresence broadcasts exactly once per coordinate');
  assert.deepEqual(relayPort.publishCalls[0].event, event, 'the mirrored event is byte-identical to the captured original — never re-signed');

  const after = await vault.verifyPresence([coordinate]);
  assert.equal(after.ok, true, 'the read-only check now confirms presence too — the two paths cannot drift');
});

test('ensurePresence reports an uncaptured coordinate as a failure rather than skipping it', async () => {
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  const report = await vault.ensurePresence(['30023:' + 'a'.repeat(64) + ':never-captured']);

  assert.equal(report.ok, false);
  assert.equal(report.entries[0].reason, 'not-captured');
});

test('verifyPresence never broadcasts, even for a captured coordinate', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk });
  const store = createInMemoryVaultStore();
  const relayPort = createInMemoryRelayPort();
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });

  const coordinate = vault.captureEssay(event);
  await vault.verifyPresence([coordinate]);

  assert.equal(relayPort.publishCalls.length, 0);
});

test('verifyPresence treats a newer signature-valid event at the same coordinate as present (kind:30023 is replaceable)', async () => {
  const sk = generateSecretKey();
  const original = makeEssayEvent({ sk, identifier: 'evolving', createdAt: 1000 });
  const updated = makeEssayEvent({ sk, identifier: 'evolving', createdAt: 2000, content: 'a newer version, published directly by the author' });
  const store = createInMemoryVaultStore();
  const coordinate = `30023:${original.pubkey}:evolving`;
  store.save(coordinate, original); // vault still holds the older captured copy

  // The reader relays already serve the author's newer version directly —
  // the brand never re-captured it, but the coordinate is still readable.
  const relayPort = createInMemoryRelayPort({ [READER_RELAYS[0]]: [updated] });
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });

  const report = await vault.verifyPresence([coordinate]);

  assert.equal(report.ok, true);
});

test('ensurePresence is idempotent — re-running after success stays ok and dedupes by event id', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk });
  const store = createInMemoryVaultStore();
  const relayPort = createInMemoryRelayPort();
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });
  const coordinate = vault.captureEssay(event);

  const first = await vault.ensurePresence([coordinate]);
  const second = await vault.ensurePresence([coordinate]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  // The in-memory relay dedupes by id on publish, so a relay never ends up
  // holding two copies of the same event across repeated runs.
});
