const HEX_64 = /^[0-9a-f]{64}$/;
const INTEGER = /^\d+$/;

export function parseCoordinate(str) {
  if (typeof str !== 'string') return null;
  const first = str.indexOf(':');
  const second = str.indexOf(':', first + 1);
  if (first === -1 || second === -1) return null;

  const kindStr = str.slice(0, first);
  const pubkey = str.slice(first + 1, second);
  const identifier = str.slice(second + 1);

  if (!INTEGER.test(kindStr)) return null;
  if (!HEX_64.test(pubkey)) return null;

  return { kind: Number(kindStr), pubkey, identifier };
}

export function formatCoordinate(coordinate) {
  if (!coordinate || typeof coordinate !== 'object') return null;
  const { kind, pubkey, identifier } = coordinate;
  if (!Number.isInteger(kind) || kind < 0) return null;
  if (typeof pubkey !== 'string' || !HEX_64.test(pubkey)) return null;
  if (typeof identifier !== 'string') return null;
  return `${kind}:${pubkey}:${identifier}`;
}
