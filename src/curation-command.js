// What a Curator request asks for, parsed once at the boundary (a Discord
// mention or the break-glass CLI). Nothing downstream re-reads message text.
//
//   { kind: 'curate', link, slug?, name? }
//   { kind: 'rename', link, slug }
//   { kind: 'standardize', dryRun }   CLI only: parseMention never yields it
//   { kind: 'intake', craig: { id, key }, title? }   a Craig recording to start an Episode from (ADR 0023)
//   { kind: 'help' }
//   { kind: 'unknown', reason }   reason: no-link | not-an-essay | bad-slug | bad-name | rename-needs-slug
//                                         | craig-needs-key | two-links
//
// link is { coordinate, naddr? }: the Essay's kind:30023 coordinate, plus the
// naddr it came from when there was one (its relay hints help capture).
import { nip19 } from 'nostr-tools';
import { parseCoordinate } from './essay-coordinate.js';
import { isValidSlug } from './essay-slug.js';

const ESSAY_KIND = 30023;
const NADDR = /naddr1[02-9ac-hj-np-z]+/i;
const COORDINATE = /^30023:[0-9a-f]{64}:\S+$/;

const CRAIG_HOSTS = new Set(['craig.horse', 'craig.chat']);
const CRAIG_ID = /^\/rec\/([A-Za-z0-9]+)\/?$/;
const CRAIG_KEY = /^[A-Za-z0-9]+$/;

// A Craig recording link, `https://craig.horse/rec/<id>?key=<key>`. Only id and
// key are kept: the link can also carry Craig's delete key, which must never
// leave this function.
function parseCraigLink(word) {
  let url;
  try {
    url = new URL(word);
  } catch {
    return null;
  }
  const id = url.protocol === 'https:' && CRAIG_HOSTS.has(url.hostname) ? url.pathname.match(CRAIG_ID)?.[1] : undefined;
  if (!id) return null;
  const key = url.searchParams.get('key');
  return CRAIG_KEY.test(key ?? '') ? { id, key } : { id, noKey: true };
}

// Accepts an naddr anywhere in the text (bare, or inside an njump / habla /
// yakihonne / primal URL) or a bare 30023 coordinate.
export function parseLink(text) {
  const naddr = String(text ?? '').match(NADDR)?.[0];
  if (naddr) {
    let decoded;
    try {
      decoded = nip19.decode(naddr.toLowerCase());
    } catch {
      return null;
    }
    const { kind, pubkey, identifier } = decoded.data;
    if (kind !== ESSAY_KIND) return { notAnEssay: true };
    return { coordinate: `${kind}:${pubkey}:${identifier}`, naddr: naddr.toLowerCase() };
  }
  const coordinate = String(text ?? '').trim();
  return COORDINATE.test(coordinate) && parseCoordinate(coordinate) ? { coordinate } : null;
}

export function buildCommand({ verb = 'curate', input, slug, name, dryRun = false }) {
  if (verb === 'help') return { kind: 'help' };
  if (verb === 'standardize') return { kind: 'standardize', dryRun };
  const link = input ? parseLink(input) : null;
  if (!link) return { kind: 'unknown', reason: 'no-link' };
  if (link.notAnEssay) return { kind: 'unknown', reason: 'not-an-essay' };
  if (slug !== undefined && !isValidSlug(slug)) return { kind: 'unknown', reason: 'bad-slug', slug };
  if (verb === 'rename') {
    return slug ? { kind: 'rename', link, slug } : { kind: 'unknown', reason: 'rename-needs-slug' };
  }
  const command = { kind: 'curate', link };
  if (slug) command.slug = slug;
  if (name) command.name = name;
  return command;
}

// Phones type curly quotes, so “Y Z” delimits a value like "Y Z" does.
const QUOTES = /["“”]/;
const NAME = /\bname:(?:["“”]([^"“”]*)["“”]|(\S*))/gi;
const SLUG = /\bslug:(?:["“”]([^"“”\s]*)["“”]|(\S*))/gi;
const valueOf = (match) => (match ? (match[1] ?? match[2]) : undefined);

// How a message can address the bot: its user, its nickname form, and the
// role Discord manages for it (what autocomplete offers when both share a name).
export function botMentionTokens(botUserId, botRoleId = null) {
  return [`<@${botUserId}>`, `<@!${botUserId}>`, ...(botRoleId ? [`<@&${botRoleId}>`] : [])];
}

// Discord users wrap a link in <...> to suppress its embed.
const unwrap = (word) => word.replace(/^<|>$/g, '');

// `@bot <craig link> [title]`: every other word is the Episode's title. One
// request per mention, so a second link of either kind is refused, not guessed.
function parseIntake(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const craigWords = words.filter((w) => parseCraigLink(unwrap(w)));
  if (craigWords.length === 0) return null;
  const others = words.filter((w) => !craigWords.includes(w));
  if (craigWords.length > 1 || others.some((w) => parseLink(unwrap(w)))) return { kind: 'unknown', reason: 'two-links' };
  const craig = parseCraigLink(unwrap(craigWords[0]));
  if (craig.noKey) return { kind: 'unknown', reason: 'craig-needs-key' };
  const command = { kind: 'intake', craig };
  const title = others.join(' ');
  if (title) command.title = title;
  return command;
}

// `@bot <link> [slug:x] [name:Y | name:"Y Z"]`, `@bot <link> rename slug:x`,
// `@bot <craig link> [title]`, `@bot help`.
export function parseMention(content, botUserId, botRoleId = null) {
  const text = botMentionTokens(botUserId, botRoleId).reduce((t, token) => t.replaceAll(token, ' '), String(content ?? ''));
  const intake = parseIntake(text);
  if (intake) return intake;
  const name = valueOf([...text.matchAll(NAME)][0])?.trim();
  const slug = valueOf([...text.matchAll(SLUG)][0]);
  const rest = text.replace(NAME, ' ').replace(SLUG, ' ');
  // An unmatched or extra quote means the name was not read as written.
  if (name !== undefined && (!name || QUOTES.test(name) || QUOTES.test(rest))) return { kind: 'unknown', reason: 'bad-name' };
  const words = rest.split(/\s+/).filter(Boolean);
  if (words.length === 0 || (words.length === 1 && /^help$/i.test(words[0]))) return { kind: 'help' };
  const verb = words.some((w) => /^rename$/i.test(w)) ? 'rename' : 'curate';
  const input = words.map(unwrap).find((w) => parseLink(w));
  return buildCommand({ verb, input, slug, name });
}
