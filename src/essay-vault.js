// EssayVault — the brand-owned guarantee that every Official Essay's body is
// actually readable from the relays the site reads (see #156).
//
// Owns one invariant: for every coordinate the brand has captured, a
// signature-valid event at that coordinate is readable from the reader relay
// set. It hides all broadcast/read-back/trust machinery behind three verbs:
//
//   captureEssay(source)         — validate + store the author's original
//                                   signed event verbatim (never re-signs).
//   ensurePresence(coordinates)  — mirror captured events to the writer
//                                   relays, then read them back to confirm.
//   verifyPresence(coordinates)  — the read-only projection of the same
//                                   read-back check; never broadcasts.
//
// This slice (#157) deliberately supports exactly one capture source — raw
// signed kind:30023 JSON (e.g. Primal's "Copy Raw Data") — pasted or piped
// into a one-off script. The fail-loud publish-workflow gate (#158) and the
// naddr / coordinate+relays curate-time capture wiring (#159, see
// src/curate-capture.js) build on this core without changing it.
import { verifyEvent } from 'nostr-tools/pure';
import { formatCoordinate, parseCoordinate } from './essay-coordinate.js';

const ESSAY_KIND = 30023;

// source: a raw signed kind:30023 event, either as a JSON string (e.g. pasted
// from Primal's "Copy Raw Data") or an already-parsed object.
// expectedCoordinate: optional — when given, capture is refused if the
// event's own computed coordinate does not match it, so a mispasted event
// never lands in the vault under a false claim.
// Throws on invalid signature, wrong kind, a missing/unmatched coordinate, an
// expected-coordinate mismatch, or malformed input — capture is refused
// loudly, before anything is stored, rather than persisting a pointer to a
// body the site can't load (or the wrong body entirely).
function parseCaptureSource(source, expectedCoordinate) {
  const event = typeof source === 'string' ? JSON.parse(source) : source;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('EssayVault.captureEssay: source must be a signed Nostr event (JSON string or object)');
  }
  if (event.kind !== ESSAY_KIND) {
    throw new Error(`EssayVault.captureEssay: expected kind ${ESSAY_KIND}, got ${event.kind}`);
  }
  if (!verifyEvent(event)) {
    throw new Error('EssayVault.captureEssay: invalid signature');
  }
  const identifier = Array.isArray(event.tags) ? event.tags.find((t) => t[0] === 'd')?.[1] : undefined;
  if (typeof identifier !== 'string' || identifier === '') {
    throw new Error('EssayVault.captureEssay: event has no "d" tag — cannot compute a coordinate');
  }
  const coordinate = formatCoordinate({ kind: event.kind, pubkey: event.pubkey, identifier });
  if (!coordinate) {
    throw new Error('EssayVault.captureEssay: could not compute a coordinate from the event');
  }
  if (expectedCoordinate && coordinate !== expectedCoordinate) {
    throw new Error(`EssayVault.captureEssay: computed coordinate "${coordinate}" does not match the expected coordinate "${expectedCoordinate}"`);
  }
  return { event, coordinate };
}

// store: { load(coordinate) => event|null, save(coordinate, event) => void }
// relayPort: { publish(relays, event), collect(relays, filter, opts) }
export function createEssayVault({ relayPort, store, readerRelays, writerRelays = readerRelays } = {}) {
  if (!relayPort || typeof relayPort.publish !== 'function' || typeof relayPort.collect !== 'function') {
    throw new Error('EssayVault: relayPort must implement { publish, collect }');
  }
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
    throw new Error('EssayVault: store must implement { load, save }');
  }
  if (!Array.isArray(readerRelays) || readerRelays.length === 0) {
    throw new Error('EssayVault: readerRelays must be a non-empty array');
  }

  // Idempotent by coordinate: a re-capture of an updated Essay only replaces
  // the stored copy when its created_at is newer, so re-running capture is
  // always safe. expectedCoordinate (optional) rejects a mispasted event
  // before anything is written — see parseCaptureSource.
  function captureEssay(source, expectedCoordinate) {
    const { event, coordinate } = parseCaptureSource(source, expectedCoordinate);
    const existing = store.load(coordinate);
    if (existing && Number(existing.created_at) >= Number(event.created_at)) {
      return coordinate;
    }
    store.save(coordinate, event);
    return coordinate;
  }

  // Shared read-back core for both ensurePresence and verifyPresence, so
  // "confirmed present" cannot drift between the writer path and the
  // read-only audit path. A coordinate with no captured event is reported as
  // a failure, never silently skipped. kind:30023 is replaceable, so a newer
  // signature-valid event at the same coordinate also counts as present —
  // the invariant is "readable at this coordinate," not "byte-identical to
  // what we last captured."
  async function checkPresence(coordinates, relaysToRead) {
    const entries = [];
    for (const coordinate of coordinates) {
      const stored = store.load(coordinate);
      if (!stored) {
        entries.push({ coordinate, ok: false, reason: 'not-captured' });
        continue;
      }
      const parsed = parseCoordinate(coordinate);
      if (!parsed) {
        entries.push({ coordinate, ok: false, reason: 'malformed-coordinate' });
        continue;
      }
      const filter = { kinds: [parsed.kind], authors: [parsed.pubkey], '#d': [parsed.identifier] };
      const events = (await relayPort.collect(relaysToRead, filter)) ?? [];
      const found = events.some((candidate) => verifyEvent(candidate) && Number(candidate.created_at) >= Number(stored.created_at));
      entries.push({ coordinate, ok: found, reason: found ? null : 'unreachable' });
    }
    const missing = entries.filter((e) => !e.ok).map((e) => e.coordinate);
    return { ok: missing.length === 0, entries, missing };
  }

  // Mirrors every captured coordinate's original signed event to the writer
  // relays (verbatim — never re-signed) and reads each back from the reader
  // relays to confirm it round-trips. Never throws on a per-coordinate
  // failure; it aggregates so every gap is visible at once. Safe to re-run —
  // broadcasting the same bytes twice is a harmless no-op for the relay.
  async function ensurePresence(coordinates) {
    for (const coordinate of coordinates) {
      const stored = store.load(coordinate);
      if (!stored) continue; // reported as a failure by checkPresence below
      await relayPort.publish(writerRelays, stored);
    }
    return checkPresence(coordinates, readerRelays);
  }

  // Read-only projection of ensurePresence: reads back from the reader
  // relays but never broadcasts. Structurally incapable of writing.
  function verifyPresence(coordinates) {
    return checkPresence(coordinates, readerRelays);
  }

  return { captureEssay, ensurePresence, verifyPresence };
}
