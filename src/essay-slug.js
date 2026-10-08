const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const EPISODE = /\bS(\d+)E(\d+)\b/i;
const ISSUE = /#(\d+)\b/;

// Titles follow "<piece> - <work>". A part carrying an episode marker (S1E5,
// anywhere in the part) or an issue marker (#1) names the Essay by that work
// plus its number: "spider-man-noir-s1e5", "absolute-batman-1". Anything else
// (a film, a standalone piece) is named by its first part, with a standalone
// " x " separator dropped so a trailing year stays. Both cut at the first ":".
function deriveSlug(title) {
  const parts = String(title ?? '').replace(/\(spoilers?\)/gi, '').trim().split(/\s+-\s+/);
  for (const part of parts) {
    const episode = part.match(EPISODE);
    const marker = episode ?? part.match(ISSUE);
    if (!marker) continue;
    const work = slugify(part.replace(marker[0], ' ').split(':')[0]);
    const number = episode ? `s${Number(episode[1])}e${Number(episode[2])}` : String(Number(marker[1]));
    return [work, number].filter(Boolean).join('-');
  }
  return slugify(parts[0].split(':')[0].replace(/\s+x\s+/gi, ' '));
}

// The standard Essay Slug for a title (ADR 0022), never one in `taken`:
// current slugs and Slug Aliases share one namespace, and a collision gets
// -2, -3, ... essay-slug.test.js pins the rule against every historical title.
export function pickSlug(title, taken, fallback = 'essay') {
  const base = deriveSlug(title) || slugify(fallback) || 'essay';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}
