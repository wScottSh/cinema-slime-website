import { SimplePool } from 'nostr-tools/pool';
import { getLatestByCoordinate, getEssayByCoordinate } from './essay-data.js';
import { getLatestCurationList } from './essay-curation.js';
import { formatCoordinate } from './essay-coordinate.js';
import { BRAND_PUBKEY, CURATION_LIST_KIND, CURATION_LIST_IDENTIFIER } from './brand.js';

// Default relay set for discovering official Essays. SimplePool verifies event
// signatures by default, so forged events from a misbehaving relay are dropped.
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
];

// Fetch the latest version of one addressable Essay (NIP-23 kind:30023) by its
// coordinate. Returns the parsed Essay, or null on any failure / not-found —
// it never throws, so a relay outage degrades gracefully and never breaks the
// rest of the site (the Episode experience runs on a completely separate path).
export async function fetchEssayByCoordinate(coordinate, { relays = DEFAULT_RELAYS, timeout = 6000 } = {}) {
  if (!coordinate || typeof coordinate.pubkey !== 'string') return null;
  const pool = new SimplePool();
  const filter = {
    kinds: [coordinate.kind],
    authors: [coordinate.pubkey],
    '#d': [coordinate.identifier],
  };
  try {
    const events = await Promise.race([
      pool.querySync(relays, filter, { maxWait: timeout }),
      new Promise((resolve) => setTimeout(() => resolve([]), timeout + 1000)),
    ]);
    const essays = getLatestByCoordinate(events || []);
    const coordinateString = formatCoordinate(coordinate);
    return getEssayByCoordinate(coordinateString, essays) ?? essays[0] ?? null;
  } catch (err) {
    console.error('[essays] relay fetch failed:', err);
    return null;
  } finally {
    try {
      pool.close(relays);
    } catch {
      /* ignore close errors */
    }
  }
}

// Fetch the brand's latest curation list — the official index of Cinema Slime
// Essays — using the single hardcoded BRAND_PUBKEY trust anchor. Returns the
// parsed curation ({ coordinates, names }); on any failure it resolves to an
// empty curation rather than throwing. That is deliberately fail-closed: with
// no list in hand, nothing is treated as an official Essay.
export async function fetchCurationList({ relays = DEFAULT_RELAYS, timeout = 6000 } = {}) {
  const pool = new SimplePool();
  const filter = {
    kinds: [CURATION_LIST_KIND],
    authors: [BRAND_PUBKEY],
    '#d': [CURATION_LIST_IDENTIFIER],
  };
  try {
    const events = await Promise.race([
      pool.querySync(relays, filter, { maxWait: timeout }),
      new Promise((resolve) => setTimeout(() => resolve([]), timeout + 1000)),
    ]);
    return getLatestCurationList(events || []);
  } catch (err) {
    console.error('[essays] curation list fetch failed:', err);
    return getLatestCurationList([]);
  } finally {
    try {
      pool.close(relays);
    } catch {
      /* ignore close errors */
    }
  }
}
