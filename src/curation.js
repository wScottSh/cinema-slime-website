// The Curation as a domain value, and the pure edits the Curator makes to it.
//
// A Curation is the brand's kind:30001 list in domain form:
//
//   { entries: [{ coordinate, slug }], aliases: [{ slug, coordinate }],
//     names: [{ pubkey, name }], createdAt, eventId }
//
// `entries` order is display order. A Slug Alias is a slug an Essay used to
// have; its old links resolve to the Essay's current address (ADR 0022).
// Current slugs and aliases share one namespace. curationFromEvent and
// curationToTags are the only code that reads or writes the list's
// `a`/`alias`/`p` tags; everything else works on this shape. (The site's read
// path, essay-curation.js, keeps its own lenient parser: a visitor should
// still see a list this strict codec refuses to edit.)
import { CURATION_LIST_IDENTIFIER, CURATION_LIST_KIND } from './brand.js';
import { isValidSlug, pickSlug } from './essay-slug.js';

export function curationFromEvent(event) {
  if (event?.kind !== CURATION_LIST_KIND) throw new Error(`not a kind:${CURATION_LIST_KIND} event`);
  const d = event.tags.find((t) => t[0] === 'd')?.[1];
  if (d !== CURATION_LIST_IDENTIFIER) throw new Error(`not the "${CURATION_LIST_IDENTIFIER}" list (d=${d})`);
  const entries = [];
  const aliases = [];
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
    if (tag[0] === 'alias') aliases.push({ slug: tag[1], coordinate: tag[2] });
    if (tag[0] === 'p' && tag[1] && tag[3]) names.push({ pubkey: tag[1], name: tag[3] });
  }
  for (const { slug, coordinate } of aliases) {
    if (!isValidSlug(slug)) throw new Error(`malformed alias "${slug}"`);
    if (!coordinates.has(coordinate)) throw new Error(`alias "${slug}" points at unlisted ${coordinate}`);
    if (slugs.has(slug)) throw new Error(`duplicate slug "${slug}" (an alias shadows a slug or another alias)`);
    slugs.add(slug);
  }
  return { entries, aliases, names, createdAt: event.created_at, eventId: event.id };
}

export function curationToTags(curation) {
  return [
    ['d', CURATION_LIST_IDENTIFIER],
    ...curation.entries.map(({ coordinate, slug }) => (slug ? ['a', coordinate, '', slug] : ['a', coordinate])),
    ...curation.aliases.map(({ slug, coordinate }) => ['alias', slug, coordinate]),
    ...curation.names.map(({ pubkey, name }) => ['p', pubkey, '', name]),
  ];
}

export function nameOf(curation, pubkey) {
  return curation.names.find((n) => n.pubkey === pubkey)?.name ?? null;
}

// The coordinate a slug or alias resolves to, or null when it is free.
function slugOwner(curation, slug) {
  return curation.entries.find((e) => e.slug === slug)?.coordinate
    ?? curation.aliases.find((a) => a.slug === slug)?.coordinate
    ?? null;
}

function takenSlugs(curation) {
  return new Set([...curation.entries.map((e) => e.slug).filter(Boolean), ...curation.aliases.map((a) => a.slug)]);
}

function refused(reason, detail = {}) {
  return { kind: 'refused', reason, ...detail };
}

// Moving an Essay from one slug to another: the old slug becomes its alias,
// and reclaiming one of its own aliases removes that alias.
function moveSlug(aliases, coordinate, from, to) {
  const kept = aliases.filter((a) => a.slug !== to);
  return from ? [...kept, { slug: from, coordinate }] : kept;
}

// Re-curating a listed Essay never re-picks or changes its slug: a differing
// `slug` is refused and points at `rename`.
export function applyCurate(curation, { coordinate, title, author, identifier, slug, name }) {
  const listed = curation.entries.find((e) => e.coordinate === coordinate);
  if (listed) {
    if (slug && slug !== listed.slug) return refused('slug-locked', { slug: listed.slug, requested: slug });
    return { kind: 'edit', change: 'unchanged', next: curation, entry: listed };
  }
  if (slug && slugOwner(curation, slug)) return refused('slug-taken', { slug });
  // Names are brand-controlled and never guessed from a profile.
  if (!name && !nameOf(curation, author)) return refused('author-unnamed', { author });
  const entry = { coordinate, slug: slug ?? pickSlug(title, takenSlugs(curation), identifier) };
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
  const owner = slugOwner(curation, slug);
  if (owner && owner !== coordinate) return refused('slug-taken', { slug });
  const entry = { coordinate, slug };
  return {
    kind: 'edit',
    change: 'renamed',
    next: {
      ...curation,
      entries: curation.entries.map((e) => (e === listed ? entry : e)),
      aliases: moveSlug(curation.aliases, coordinate, listed.slug, slug),
      eventId: null,
    },
    entry,
    previousSlug: listed.slug,
  };
}

// Re-derives every slug with pickSlug, in list order. A slug is never handed
// to an Essay while another Essay still owns it (as a slug not yet
// re-derived, or as an alias), so the result never shadows one. Each changed
// slug becomes its Essay's alias, so every shared link keeps working.
// `titles` maps each listed coordinate to its Essay's title.
export function applyStandardize(curation, titles) {
  const missing = curation.entries.map((e) => e.coordinate).filter((c) => !titles.has(c));
  if (missing.length) return refused('titles-missing', { missing });
  let aliases = curation.aliases;
  const assigned = new Set();
  const changes = [];
  const entries = curation.entries.map((entry, i) => {
    const { coordinate } = entry;
    const reserved = new Set([
      ...assigned,
      ...curation.entries.slice(i + 1).map((e) => e.slug).filter(Boolean),
      ...aliases.filter((a) => a.coordinate !== coordinate).map((a) => a.slug),
    ]);
    const slug = pickSlug(titles.get(coordinate), reserved, coordinate.split(':').slice(2).join(':'));
    assigned.add(slug);
    if (slug === entry.slug) return entry;
    aliases = moveSlug(aliases, coordinate, entry.slug, slug);
    changes.push({ coordinate, title: titles.get(coordinate), from: entry.slug, to: slug });
    return { coordinate, slug };
  });
  if (!changes.length) return { kind: 'edit', change: 'unchanged', next: curation, changes };
  return { kind: 'edit', change: 'standardized', next: { ...curation, entries, aliases, eventId: null }, changes };
}
