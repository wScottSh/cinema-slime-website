import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayPort } from './relay-port.js';

// A fake pool exercising the same shape collectEvents expects (see
// nostr-pool.test.js's fakeImmediatePool), plus a `publish` returning one
// promise per relay so RelayPort.publish's Promise.allSettled path is real.
function fakePool({ publishResults = null } = {}) {
  const publishCalls = [];
  const subscribeCalls = [];
  return {
    get publishCalls() { return publishCalls; },
    get subscribeCalls() { return subscribeCalls; },
    publish(relays, event) {
      publishCalls.push({ relays, event });
      return relays.map((relay, i) => {
        const outcome = publishResults?.[i] ?? 'ok';
        return outcome === 'ok' ? Promise.resolve(relay) : Promise.reject(new Error(`${relay} rejected`));
      });
    },
    subscribeMany(relays, filter, params) {
      subscribeCalls.push({ relays, filter, params });
      queueMicrotask(() => { try { params.oneose(); } catch { /* ignore */ } });
      return { close() {} };
    },
  };
}

test('publish calls pool.publish with the given relays and event', async () => {
  const pool = fakePool();
  const port = createRelayPort(pool);
  const event = { id: 'abc' };

  await port.publish(['wss://a.test', 'wss://b.test'], event);

  assert.equal(pool.publishCalls.length, 1);
  assert.deepEqual(pool.publishCalls[0].relays, ['wss://a.test', 'wss://b.test']);
  assert.equal(pool.publishCalls[0].event, event);
});

test('publish is best-effort — a rejected relay does not reject the whole call', async () => {
  const pool = fakePool({ publishResults: ['ok', 'fail'] });
  const port = createRelayPort(pool);

  // Must not throw even though one of the two relays rejects.
  await assert.doesNotReject(() => port.publish(['wss://a.test', 'wss://b.test'], { id: 'abc' }));
});

test('collect delegates to the pool via subscribeMany with the given filter', async () => {
  const pool = fakePool();
  const port = createRelayPort(pool);
  const filter = { kinds: [30023] };

  const events = await port.collect(['wss://a.test'], filter);

  assert.equal(pool.subscribeCalls.length, 1);
  assert.deepEqual(pool.subscribeCalls[0].relays, ['wss://a.test']);
  assert.equal(pool.subscribeCalls[0].filter, filter);
  assert.deepEqual(events, []);
});

test('collect applies default maxWait/settleMs when no timeout is given', async () => {
  const pool = fakePool();
  const port = createRelayPort(pool);

  await port.collect(['wss://a.test'], {});

  assert.equal(pool.subscribeCalls[0].params.maxWait, 6000);
});

test('collect honors an explicit timeout', async () => {
  const pool = fakePool();
  const port = createRelayPort(pool);

  await port.collect(['wss://a.test'], {}, { maxWait: 1234, settleMs: 56 });

  assert.equal(pool.subscribeCalls[0].params.maxWait, 1234);
});
