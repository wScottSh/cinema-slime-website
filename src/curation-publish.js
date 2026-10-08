// Reading, signing and publishing the brand's Curation, and the Guaranteed
// Presence gate every publish passes through. The Curator (bot/curator.js)
// composes these; relays are reached only through an injected RelayPort.
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { BRAND_RELAYS, CURATION_LIST_IDENTIFIER, CURATION_LIST_KIND, curationListFilter } from './brand.js';
import { curationFromEvent, curationToTags } from './curation.js';
import { getNewestCurationEvent } from './essay-curation.js';
import { formatCoordinate, parseCoordinate } from './essay-coordinate.js';
import { ESSAY_KIND } from './essay-vault.js';

// Read-only harvest set: where a publish looks for each Official Essay's
// existing signed event before pushing it to every brand relay. A superset of
// the brand set — nos.lol still holds the most Official Essays even though it
// is out of the brand set for flaky reads (ADR 0017), and YakiHonne's relays
// hold Essays authored there. Never published to.
export const SOURCE_RELAYS = [...new Set([
  ...BRAND_RELAYS,
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr-01.yakihonne.com',
  'wss://nostr-02.yakihonne.com',
])];

function isBrandCuration(event, author) {
  return event?.kind === CURATION_LIST_KIND
    && event.pubkey === author
    && event.tags?.some((t) => t[0] === 'd' && t[1] === CURATION_LIST_IDENTIFIER)
    && verifyEvent(event);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonAtomically(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

const listedCoordinates = (event) => event.tags.filter((t) => t[0] === 'a' && t[1]).map((t) => t[1]);

/**
 * The Curation an edit may safely start from:
 *
 *   { kind: 'read', curation }
 *   { kind: 'refused', reason: 'curation-unreadable' }                 no signed list anywhere
 *   { kind: 'refused', reason: 'curations-disagree', missing: [coordinate] }
 *   { kind: 'refused', reason: 'curation-stale', newest, floor }       created_at values
 *
 * Sources are each brand relay plus the copy this machine last published
 * (`localPath`), and each contributes only its newest valid list: a relay
 * that ignores replaceable semantics (relay.ditto.pub returns every historical
 * version) must not resurrect Essays a later list removed. Each relay is
 * queried on its own and read to its EOSE (or maxWait), because a fast relay
 * holding an older list must not win by answering first. The base is the
 * newest source list. The Curator has no remove verb, so the base must list
 * every coordinate any source's newest list has; otherwise a lagging copy won
 * and publishing would delist Essays. `floorPath` keeps the highest created_at
 * ever seen or published here, so a base older than that is refused even when
 * every newer copy has gone missing.
 */
export async function readCuration({ relayPort, author, localPath, floorPath, relays = BRAND_RELAYS }) {
  const newestOf = (events) => getNewestCurationEvent((events ?? []).filter((e) => isBrandCuration(e, author)));
  const relayNewest = await Promise.all(relays.map(async (relay) => {
    try {
      return newestOf(await relayPort.collect([relay], curationListFilter(author), {
        maxWait: 8000,
        settleMs: 2000,
        isComplete: () => false,
      }));
    } catch {
      return null;
    }
  }));
  const candidates = [...relayNewest, newestOf([readJson(localPath)])].filter(Boolean);
  const base = getNewestCurationEvent(candidates);
  if (!base) return { kind: 'refused', reason: 'curation-unreadable' };

  const floor = Number(readJson(floorPath)?.createdAt) || 0;
  if (base.created_at < floor) return { kind: 'refused', reason: 'curation-stale', newest: base.created_at, floor };
  await raiseCurationFloor(floorPath, base.created_at);

  const inBase = new Set(listedCoordinates(base));
  const missing = [...new Set(candidates.flatMap(listedCoordinates))].filter((c) => !inBase.has(c));
  if (missing.length) return { kind: 'refused', reason: 'curations-disagree', missing };
  return { kind: 'read', curation: curationFromEvent(base) };
}

export async function raiseCurationFloor(floorPath, createdAt) {
  if (createdAt <= (Number(readJson(floorPath)?.createdAt) || 0)) return;
  await writeJsonAtomically(floorPath, { createdAt });
}

export async function saveLocalCuration(localPath, event) {
  await writeJsonAtomically(localPath, event);
}

// `next.createdAt` is the created_at of the Curation it was edited from; the
// new event is always strictly newer, so it replaces that one even when the
// clock is behind.
export function signCuration(next, { secretKey, nowSec }) {
  return finalizeEvent({
    kind: CURATION_LIST_KIND,
    created_at: Math.max(nowSec, next.createdAt + 1),
    tags: curationToTags(next),
    content: '',
  }, secretKey);
}

// Validate an entries manifest ({ coordinate }[]) and project it to the bare
// coordinate list the EssayVault verbs consume. Shared by the publish gate
// and the read-only audit (check-curation.mjs).
export function coordinatesFromEssays(essays) {
  if (!Array.isArray(essays)) {
    throw new Error('essays must be an array of { coordinate }');
  }
  return essays.map((essay, index) => {
    if (!essay || typeof essay.coordinate !== 'string' || essay.coordinate === '') {
      throw new Error(`essays[${index}] has no coordinate`);
    }
    return essay.coordinate;
  });
}

// Guaranteed Presence gate (see CONTEXT.md and #158). Publishing the Curation
// must never declare success while an Official Essay's body is unreachable
// from the relays the site reads — the failure that silently stranded "My Own
// Private Idaho" (#156, #157). `vault.ensurePresence` mirrors every captured
// body to the writer relays and reads it back; only when every coordinate is
// confirmed does `publishList` run. Failures are aggregated in `missing`.
export async function runPublishWorkflow({ essays, vault, publishList } = {}) {
  const coordinates = coordinatesFromEssays(essays);
  if (!vault || typeof vault.ensurePresence !== 'function') {
    throw new Error('runPublishWorkflow: vault must implement { ensurePresence }');
  }
  if (typeof publishList !== 'function') {
    throw new Error('runPublishWorkflow: publishList must be a function');
  }
  const presence = await vault.ensurePresence(coordinates);
  if (!presence.ok) {
    return { published: false, missing: presence.missing, presence };
  }
  const result = await publishList();
  return { published: true, missing: [], presence, result };
}

// One relay filter covering every curated Essay at once (kinds + authors +
// `#d`), so a harvest costs one query per relay rather than one per Essay —
// relays rate-limit repeated connections (#169).
export function essayHarvestFilter(coordinates) {
  const parsed = coordinates.map(parseCoordinate).filter(Boolean);
  return {
    kinds: [ESSAY_KIND],
    authors: [...new Set(parsed.map((c) => c.pubkey))],
    '#d': [...new Set(parsed.map((c) => c.identifier))],
  };
}

// Picks, per curated coordinate, the newest signature-valid kind:30023 event
// among `events`. Events at uncurated coordinates (a shared `d` under another
// author) are ignored. Returns Map<coordinate, event>.
export function selectNewestEssayEvents(events, coordinates) {
  const wanted = new Set(coordinates);
  const newest = new Map();
  for (const event of events ?? []) {
    if (!event || event.kind !== ESSAY_KIND) continue;
    const identifier = event.tags?.find((t) => t[0] === 'd')?.[1];
    if (identifier === undefined) continue;
    const coordinate = formatCoordinate({ kind: event.kind, pubkey: event.pubkey, identifier });
    if (!wanted.has(coordinate)) continue;
    const current = newest.get(coordinate);
    if (current && Number(current.created_at) >= Number(event.created_at)) continue;
    if (!verifyEvent(event)) continue;
    newest.set(coordinate, event);
  }
  return newest;
}

// Captures every curated Essay's existing signed event into the vault so the
// publish gate can push it — verbatim, never re-signed — to every brand relay
// (#170). `fetchEvents(filter)` is the injected relay read. Returns the
// coordinates found nowhere, which the gate then names as not-captured.
export async function harvestEssays({ coordinates, fetchEvents, vault }) {
  const events = await fetchEvents(essayHarvestFilter(coordinates));
  const found = selectNewestEssayEvents(events, coordinates);
  for (const [coordinate, event] of found) {
    vault.captureEssay(event, coordinate);
  }
  return { found: [...found.keys()], notFound: coordinates.filter((c) => !found.has(c)) };
}
