import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { createEssayVault } from './essay-vault.js';
import { captureEssayFromInput, resolveRawEvent } from './curate-capture.js';

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

// Minimal in-memory RelayPort keyed by relay URL (same pattern as
// essay-vault.test.js) so pointer-input resolution can be tested without a
// real network.
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
    collectCalls: [],
    async publish() {
      throw new Error('curate-capture never publishes — it only resolves and captures');
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

function makeVault(relayPort) {
  return createEssayVault({
    relayPort: relayPort ?? createInMemoryRelayPort(),
    store: createInMemoryVaultStore(),
    readerRelays: READER_RELAYS,
  });
}

// ─── rawEvent input ─────────────────────────────────────────────────────────

test('captureEssayFromInput captures a raw signed event object directly (no relay fetch)', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const event = makeEssayEvent({ sk, identifier: 'raw-object' });
  const relayPort = createInMemoryRelayPort();
  const vault = makeVault(relayPort);

  const coordinate = await captureEssayFromInput({ rawEvent: event }, { vault, relayPort });

  assert.equal(coordinate, `30023:${pubkey}:raw-object`);
  assert.equal(relayPort.collectCalls.length, 0, 'raw bytes need no network fetch');
});

test('captureEssayFromInput captures a raw signed event given as a JSON string (Primal "Copy Raw Data")', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk, identifier: 'raw-json' });
  const vault = makeVault();

  const coordinate = await captureEssayFromInput({ rawEvent: JSON.stringify(event) }, { vault });

  assert.equal(coordinate, `30023:${event.pubkey}:raw-json`);
});

test('captureEssayFromInput refuses an invalid signature even when bytes were obtained directly', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk });
  const tampered = { ...JSON.parse(JSON.stringify(event)), content: 'tampered' };
  const vault = makeVault();

  await assert.rejects(() => captureEssayFromInput({ rawEvent: tampered }, { vault }), /invalid signature/);
});

test('captureEssayFromInput refuses a raw event of the wrong kind', async () => {
  const sk = generateSecretKey();
  const wrongKindEvent = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'not an essay' }, sk);
  const vault = makeVault();

  await assert.rejects(() => captureEssayFromInput({ rawEvent: wrongKindEvent }, { vault }), /expected kind 30023/);
});

test('captureEssayFromInput refuses a mispasted raw event whose coordinate does not match a co-supplied coordinate', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk, identifier: 'not-what-you-think' });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });
  const claimedCoordinate = `30023:${event.pubkey}:the-intended-essay`;

  await assert.rejects(
    () => captureEssayFromInput({ rawEvent: event, coordinate: claimedCoordinate }, { vault }),
    /does not match the expected coordinate/,
  );
  assert.equal(store.load(`30023:${event.pubkey}:not-what-you-think`), null, 'nothing is written on a coordinate mismatch');
});

test('captureEssayFromInput refuses a mispasted raw event whose coordinate does not match a co-supplied naddr', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const event = makeEssayEvent({ sk, identifier: 'not-what-you-think' });
  const naddr = nip19.naddrEncode({ kind: 30023, pubkey, identifier: 'the-intended-essay', relays: [] });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  await assert.rejects(
    () => captureEssayFromInput({ rawEvent: event, naddr }, { vault }),
    /does not match the expected coordinate/,
  );
});

// ─── naddr input ────────────────────────────────────────────────────────────

test('captureEssayFromInput resolves an naddr using its embedded relay hints, then captures', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const event = makeEssayEvent({ sk, identifier: 'from-naddr' });
  const relayPort = createInMemoryRelayPort({ 'wss://hint.test': [event] });
  const naddr = nip19.naddrEncode({ kind: 30023, pubkey, identifier: 'from-naddr', relays: ['wss://hint.test'] });
  const vault = makeVault(relayPort);

  const coordinate = await captureEssayFromInput({ naddr }, { vault, relayPort });

  assert.equal(coordinate, `30023:${pubkey}:from-naddr`);
  assert.deepEqual(relayPort.collectCalls[0].relays, ['wss://hint.test']);
});

test('captureEssayFromInput refuses an naddr with no relay hints and no extraRelays', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const naddr = nip19.naddrEncode({ kind: 30023, pubkey, identifier: 'no-hints', relays: [] });
  const vault = makeVault();

  await assert.rejects(
    () => captureEssayFromInput({ naddr }, { vault, relayPort: createInMemoryRelayPort() }),
    /no relays to fetch/,
  );
});

test('captureEssayFromInput refuses an naddr whose hinted relays do not actually hold the event', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const naddr = nip19.naddrEncode({ kind: 30023, pubkey, identifier: 'unobtainable', relays: ['wss://empty.test'] });
  const relayPort = createInMemoryRelayPort({ 'wss://empty.test': [] });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });

  await assert.rejects(() => captureEssayFromInput({ naddr }, { vault, relayPort }), /could not obtain the signed event/);
  assert.equal(store.load(`30023:${pubkey}:unobtainable`), null, 'nothing is written when bytes are unobtainable');
});

// ─── coordinate + explicit relays input ────────────────────────────────────

test('captureEssayFromInput resolves a bare coordinate using explicit relays, then captures', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const event = makeEssayEvent({ sk, identifier: 'from-coordinate' });
  const coordinate = `30023:${pubkey}:from-coordinate`;
  const relayPort = createInMemoryRelayPort({ 'wss://explicit.test': [event] });
  const vault = makeVault(relayPort);

  const captured = await captureEssayFromInput(
    { coordinate, relays: ['wss://explicit.test'] },
    { vault, relayPort },
  );

  assert.equal(captured, coordinate);
});

test('captureEssayFromInput refuses a bare coordinate with no explicit relays — a pointer with no obtainable bytes', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const coordinate = `30023:${pubkey}:pointer-only`;
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  await assert.rejects(
    () => captureEssayFromInput({ coordinate }, { vault, relayPort: createInMemoryRelayPort() }),
    /no relays to fetch/,
  );
  assert.equal(store.load(coordinate), null, 'nothing is written when bytes are unobtainable');
});

test('captureEssayFromInput refuses a malformed coordinate', async () => {
  const vault = makeVault();
  await assert.rejects(
    () => captureEssayFromInput({ coordinate: 'not-a-coordinate', relays: ['wss://a.test'] }, { vault }),
    /malformed coordinate/,
  );
});

test('captureEssayFromInput refuses a coordinate whose kind is not 30023', async () => {
  const vault = makeVault();
  const badCoordinate = `1:${'a'.repeat(64)}:not-an-essay`;
  await assert.rejects(
    () => captureEssayFromInput({ coordinate: badCoordinate, relays: ['wss://a.test'] }, { vault }),
    /expected kind 30023/,
  );
});

// ─── mismatched coordinate refusal (fetched event doesn't match its pointer) ─

test('captureEssayFromInput refuses when the fetched event does not actually match the requested coordinate', async () => {
  // A relay could (maliciously or by bug) answer with an event under a
  // different "d" tag than the filter asked for; captureEssay's own
  // expectedCoordinate check must still catch it.
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const wrongEvent = makeEssayEvent({ sk, identifier: 'actually-this-one' });
  const relayPort = {
    async publish() {},
    async collect() {
      return [wrongEvent];
    },
  };
  const coordinate = `30023:${pubkey}:requested-one`;
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });

  await assert.rejects(
    () => captureEssayFromInput({ coordinate, relays: ['wss://sneaky.test'] }, { vault, relayPort }),
    /does not match the expected coordinate/,
  );
  assert.equal(store.load(coordinate), null);
});

// ─── idempotent re-capture through the same seam ───────────────────────────

test('captureEssayFromInput re-capture of an updated Essay is idempotent — newest created_at wins', async () => {
  const sk = generateSecretKey();
  const older = makeEssayEvent({ sk, identifier: 'evolving', createdAt: 1000, content: 'v1' });
  const newer = makeEssayEvent({ sk, identifier: 'evolving', createdAt: 2000, content: 'v2' });
  const store = createInMemoryVaultStore();
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store, readerRelays: READER_RELAYS });

  const coordinate = await captureEssayFromInput({ rawEvent: newer }, { vault });
  await captureEssayFromInput({ rawEvent: older }, { vault });

  assert.equal(store.load(coordinate).content, 'v2');
});

// ─── resolveRawEvent picks the newest of several relay candidates ──────────

test('resolveRawEvent prefers the newest of several relay candidates for the same coordinate', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const older = makeEssayEvent({ sk, identifier: 'multi', createdAt: 1000, content: 'v1' });
  const newer = makeEssayEvent({ sk, identifier: 'multi', createdAt: 2000, content: 'v2' });
  const relayPort = createInMemoryRelayPort({
    'wss://relay-a.test': [older],
    'wss://relay-b.test': [newer],
  });

  const { event, expectedCoordinate } = await resolveRawEvent(
    { coordinate: `30023:${pubkey}:multi`, relays: ['wss://relay-a.test', 'wss://relay-b.test'] },
    { relayPort },
  );

  assert.equal(event.content, 'v2');
  assert.equal(expectedCoordinate, `30023:${pubkey}:multi`);
});

// ─── input validation ───────────────────────────────────────────────────────

test('captureEssayFromInput requires a vault implementing captureEssay', async () => {
  await assert.rejects(() => captureEssayFromInput({ rawEvent: '{}' }, {}), /vault must implement/);
});

test('resolveRawEvent rejects an input with none of rawEvent/naddr/coordinate', async () => {
  await assert.rejects(() => resolveRawEvent({}), /must provide rawEvent, naddr, or coordinate/);
});
