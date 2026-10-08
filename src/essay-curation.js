// Pure, dependency-free reader for the brand's Nostr curation list — the
// "official index" of Cinema Slime Essays. Mirrors essay-data.js: all
// parsing/selection lives here so the unit-test suite never touches a relay.

import { CURATION_LIST_KIND } from './brand.js';
import { isValidSlug } from './essay-slug.js';

export function parseCurationList(event) {
  const coordinates = new Set();
  const names = new Map();
  const slugToCoordinate = new Map();
  const coordinateToSlug = new Map();
  const aliasToCoordinate = new Map();
  const parsed = { coordinates, names, slugToCoordinate, coordinateToSlug, aliasToCoordinate };
  if (!event || typeof event !== 'object' || !Array.isArray(event.tags)) return parsed;
  // Only the dedicated list event counts — a brand-key note/reply that happens
  // to carry a/p tags must never be interpreted as the official index.
  if (event.kind !== CURATION_LIST_KIND) return parsed;
  const aliasTags = [];
  for (const tag of event.tags) {
    if (!Array.isArray(tag)) continue;
    // `a` tag: a curated Essay coordinate (kind:pubkey:identifier).
    // Slug sits at index 3: ["a", coord, "", slug] — mirrors the p-tag name encoding.
    if (tag[0] === 'a' && tag[1]) {
      coordinates.add(tag[1]);
      if (isValidSlug(tag[3])) {
        slugToCoordinate.set(tag[3], tag[1]);
        coordinateToSlug.set(tag[1], tag[3]);
      }
    }
    // `p` tag: a brand-approved display name in the NIP-02 petname position.
    if (tag[0] === 'p' && tag[1] && tag[3]) names.set(tag[1], tag[3]);
    // `alias` tag: ["alias", oldSlug, coord], a slug the Essay used to have (ADR 0022).
    if (tag[0] === 'alias') aliasTags.push(tag);
  }
  // A current slug always wins, and an alias must name a listed Essay; any
  // other alias is ignored rather than failing the list.
  for (const [, slug, coordinate] of aliasTags) {
    if (!isValidSlug(slug) || !coordinates.has(coordinate)) continue;
    if (slugToCoordinate.has(slug) || aliasToCoordinate.has(slug)) continue;
    aliasToCoordinate.set(slug, coordinate);
  }
  return parsed;
}

// The coordinate a slug or Slug Alias names, and the slug to show for it:
// `canonical` is the Essay's current slug (null when it has none), and
// `alias` says the visitor arrived on an old one. Null when neither matches.
export function resolveSlug(curation, slug) {
  const current = curation?.slugToCoordinate?.get(slug);
  if (current) return { coordinate: current, canonical: slug, alias: false };
  const coordinate = curation?.aliasToCoordinate?.get(slug);
  if (!coordinate) return null;
  return { coordinate, canonical: curation.coordinateToSlug?.get(coordinate) ?? null, alias: true };
}

// The curation list is an addressable (replaceable) event: many versions may
// share the brand's `d` coordinate. Picks the newest RAW event (not yet
// parsed) — the single selection rule both getLatestCurationList (below) and
// the per-relay Curation redundancy audit (scripts/check-curation.mjs, #168)
// build on, so "which version is the live one" can never disagree between
// the two: the audit needs the event's identity (its id) to check whether a
// given relay holds THIS exact version, not merely a same-shaped one.
export function getNewestCurationEvent(events) {
  if (!Array.isArray(events)) return null;
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
  return newest;
}

// Parse only the newest curation list event — a later list fully supersedes
// earlier ones, so a removed coordinate stops being official.
export function getLatestCurationList(events) {
  const newest = getNewestCurationEvent(events);
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

// Gate a list of parsed Essays through the curation list and shape the result
// into Discovery entries: { coordinate, essay, slug, aliases }[], sorted newest-first by
// publishedAt. Shared by the relay path (fetchEssaysForDiscovery) and the
// same-origin snapshot path (parseEssaysSnapshot) so the two can never drift in
// how they build entries.
export function buildCuratedEntries(essays, curation) {
  const entries = [];
  for (const essay of essays) {
    const official = selectCuratedEssay(essay, curation);
    if (official) {
      const coordinate = official.coordinateString;
      const slug = curation.coordinateToSlug?.get(coordinate);
      const aliases = [...(curation.aliasToCoordinate ?? [])].filter(([, c]) => c === coordinate).map(([alias]) => alias);
      entries.push({ coordinate, essay: official, slug, aliases });
    }
  }
  return entries.sort((a, b) => b.essay.publishedAt - a.essay.publishedAt);
}
