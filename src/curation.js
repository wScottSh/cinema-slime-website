// The Curation as a domain value, and the pure edits the Curator makes to it.
//
// A Curation is the brand's kind:30001 list in domain form:
//
//   { entries: [{ coordinate, slug }], names: [{ pubkey, name }], createdAt, eventId }
//
// `entries` order is display order. curationFromEvent and curationToTags are
// the only code that reads or writes the list's `a`/`p` tags; everything else
// works on this shape. (The site's read path, essay-curation.js, keeps its own
// lenient parser: a visitor should still see a list this strict codec refuses
// to edit.)
import { CURATION_LIST_IDENTIFIER, CURATION_LIST_KIND } from './brand.js';
import { isValidSlug, pickSlug } from './essay-slug.js';

export function curationFromEvent(event) {
  if (event?.kind !== CURATION_LIST_KIND) throw new Error(`not a kind:${CURATION_LIST_KIND} event`);
  const d = event.tags.find((t) => t[0] === 'd')?.[1];
  if (d !== CURATION_LIST_IDENTIFIER) throw new Error(`not the "${CURATION_LIST_IDENTIFIER}" list (d=${d})`);
  const entries = [];
  const names = [];
  const coordinates = new Set();
  const slugs = new Set();
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const slug = tag[3] || null;
      if (slug !== null && !isValidSlug(slug)) throw new Error(`malformed slug "${slug}" on ${tag[1]}`);
      // A corrupt live list must never be edited and republished.
      if (coordinates.has(tag[1])) throw new Error(`duplicate coordinate ${tag[1]}`);
      if (slug && slugs.has(slug)) throw new Error(`duplicate slug "${slug}"`);
      coordinates.add(tag[1]);
      if (slug) slugs.add(slug);
      entries.push({ coordinate: tag[1], slug });
    }
    if (tag[0] === 'p' && tag[1] && tag[3]) names.push({ pubkey: tag[1], name: tag[3] });
  }
  return { entries, names, createdAt: event.created_at, eventId: event.id };
}

export function curationToTags(curation) {
  return [
    ['d', CURATION_LIST_IDENTIFIER],
    ...curation.entries.map(({ coordinate, slug }) => (slug ? ['a', coordinate, '', slug] : ['a', coordinate])),
    ...curation.names.map(({ pubkey, name }) => ['p', pubkey, '', name]),
  ];
}

export function nameOf(curation, pubkey) {
  return curation.names.find((n) => n.pubkey === pubkey)?.name ?? null;
}

function slugOwner(curation, slug) {
  return curation.entries.find((e) => e.slug === slug)?.coordinate ?? null;
}

function refused(reason, detail = {}) {
  return { kind: 'refused', reason, ...detail };
}

// Re-curating a listed Essay never re-picks or changes its slug: a differing
// `slug` is refused and points at `rename`, because changing a slug breaks
// every link already shared.
export function applyCurate(curation, { coordinate, title, author, identifier, slug, name }) {
  const listed = curation.entries.find((e) => e.coordinate === coordinate);
  if (listed) {
    if (slug && slug !== listed.slug) return refused('slug-locked', { slug: listed.slug, requested: slug });
    return { kind: 'edit', change: 'unchanged', next: curation, entry: listed };
  }
  if (slug && slugOwner(curation, slug)) return refused('slug-taken', { slug });
  // Names are brand-controlled and never guessed from a profile.
  if (!name && !nameOf(curation, author)) return refused('author-unnamed', { author });
  const entry = {
    coordinate,
    slug: slug ?? pickSlug(title, new Set(curation.entries.map((e) => e.slug).filter(Boolean)), identifier),
  };
  const names = name
    ? [...curation.names.filter((n) => n.pubkey !== author), { pubkey: author, name }]
    : curation.names;
  return {
    kind: 'edit',
    change: 'added',
    next: { ...curation, entries: [...curation.entries, entry], names, eventId: null },
    entry,
  };
}

export function applyRename(curation, { coordinate, slug }) {
  const listed = curation.entries.find((e) => e.coordinate === coordinate);
  if (!listed) return refused('not-listed', { coordinate });
  if (listed.slug === slug) return { kind: 'edit', change: 'unchanged', next: curation, entry: listed };
  if (slugOwner(curation, slug)) return refused('slug-taken', { slug });
  const entry = { coordinate, slug };
  return {
    kind: 'edit',
    change: 'renamed',
    next: { ...curation, entries: curation.entries.map((e) => (e === listed ? entry : e)), eventId: null },
    entry,
    previousSlug: listed.slug,
  };
}
