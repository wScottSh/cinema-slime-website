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

// The Essay Slug the Curator proposes for a new Official Essay. Titles follow
// "<piece> - <work>"; a numbered comic issue is named by its series (issue #1
// drops the number), anything else by its piece. essay-slug.test.js pins the
// rule against every historical title, including the ones where the operator
// chose differently.
export function pickSlug(title, taken, fallback = 'essay') {
  const t = String(title ?? '').trim().replace(/\s*\(spoilers?\)\s*$/i, '');
  const [piece, ...rest] = t.split(/\s+-\s+/);
  const issue = rest.join(' - ').match(/^(.*?)\s*#(\d+)\s*$/);
  const derived = issue
    ? [slugify(issue[1].split(':')[0]), Number(issue[2]) > 1 ? issue[2] : ''].filter(Boolean).join('-')
    : slugify(piece.split(':')[0]);
  const base = derived || slugify(fallback) || 'essay';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}
