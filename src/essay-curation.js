// Pure, dependency-free reader for the brand's Nostr curation list — the
// "official index" of Cinema Slime Essays. Mirrors essay-data.js: all
// parsing/selection lives here so the unit-test suite never touches a relay.

import { CURATION_LIST_KIND } from './brand.js';
import { isValidSlug } from './essay-slug.js';

export function parseCurationList(event) {
  const coordinates = new Set();
  const names = new Map();
  const slugToCoordinate = new Map();
  if (!event || typeof event !== 'object' || !Array.isArray(event.tags)) {
    return { coordinates, names, slugToCoordinate };
  }
  // Only the dedicated list event counts — a brand-key note/reply that happens
  // to carry a/p tags must never be interpreted as the official index.
  if (event.kind !== CURATION_LIST_KIND) return { coordinates, names, slugToCoordinate };
  for (const tag of event.tags) {
    if (!Array.isArray(tag)) continue;
    // `a` tag: a curated Essay coordinate (kind:pubkey:identifier).
    // Slug sits at index 3: ["a", coord, "", slug] — mirrors the p-tag name encoding.
    if (tag[0] === 'a' && tag[1]) {
      coordinates.add(tag[1]);
      if (isValidSlug(tag[3])) slugToCoordinate.set(tag[3], tag[1]);
    }
    // `p` tag: a brand-approved display name in the NIP-02 petname position.
    if (tag[0] === 'p' && tag[1] && tag[3]) names.set(tag[1], tag[3]);
  }
  return { coordinates, names, slugToCoordinate };
}

// The curation list is an addressable (replaceable) event: many versions may
// share the brand's `d` coordinate. Parse only the newest one — a later list
// fully supersedes earlier ones, so a removed coordinate stops being official.
export function getLatestCurationList(events) {
  if (!Array.isArray(events)) return parseCurationList(null);
  let newest = null;
  let newestAt = -Infinity;
  for (const event of events) {
    if (!event || typeof event !== 'object' || event.kind !== CURATION_LIST_KIND) continue;
    const createdAt = Number.isFinite(event.created_at) ? event.created_at : 0;
    if (createdAt > newestAt) {
      newest = event;
      newestAt = createdAt;
    }
  }
  return parseCurationList(newest);
}

// The official-Essay gate. An Essay counts as an *official Cinema Slime Essay*
// only when its coordinate appears on the curation list. When it does, the
// author's display name is taken from the list's name map (the brand controls
// the names shown) — never from the author's own kind:0 profile. Returns the
// Essay enriched with `authorName`, or null when it is not official. Fail-closed:
// a missing/empty curation (e.g. relays unreachable) yields null, never an
// unverified "official" Essay.
export function selectCuratedEssay(essay, curation) {
  if (!essay || !curation || !(curation.coordinates instanceof Set)) return null;
  if (!curation.coordinates.has(essay.coordinateString)) return null;
  const authorName = (curation.names instanceof Map && curation.names.get(essay.pubkey)) || '';
  return { ...essay, authorName };
}
