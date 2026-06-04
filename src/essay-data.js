import { formatCoordinate } from './essay-coordinate.js';

const LONG_FORM_KIND = 30023;

function tagValue(tags, name) {
  if (!Array.isArray(tags)) return undefined;
  const tag = tags.find((t) => Array.isArray(t) && t[0] === name);
  return tag ? tag[1] : undefined;
}

export function parseLongFormEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.kind !== LONG_FORM_KIND) return null;

  const identifier = tagValue(event.tags, 'd') ?? '';
  const coordinate = { kind: LONG_FORM_KIND, pubkey: event.pubkey, identifier };
  const coordinateString = formatCoordinate(coordinate);
  if (!coordinateString) return null; // unaddressable (e.g. invalid pubkey)

  const createdAt = Number.isFinite(event.created_at) ? event.created_at : 0;
  const publishedRaw = Number(tagValue(event.tags, 'published_at'));
  const publishedAt = Number.isFinite(publishedRaw) ? publishedRaw : createdAt;

  return {
    coordinate,
    coordinateString,
    title: tagValue(event.tags, 'title') ?? '',
    summary: tagValue(event.tags, 'summary') ?? '',
    image: tagValue(event.tags, 'image') ?? '',
    body: typeof event.content === 'string' ? event.content : '',
    publishedAt,
    createdAt,
    eventId: event.id,
    pubkey: event.pubkey,
  };
}

// Addressable events (NIP-23) are replaceable: many versions may share one
// coordinate. Keep only the newest (highest created_at) per coordinate.
export function getLatestByCoordinate(events) {
  if (!Array.isArray(events)) return [];
  const latest = new Map();
  for (const event of events) {
    const essay = parseLongFormEvent(event);
    if (!essay) continue;
    const existing = latest.get(essay.coordinateString);
    if (!existing || essay.createdAt > existing.createdAt) {
      latest.set(essay.coordinateString, essay);
    }
  }
  return [...latest.values()];
}

export function getEssayByCoordinate(coordinateString, essays) {
  if (!coordinateString || typeof coordinateString !== 'string' || !Array.isArray(essays)) {
    return null;
  }
  const id = coordinateString.trim();
  if (!id) return null;
  return essays.find((e) => e && e.coordinateString === id) ?? null;
}
