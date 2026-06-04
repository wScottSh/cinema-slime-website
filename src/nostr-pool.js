import { SimplePool } from 'nostr-tools/pool';
import { getLatestByCoordinate, getEssayByCoordinate } from './essay-data.js';
import { getLatestCurationList, selectCuratedEssay } from './essay-curation.js';
import { formatCoordinate } from './essay-coordinate.js';
import { BRAND_PUBKEY, CURATION_LIST_KIND, CURATION_LIST_IDENTIFIER } from './brand.js';
import { aggregateSocialProof } from './essay-social-proof.js';

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

// Fetch all official Essays for the Discovery View in one batch query.
// Returns an array of { coordinate, essay } entries (sorted newest-first),
// [] when the curation list has no entries, or null on relay failure.
export async function fetchEssaysForDiscovery({ relays = DEFAULT_RELAYS, timeout = 8000 } = {}) {
  // fetchCurationList swallows its own relay errors and returns an empty curation
  const curation = await fetchCurationList({ relays, timeout });
  if (!curation.coordinates.size) return [];

  // Extract pubkeys from the curated coordinates to build the relay filter
  const authors = [...new Set(
    [...curation.coordinates]
      .map(c => c.split(':')[1] ?? '')
      .filter(Boolean)
  )];

  const pool = new SimplePool();
  try {
    const events = await Promise.race([
      pool.querySync(relays, { kinds: [30023], authors }, { maxWait: timeout }),
      new Promise((resolve) => setTimeout(() => resolve([]), timeout + 1000)),
    ]);
    const essays = getLatestByCoordinate(events || []);
    const entries = [];
    for (const essay of essays) {
      const official = selectCuratedEssay(essay, curation);
      if (official) {
        const slug = curation.coordinateToSlug?.get(official.coordinateString);
        entries.push({ coordinate: official.coordinateString, essay: official, slug });
      }
    }
    return entries.sort((a, b) => b.essay.publishedAt - a.essay.publishedAt);
  } catch (err) {
    console.error('[essays] discovery fetch failed:', err);
    return null;
  } finally {
    try { pool.close(relays); } catch { /* ignore */ }
  }
}

// Fetch zap receipts (kind:9735) and reactions (kind:7) for an addressable
// essay coordinate, then aggregate them into social proof totals. Returns
// { totalSats, largestZap, heartCount } — always resolves, never throws.
export async function fetchSocialProof(coordinateString, { relays = DEFAULT_RELAYS, timeout = 6000 } = {}) {
  if (typeof coordinateString !== 'string' || !coordinateString) {
    return { totalSats: 0, largestZap: 0, heartCount: 0 };
  }
  const pool = new SimplePool();
  try {
    const events = await Promise.race([
      pool.querySync(relays, { kinds: [9735, 7], '#a': [coordinateString] }, { maxWait: timeout }),
      new Promise((resolve) => setTimeout(() => resolve([]), timeout + 1000)),
    ]);
    return aggregateSocialProof(coordinateString, events || []);
  } catch (err) {
    console.error('[essays] social proof fetch failed:', err);
    return { totalSats: 0, largestZap: 0, heartCount: 0 };
  } finally {
    try { pool.close(relays); } catch { /* ignore */ }
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
