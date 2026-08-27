// Curate-time capture wiring (#159) — the seam the curate-essay flow calls so
// that adding an Essay to the Curation ALWAYS captures its original signed
// body into EssayVault's committed vault, not merely its coordinate. This is
// the root-cause fix for the stranded-Essay bug (#156): a curator can no
// longer add an Essay whose body the site can't load, because the curate flow
// itself refuses to proceed unless it can obtain and validate the bytes.
//
// Three input shapes, per the curate-essay skill's contract:
//   { rawEvent, coordinate? } — a signed kind:30023 event, JSON string or
//                                object (e.g. Primal's "Copy Raw Data").
//                                Preferred: no network fetch is needed at all.
//                                An optional co-supplied `coordinate` (or
//                                `naddr`) is still enforced as an
//                                expected-coordinate check — a mispasted event
//                                is refused rather than silently captured
//                                under the wrong claim.
//   { naddr, extraRelays? }   — an naddr; its own embedded relay hints (plus
//                                any extraRelays) are used to fetch the event.
//   { coordinate, relays }    — a bare coordinate with explicit source relays
//                                to fetch the event from.
//
// Fetching (naddr/coordinate forms) is delegated to a RelayPort (see
// relay-port.js) so this module never opens its own connections and tests can
// inject an in-memory double. Validation and storage are delegated entirely
// to EssayVault.captureEssay (#157) — this module's only job is turning a
// pointer into bytes when the caller didn't already hand over bytes, and
// refusing loudly when that's not possible.
import { nip19 } from 'nostr-tools';
import { formatCoordinate, parseCoordinate } from './essay-coordinate.js';

const LONG_FORM_KIND = 30023;

// Decode an naddr into its coordinate string, kind, pubkey, identifier, and
// embedded relay hints. Shared by the naddr-as-pointer path and the
// rawEvent+naddr expected-coordinate path below.
function decodeNaddr(naddr) {
  let decoded;
  try {
    decoded = nip19.decode(naddr);
  } catch (err) {
    throw new Error(`curate-capture: could not decode naddr: ${err.message}`);
  }
  if (decoded.type !== 'naddr') {
    throw new Error(`curate-capture: expected an naddr, got "${decoded.type}"`);
  }
  const { kind, pubkey, identifier, relays } = decoded.data;
  return { kind, pubkey, identifier, relays: relays ?? [] };
}

// Resolve any curate-flow input into { event, expectedCoordinate }. Never
// writes anything — pure resolution. Throws with a clear, actionable message
// whenever bytes cannot be obtained (no relays given, or no relay returned a
// matching event).
export async function resolveRawEvent(input, { relayPort } = {}) {
  if (!input || typeof input !== 'object') {
    throw new Error('curate-capture: input must be an object with rawEvent, naddr, or coordinate');
  }

  if (input.rawEvent !== undefined && input.rawEvent !== null) {
    const event = typeof input.rawEvent === 'string' ? JSON.parse(input.rawEvent) : input.rawEvent;
    // A co-supplied coordinate or naddr is still enforced as an
    // expected-coordinate check, even though no fetch is needed for the
    // bytes themselves — a mispasted event must not be captured under a
    // false claim just because it arrived as raw JSON.
    let expectedCoordinate;
    if (typeof input.coordinate === 'string') {
      expectedCoordinate = input.coordinate;
    } else if (input.naddr) {
      const { kind, pubkey, identifier } = decodeNaddr(input.naddr);
      expectedCoordinate = formatCoordinate({ kind, pubkey, identifier });
    }
    return { event, expectedCoordinate };
  }

  let kind;
  let pubkey;
  let identifier;
  let relays;

  if (input.naddr) {
    ({ kind, pubkey, identifier, relays } = decodeNaddr(input.naddr));
    relays = [...relays, ...(input.extraRelays ?? [])];
  } else if (input.coordinate) {
    const parsed = parseCoordinate(input.coordinate);
    if (!parsed) {
      throw new Error(`curate-capture: malformed coordinate "${input.coordinate}"`);
    }
    ({ kind, pubkey, identifier } = parsed);
    relays = Array.isArray(input.relays) ? input.relays : [];
  } else {
    throw new Error('curate-capture: input must provide rawEvent, naddr, or coordinate');
  }

  if (kind !== LONG_FORM_KIND) {
    throw new Error(`curate-capture: expected kind ${LONG_FORM_KIND}, got ${kind}`);
  }

  const expectedCoordinate = formatCoordinate({ kind, pubkey, identifier });
  if (!expectedCoordinate) {
    throw new Error('curate-capture: could not compute a coordinate from the input');
  }

  if (!Array.isArray(relays) || relays.length === 0) {
    throw new Error(
      `curate-capture: no relays to fetch "${expectedCoordinate}" from — provide an naddr with relay hints, or explicit relays`,
    );
  }
  if (!relayPort || typeof relayPort.collect !== 'function') {
    throw new Error('curate-capture: relayPort must implement { collect } to resolve a pointer input');
  }

  const filter = { kinds: [kind], authors: [pubkey], '#d': [identifier] };
  const events = (await relayPort.collect(relays, filter)) ?? [];
  if (events.length === 0) {
    throw new Error(
      `curate-capture: could not obtain the signed event for "${expectedCoordinate}" from relays: ${relays.join(', ')}`,
    );
  }
  // Prefer the newest candidate if more than one relay answered — matches
  // kind:30023's replaceable semantics (see essay-vault.js checkPresence).
  const event = events.reduce(
    (newest, candidate) => (!newest || Number(candidate.created_at) > Number(newest.created_at) ? candidate : newest),
    null,
  );

  return { event, expectedCoordinate };
}

// The one seam the curate-essay flow calls: resolve `input` into signed event
// bytes (fetching from relays only if the caller didn't already hand over
// bytes), then hand off to EssayVault.captureEssay for validation + storage.
// Refuses loudly (throws) instead of writing anything when bytes cannot be
// obtained or fail validation — no vault copy is ever written on failure, and
// callers should not write a Curation entry either when this throws.
export async function captureEssayFromInput(input, { vault, relayPort } = {}) {
  if (!vault || typeof vault.captureEssay !== 'function') {
    throw new Error('curate-capture: vault must implement { captureEssay }');
  }
  const { event, expectedCoordinate } = await resolveRawEvent(input, { relayPort });
  return vault.captureEssay(event, expectedCoordinate);
}
