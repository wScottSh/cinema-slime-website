// Pure snapshot parser: gateway JSON in → { coordinate, essay, slug }[] out.
// Takes the two parsed JSON payloads from /api/essays/curation and
// /api/essays/events, applies the curation gate, and returns the same entry
// shape that fetchEssaysForDiscovery produces — so the caller can seed
// officialEssays and the localStorage cache without touching the Nostr relay.
//
// Degrades safely: malformed or partial payloads → empty array, never throws.

import { getLatestByCoordinate } from './essay-data.js';
import { getLatestCurationList, selectCuratedEssay } from './essay-curation.js';

export function parseEssaysSnapshot(curationPayload, eventsPayload) {
  try {
    const curationEvents = Array.isArray(curationPayload?.events) ? curationPayload.events : [];
    const curation = getLatestCurationList(curationEvents);

    if (!curation.coordinates.size) return [];

    const essayEvents = Array.isArray(eventsPayload?.events) ? eventsPayload.events : [];
    const essays = getLatestByCoordinate(essayEvents);

    const entries = [];
    for (const essay of essays) {
      const official = selectCuratedEssay(essay, curation);
      if (official) {
        const slug = curation.coordinateToSlug?.get(official.coordinateString);
        entries.push({ coordinate: official.coordinateString, essay: official, slug });
      }
    }
    return entries.sort((a, b) => b.essay.publishedAt - a.essay.publishedAt);
  } catch {
    return [];
  }
}
