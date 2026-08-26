// Deterministic extractor + capturer for the curate-essay skill (#159).
//
// Turns a pasted Nostr long-form post into everything needed to add it to the
// ESSAYS list in scripts/publish-curation.mjs — except the slug, which is the
// one human decision. Reuses the site's own parser so the coordinate it emits
// is byte-identical to what the site reads back off the relay.
//
// Before printing anything, this ALWAYS captures the Essay's original signed
// event into EssayVault's committed vault (src/curate-capture.js +
// src/essay-vault.js, #157/#159) — the curate flow can no longer add a
// coordinate whose body isn't actually obtainable and valid. Capture failure
// (unobtainable bytes, bad signature, mismatched coordinate, wrong kind)
// aborts before printing COORDINATE, so the skill never proceeds to write a
// Curation entry for an Essay whose body isn't safely vaulted.
//
// Usage (run from the repo root):
//   node .claude/skills/curate-essay/scripts/extract.mjs '<naddr-or-njump-url>'
//   node .claude/skills/curate-essay/scripts/extract.mjs '<coordinate>' --relays wss://a,wss://b
//   node .claude/skills/curate-essay/scripts/extract.mjs --file event.json
//   <paste kind:30023 JSON> | node .claude/skills/curate-essay/scripts/extract.mjs
//
// Accepts: raw kind:30023 event JSON (preferred — no relay fetch needed), an
// naddr1… string (relay hints honored), an njump/habla URL containing one, or
// a bare 30023:<hex>:<id> coordinate — the last requires --relays (comma-
// separated) since a bare coordinate carries no relay hints of its own.

import { readFileSync } from 'node:fs';
import { nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { parseLongFormEvent } from '../../../../src/essay-data.js';
import { isValidSlug } from '../../../../src/essay-slug.js';
import { ESSAYS, NAMES, toHexPubkey } from '../../../../scripts/publish-curation.mjs';
import { createEssayVault } from '../../../../src/essay-vault.js';
import { createFileVaultStore } from '../../../../src/vault-store.js';
import { createRelayPort } from '../../../../src/relay-port.js';
import { captureEssayFromInput } from '../../../../src/curate-capture.js';
import { READER_RELAYS } from '../../../../src/brand.js';

const LONG_FORM_KIND = 30023;
const COORD_RE = /^30023:[0-9a-f]{64}:.*/i;
const NADDR_RE = /naddr1[0-9a-z]+/i;

function die(msg) {
  console.error(`extract: ${msg}`);
  process.exit(1);
}

// title/identifier → a regex-valid slug seed (lowercase, hyphen-joined a-z0-9).
const COMBINING_MARKS = /[̀-ͯ]/g; // diacritics left behind by NFKD
function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Pull an optional `--relays r1,r2,r3` flag out of the arg list (used to
// supply explicit source relays for a bare coordinate, or extra hints
// alongside an naddr's own embedded relays). Mutates a copy, leaves the rest
// of the args untouched.
function extractRelaysFlag(args) {
  const rest = [...args];
  const idx = rest.indexOf('--relays');
  if (idx === -1) return { rest, relays: [] };
  const csv = rest[idx + 1];
  if (!csv) die('--relays needs a comma-separated list of relay URLs');
  rest.splice(idx, 2);
  return { rest, relays: csv.split(',').map((s) => s.trim()).filter(Boolean) };
}

// Resolve input into { coordinate, title, summary, pubkey, captureInput }
// from any form. `captureInput` is handed straight to
// src/curate-capture.js's captureEssayFromInput — see #159.
function resolveInput(argv) {
  const { rest: args, relays: extraRelays } = extractRelaysFlag(argv);

  if (args[0] === '--file') {
    if (!args[1]) die('--file needs a path');
    return fromJson(readFileSync(args[1], 'utf8'), args[1]);
  }
  const token = args[0];
  if (token && !token.startsWith('--')) return fromToken(token, extraRelays);

  // No usable arg — read stdin (a piped JSON event).
  let stdin = '';
  try {
    stdin = readFileSync(0, 'utf8');
  } catch {
    /* no stdin */
  }
  if (stdin.trim()) return fromJson(stdin, 'stdin');
  die('no input — pass an naddr/URL/coordinate, --file <path>, or pipe event JSON');
}

function fromJson(text, where) {
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    die(`${where} is not valid JSON (paste the raw kind:30023 event, or an naddr)`);
  }
  const essay = parseLongFormEvent(event);
  if (!essay) {
    die(`${where} is not a usable kind:${LONG_FORM_KIND} event (need kind 30023 + 64-hex pubkey)`);
  }
  return {
    coordinate: essay.coordinateString,
    title: essay.title,
    summary: essay.summary,
    pubkey: essay.pubkey,
    captureInput: { rawEvent: event },
    relaysUsed: [], // raw bytes already in hand — no network fetch needed
  };
}

function fromToken(token, extraRelays) {
  if (COORD_RE.test(token.trim())) {
    const coordinate = token.trim();
    if (extraRelays.length === 0) {
      die('a bare coordinate carries no relay hints — pass --relays r1,r2,... with source relays that hold this event');
    }
    return {
      coordinate,
      title: '',
      summary: '',
      pubkey: coordinate.split(':')[1],
      captureInput: { coordinate, relays: extraRelays },
      relaysUsed: extraRelays,
    };
  }
  if (/^(nevent1|note1)/i.test(token)) {
    die('that is an event-id pointer (nevent/note), not an addressable coordinate — paste the kind:30023 JSON or an naddr instead');
  }
  const m = token.match(NADDR_RE);
  if (!m) die('could not find an naddr or 30023 coordinate in the input');
  let decoded;
  try {
    decoded = nip19.decode(m[0]);
  } catch {
    die(`could not decode ${m[0]}`);
  }
  if (decoded.type !== 'naddr') die(`expected an naddr, got ${decoded.type}`);
  const { kind, pubkey, identifier, relays: naddrRelays } = decoded.data;
  if (kind !== LONG_FORM_KIND) die(`naddr is kind:${kind}, not a long-form Essay (kind:${LONG_FORM_KIND})`);
  const relaysUsed = [...(naddrRelays ?? []), ...extraRelays];
  return {
    coordinate: `${kind}:${pubkey}:${identifier}`,
    title: '',
    summary: '',
    pubkey,
    captureInput: { naddr: m[0], extraRelays },
    relaysUsed,
  };
}

async function main() {
  const { coordinate, title, summary, pubkey, captureInput, relaysUsed } = resolveInput(process.argv.slice(2));

  // Capture the Essay's original signed event into the committed vault
  // BEFORE printing anything (#159) — if this throws, no COORDINATE line is
  // ever printed and the skill must not proceed to write a Curation entry.
  // Close exactly the relays this capture actually connected to (the
  // pointer's source relays, not the unrelated reader set) — otherwise the
  // pool's sockets for those relays are never released and the process hangs.
  const pool = new SimplePool();
  let capturedCoordinate;
  try {
    const relayPort = createRelayPort(pool);
    const vault = createEssayVault({
      relayPort,
      store: createFileVaultStore(),
      readerRelays: READER_RELAYS,
    });
    capturedCoordinate = await captureEssayFromInput(captureInput, { vault, relayPort });
  } catch (err) {
    pool.close(relaysUsed);
    die(`capture failed — refusing to add this Essay: ${err.message}`);
    return; // unreachable (die() exits the process) — keeps control flow explicit
  }
  pool.close(relaysUsed);
  console.log(`CAPTURED:                 ${capturedCoordinate} (committed to vault/essays/)`);

  // Compare the author against the brand's NAMES map (entries may be npub or hex).
  const namesHex = new Map();
  for (const { pubkey: pk, name } of NAMES) {
    try {
      namesHex.set(toHexPubkey(pk), name);
    } catch {
      /* skip malformed NAMES entry */
    }
  }
  const existingSlugs = ESSAYS.map((e) => e.slug).filter(Boolean);
  const alreadyListed = ESSAYS.some((e) => e.coordinate === coordinate);
  const seed = slugify(title) || slugify(coordinate.split(':')[2]);

  console.log(`COORDINATE:               ${coordinate}`);
  console.log(`TITLE:                    ${title || '(none — no title tag)'}`);
  if (summary) console.log(`SUMMARY:                  ${summary}`);
  console.log(`AUTHOR_HEX:               ${pubkey}`);
  console.log(`AUTHOR_IN_NAMES:          ${namesHex.has(pubkey) ? `yes (${namesHex.get(pubkey)})` : 'NO — needs a NAMES entry'}`);
  console.log(`COORDINATE_ALREADY_LISTED:${alreadyListed ? ' YES — already in ESSAYS' : ' no'}`);
  console.log(`SLUG_SEED:                ${seed}${isValidSlug(seed) ? '' : '  (seed invalid — propose a clean slug)'}`);
  console.log(`EXISTING_SLUGS:           ${existingSlugs.join(', ') || '(none)'}`);
}

main().catch((err) => {
  console.error('extract:', err.message);
  process.exit(1);
});
