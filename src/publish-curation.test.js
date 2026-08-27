import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { validateManifestSlugs, runPublishWorkflow } from '../scripts/publish-curation.mjs';
import { createEssayVault } from './essay-vault.js';

test('validateManifestSlugs passes when no essays have slugs', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1' },
    { coordinate: '30023:abc:id2' },
  ]);
  assert.deepEqual(result, { valid: true });
});

test('validateManifestSlugs passes with valid unique slugs', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'first' },
    { coordinate: '30023:abc:id2', slug: 'second-essay' },
  ]);
  assert.deepEqual(result, { valid: true });
});

test('validateManifestSlugs fails with a malformed slug (uppercase)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'First' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'First');
  assert.ok(result.reason.length > 0);
});

test('validateManifestSlugs fails with a malformed slug (spaces)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'hello world' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'hello world');
});

test('validateManifestSlugs fails with a malformed slug (leading hyphen)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: '-bad' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, '-bad');
});

test('validateManifestSlugs fails with a malformed slug (double hyphen)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'hello--world' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'hello--world');
});

test('validateManifestSlugs fails with a malformed slug (colon)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'with:colon' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'with:colon');
});

test('validateManifestSlugs fails with duplicate slugs', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'first' },
    { coordinate: '30023:abc:id2', slug: 'first' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'first');
  assert.ok(result.reason.includes('duplicate') || result.reason.includes('Duplicate'));
});

test('validateManifestSlugs reports the first offending slug on mixed input', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'valid' },
    { coordinate: '30023:abc:id2', slug: 'INVALID' },
    { coordinate: '30023:abc:id3', slug: 'valid' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'INVALID');
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
