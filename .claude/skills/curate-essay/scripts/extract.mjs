// Deterministic extractor for the curate-essay skill.
//
// Turns a pasted Nostr long-form post into everything needed to add it to the
// ESSAYS list in scripts/publish-curation.mjs — except the slug, which is the
// one human decision. Reuses the site's own parser so the coordinate it emits
// is byte-identical to what the site reads back off the relay.
//
// Usage (run from the repo root):
//   node .claude/skills/curate-essay/scripts/extract.mjs '<naddr-or-njump-url>'
//   node .claude/skills/curate-essay/scripts/extract.mjs --file event.json
//   <paste kind:30023 JSON> | node .claude/skills/curate-essay/scripts/extract.mjs
//
// Accepts: raw kind:30023 event JSON, an naddr1… string, an njump/habla URL
// containing one, or a bare 30023:<hex>:<id> coordinate.

import { readFileSync } from 'node:fs';
import { nip19 } from 'nostr-tools';
import { parseLongFormEvent } from '../../../../src/essay-data.js';
import { isValidSlug } from '../../../../src/essay-slug.js';
import { ESSAYS, NAMES, toHexPubkey } from '../../../../scripts/publish-curation.mjs';

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

// Resolve input into { coordinate, title, summary, pubkey } from any form.
function resolveInput(args) {
  if (args[0] === '--file') {
    if (!args[1]) die('--file needs a path');
    return fromJson(readFileSync(args[1], 'utf8'), args[1]);
  }
  const token = args[0];
  if (token && !token.startsWith('--')) return fromToken(token);

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
  };
}

function fromToken(token) {
  if (COORD_RE.test(token.trim())) {
    const coordinate = token.trim();
    return { coordinate, title: '', summary: '', pubkey: coordinate.split(':')[1] };
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
  const { kind, pubkey, identifier } = decoded.data;
  if (kind !== LONG_FORM_KIND) die(`naddr is kind:${kind}, not a long-form Essay (kind:${LONG_FORM_KIND})`);
  return { coordinate: `${kind}:${pubkey}:${identifier}`, title: '', summary: '', pubkey };
}

const { coordinate, title, summary, pubkey } = resolveInput(process.argv.slice(2));

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
