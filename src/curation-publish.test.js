import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runPublishWorkflow, essayHarvestFilter, selectNewestEssayEvents, harvestEssays,
  readCuration, saveLocalCuration, signCuration,
} from './curation-publish.js';
import { createEssayVault } from './essay-vault.js';
import { curationFromEvent } from './curation.js';

// ─── readCuration / signCuration ───────────────────────────────────────────

const BRAND_SK = generateSecretKey();
const BRAND = getPublicKey(BRAND_SK);
const coordinateA = `30023:${'ab'.repeat(32)}:a`;
const coordinateB = `30023:${'ab'.repeat(32)}:b`;

function curationEvent({ sk = BRAND_SK, createdAt, coordinates }) {
  return finalizeEvent({
    kind: 30001,
    created_at: createdAt,
    tags: [['d', 'cinema-slime-essays'], ...coordinates.map((c, i) => ['a', c, '', `slug-${i}`])],
    content: '',
  }, sk);
}

const relayAnswering = (events) => ({ async collect() { return events; } });
const localPathIn = async () => join(await mkdtemp(join(tmpdir(), 'curation-')), 'curation.json');

test('readCuration picks the newest brand-signed Curation across relays and the local copy', async () => {
  const localPath = await localPathIn();
  const older = curationEvent({ createdAt: 100, coordinates: [coordinateA] });
  const newer = curationEvent({ createdAt: 200, coordinates: [coordinateA, coordinateB] });
  await saveLocalCuration(localPath, newer);
  const curation = await readCuration({ relayPort: relayAnswering([older]), author: BRAND, localPath });
  assert.equal(curation.eventId, newer.id);
  assert.equal(curation.entries.length, 2);
});

test('readCuration ignores lists signed by anyone else, or tampered', async () => {
  const localPath = await localPathIn();
  const impostor = curationEvent({ sk: generateSecretKey(), createdAt: 300, coordinates: [] });
  const tampered = { ...JSON.parse(JSON.stringify(curationEvent({ createdAt: 400, coordinates: [] }))), pubkey: BRAND, created_at: 401 };
  const real = curationEvent({ createdAt: 100, coordinates: [coordinateA] });
  const curation = await readCuration({ relayPort: relayAnswering([impostor, tampered, real]), author: BRAND, localPath });
  assert.equal(curation.eventId, real.id);
});

test('readCuration returns null when nothing answers, so the caller can refuse', async () => {
  const localPath = await localPathIn();
  const failing = { async collect() { throw new Error('offline'); } };
  assert.equal(await readCuration({ relayPort: failing, author: BRAND, localPath }), null);
  assert.equal(await readCuration({ relayPort: relayAnswering([]), author: BRAND, localPath }), null);
});

test('signCuration always replaces the Curation it was edited from, even with a slow clock', () => {
  const previous = curationFromEvent(curationEvent({ createdAt: 5000, coordinates: [coordinateA] }));
  assert.equal(signCuration(previous, { secretKey: BRAND_SK, nowSec: 4000 }).created_at, 5001);
  const signed = signCuration(previous, { secretKey: BRAND_SK, nowSec: 9000 });
  assert.equal(signed.created_at, 9000);
  assert.deepEqual(curationFromEvent(signed).entries, previous.entries);
});

// ─── runPublishWorkflow — the Guaranteed Presence gate (#158) ──────────────
//
// This is the fail-loud wiring itself: the publish workflow must confirm
// every Official Essay's body is present on the reader relays BEFORE it ever
// calls publishList, and must never call publishList when any coordinate is
// unreachable or was never captured. Uses the same in-memory RelayPort
// pattern as essay-vault.test.js to reproduce the exact walled-garden
// (Idaho) failure deterministically, without touching real relays.

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

test('runPublishWorkflow rejects a malformed call before touching the vault', async () => {
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });

  await assert.rejects(() => runPublishWorkflow({ vault, publishList: async () => {} }), /essays must be an array/);
  await assert.rejects(() => runPublishWorkflow({ essays: [{ coordinate: 'x' }], publishList: async () => {} }), /vault must implement/);
  await assert.rejects(() => runPublishWorkflow({ essays: [{ coordinate: 'x' }], vault }), /publishList must be a function/);
  await assert.rejects(() => runPublishWorkflow({ essays: [{}], vault, publishList: async () => {} }), /has no coordinate/);
});

test('runPublishWorkflow aborts and never publishes the list when an Essay was never captured', async () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const coordinate = `30023:${pubkey}:never-captured`;
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });
  let publishListCalled = false;

  const outcome = await runPublishWorkflow({
    essays: [{ coordinate }],
    vault,
    publishList: async () => { publishListCalled = true; },
  });

  assert.equal(outcome.published, false);
  assert.deepEqual(outcome.missing, [coordinate]);
  assert.equal(publishListCalled, false, 'the Curation list must never be published while an Essay is unreachable');
});

test('runPublishWorkflow names every failing coordinate, not just the first', async () => {
  const skA = generateSecretKey();
  const skB = generateSecretKey();
  const coordA = `30023:${getPublicKey(skA)}:essay-a`;
  const coordB = `30023:${getPublicKey(skB)}:essay-b`;
  const vault = createEssayVault({ relayPort: createInMemoryRelayPort(), store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });

  const outcome = await runPublishWorkflow({
    essays: [{ coordinate: coordA }, { coordinate: coordB }],
    vault,
    publishList: async () => { throw new Error('must not be called'); },
  });

  assert.equal(outcome.published, false);
  assert.deepEqual(new Set(outcome.missing), new Set([coordA, coordB]));
});

test('runPublishWorkflow reproduces the Idaho walled-garden failure: unreachable capture aborts, mirrored capture publishes', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk, identifier: 'my-own-private-idaho-x-1991' });
  const store = createInMemoryVaultStore();

  // The event exists somewhere (a walled-garden relay outside the reader
  // set) but was never captured into the vault — exactly what stranded
  // Idaho before #157/#158.
  const relayPort = createInMemoryRelayPort({ 'wss://walled-garden.test': [event] });
  const vault = createEssayVault({ relayPort, store, readerRelays: READER_RELAYS });
  const coordinate = `30023:${event.pubkey}:my-own-private-idaho-x-1991`;

  const aborted = await runPublishWorkflow({
    essays: [{ coordinate }],
    vault,
    publishList: async () => { throw new Error('must not be called while unreachable'); },
  });
  assert.equal(aborted.published, false);
  assert.deepEqual(aborted.missing, [coordinate]);

  // Once the brand captures the Essay's signed event into the vault, the
  // same workflow mirrors it to the reader relays and publishes.
  vault.captureEssay(event);
  let publishListCalled = false;
  const succeeded = await runPublishWorkflow({
    essays: [{ coordinate }],
    vault,
    publishList: async () => { publishListCalled = true; return 'published'; },
  });

  assert.equal(succeeded.published, true);
  assert.deepEqual(succeeded.missing, []);
  assert.equal(publishListCalled, true);
});

test('runPublishWorkflow is safe to re-run after success (re-broadcasts dedupe by event id)', async () => {
  const sk = generateSecretKey();
  const event = makeEssayEvent({ sk });
  const relayPort = createInMemoryRelayPort();
  const vault = createEssayVault({ relayPort, store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });
  const coordinate = vault.captureEssay(event);

  const first = await runPublishWorkflow({ essays: [{ coordinate }], vault, publishList: async () => 'first' });
  const second = await runPublishWorkflow({ essays: [{ coordinate }], vault, publishList: async () => 'second' });

  assert.equal(first.published, true);
  assert.equal(second.published, true);
  assert.equal(relayPort.publishCalls.length, 2, 'each run mirrors once');

  const stored = await relayPort.collect(READER_RELAYS, { kinds: [30023], authors: [event.pubkey], '#d': ['test-essay'] });
  assert.equal(stored.length, 1, 'the relay holds exactly one copy of the event even after two mirror broadcasts — deduped by event id');
});

// ─── harvest + per-relay push (#170) ───────────────────────────────────────
//
// Every curated Essay's existing signed event is collected from wherever it
// lives and captured, so the gate pushes it verbatim to every brand relay —
// not just the Essays captured at curate time.

const coordinateOf = (event) => `30023:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')[1]}`;

test('essayHarvestFilter covers every curated Essay in one filter', () => {
  const a = getPublicKey(generateSecretKey());
  const b = getPublicKey(generateSecretKey());
  const filter = essayHarvestFilter([`30023:${a}:one`, `30023:${a}:two`, `30023:${b}:one`]);
  assert.deepEqual(filter.kinds, [30023]);
  assert.deepEqual(filter.authors.sort(), [a, b].sort());
  assert.deepEqual(filter['#d'].sort(), ['one', 'two']);
});

test('selectNewestEssayEvents keeps the newest valid event per curated coordinate only', () => {
  const sk = generateSecretKey();
  const older = makeEssayEvent({ sk, identifier: 'x', createdAt: 1000 });
  const newer = makeEssayEvent({ sk, identifier: 'x', createdAt: 2000 });
  // JSON round-trip drops nostr-tools' cached verified flag, as a relay payload would.
  const forged = { ...JSON.parse(JSON.stringify(makeEssayEvent({ sk, identifier: 'x', createdAt: 3000 }))), content: 'tampered' };
  const uncurated = makeEssayEvent({ sk: generateSecretKey(), identifier: 'x' });
  const coordinate = coordinateOf(older);

  const picked = selectNewestEssayEvents([older, forged, newer, uncurated], [coordinate]);
  assert.equal(picked.size, 1);
  assert.equal(picked.get(coordinate).id, newer.id);
});

test('harvestEssays captures found Essays so the gate can push them, and names the missing', async () => {
  const sk = generateSecretKey();
  const found = makeEssayEvent({ sk, identifier: 'found' });
  const missing = `30023:${getPublicKey(sk)}:gone`;
  const relayPort = createInMemoryRelayPort({ 'wss://source.test': [found] });
  const vault = createEssayVault({ relayPort, store: createInMemoryVaultStore(), readerRelays: READER_RELAYS });

  const harvest = await harvestEssays({
    coordinates: [coordinateOf(found), missing],
    fetchEvents: (filter) => relayPort.collect(['wss://source.test'], filter),
    vault,
  });
  assert.deepEqual(harvest.found, [coordinateOf(found)]);
  assert.deepEqual(harvest.notFound, [missing]);

  const presence = await vault.ensurePresence([coordinateOf(found)]);
  assert.equal(presence.ok, true, 'the harvested Essay was pushed to the brand relays and reads back');
  assert.deepEqual(relayPort.publishCalls[0].relays, READER_RELAYS);
  assert.equal(relayPort.publishCalls[0].event.id, found.id, 'pushed verbatim, never re-signed');
});
