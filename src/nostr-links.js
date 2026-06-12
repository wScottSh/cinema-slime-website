import { nip19 } from 'nostr-tools';
import { parseCoordinate } from './essay-coordinate.js';

// Build the "open in a Nostr client" URL for an Essay coordinate.
// njump.me resolves NIP-19 bech32 entities only — a raw kind:pubkey:d
// coordinate 404s (issue #71) — so the coordinate is encoded as an naddr.
export function buildNostrClientUrl(coordinateString) {
  const coordinate = parseCoordinate(coordinateString);
  if (!coordinate) return null;
  return `https://njump.me/${nip19.naddrEncode(coordinate)}`;
}
