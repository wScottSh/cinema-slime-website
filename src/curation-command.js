// What a Curator request asks for, parsed once at the boundary (a Discord
// mention or the break-glass CLI). Nothing downstream re-reads message text.
//
//   { kind: 'curate', link, slug?, name? }
//   { kind: 'rename', link, slug }
//   { kind: 'help' }
//   { kind: 'unknown', reason }   reason: no-link | not-an-essay | bad-slug | bad-name | rename-needs-slug
//
// link is { coordinate, naddr? }: the Essay's kind:30023 coordinate, plus the
// naddr it came from when there was one (its relay hints help capture).
import { nip19 } from 'nostr-tools';
import { parseCoordinate } from './essay-coordinate.js';
import { isValidSlug } from './essay-slug.js';

const ESSAY_KIND = 30023;
const NADDR = /naddr1[02-9ac-hj-np-z]+/i;
const COORDINATE = /^30023:[0-9a-f]{64}:\S+$/;

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

export function buildCommand({ verb = 'curate', input, slug, name }) {
  if (verb === 'help') return { kind: 'help' };
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

// `@bot <link> [slug:x] [name:Y | name:"Y Z"]`, `@bot <link> rename slug:x`, `@bot help`.
export function parseMention(content, botUserId) {
  const text = String(content ?? '').replaceAll(`<@${botUserId}>`, ' ').replaceAll(`<@!${botUserId}>`, ' ');
  const name = valueOf([...text.matchAll(NAME)][0])?.trim();
  const slug = valueOf([...text.matchAll(SLUG)][0]);
  const rest = text.replace(NAME, ' ').replace(SLUG, ' ');
  // An unmatched or extra quote means the name was not read as written.
  if (name !== undefined && (!name || QUOTES.test(name) || QUOTES.test(rest))) return { kind: 'unknown', reason: 'bad-name' };
  const words = rest.split(/\s+/).filter(Boolean);
  if (words.length === 0 || (words.length === 1 && /^help$/i.test(words[0]))) return { kind: 'help' };
  const verb = words.some((w) => /^rename$/i.test(w)) ? 'rename' : 'curate';
  // Discord users wrap a link in <...> to suppress its embed.
  const input = words.map((w) => w.replace(/^<|>$/g, '')).find((w) => parseLink(w));
  return buildCommand({ verb, input, slug, name });
}
