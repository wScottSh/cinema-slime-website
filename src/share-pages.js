// The one Link Preview page writer (ADR 0020), shared by
// scripts/render-share-pages.mjs (deploy and the hourly refresh) and the
// Curator bot, so every writer of html/essay/ projects the same Curation into
// the same bytes.
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLongFormEvent } from './essay-data.js';
import { essayShareMeta, injectShareMeta, isSafeSegment } from './share-meta.js';
import { nameOf } from './curation.js';

// An Essay is reachable by its Slug, its coordinate, and every Slug Alias it
// has had; all unfurl the same, and all point og:url at the canonical
// (Slug-first) address, so an old shared link previews and lands correctly.
export function essayPageSpecs(entries) {
  return entries.flatMap((entry) => {
    const meta = essayShareMeta(entry);
    return [entry.slug, entry.coordinate, ...entry.aliases].filter(Boolean).map((segment) => ({ segment, meta }));
  });
}

// Discovery-shaped entries ({ coordinate, essay, slug, aliases }) for every
// Curation entry, from stored bodies instead of a relay read.
// `loadBody(coordinate)` returns the signed kind:30023 event or null; entries
// without one are returned in `missing`.
export function essayEntriesFromCuration(curation, loadBody) {
  const entries = [];
  const missing = [];
  for (const { coordinate, slug } of curation.entries) {
    const essay = parseLongFormEvent(loadBody(coordinate));
    if (!essay) {
      missing.push(coordinate);
      continue;
    }
    const authorName = nameOf(curation, essay.pubkey) ?? '';
    const aliases = curation.aliases.filter((a) => a.coordinate === coordinate).map((a) => a.slug);
    entries.push({ coordinate, essay: { ...essay, authorName }, slug: slug ?? undefined, aliases });
  }
  return { entries, missing };
}

// The tags injectShareMeta replaces. A truncated or foreign html/index.html
// would otherwise become every Essay Page.
const TEMPLATE_MARKERS = ['</head>', 'property="og:url"', 'property="og:title"', 'name="twitter:card"'];
const TEMPLATE_MIN_LENGTH = 1000;
const TMP_FILE = /^\.index\.html\..+\.tmp$/;
// Long past any write in flight, so a concurrent writer's temp file survives.
const STALE_TMP_MS = 60 * 60 * 1000;

// Temp files a killed writer left beside a page.
async function sweepStaleTmp(dir) {
  for (const name of await readdir(dir)) {
    if (!TMP_FILE.test(name)) continue;
    const path = join(dir, name);
    const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: Date.now() }));
    if (Date.now() - mtimeMs > STALE_TMP_MS) await rm(path, { force: true });
  }
}

export function templateProblem(html) {
  if (typeof html !== 'string' || html.length < TEMPLATE_MIN_LENGTH) {
    return `is ${String(html ?? '').length} characters, not a full page`;
  }
  const missing = TEMPLATE_MARKERS.filter((marker) => !html.includes(marker));
  return missing.length ? `lacks ${missing.join(', ')}` : null;
}

// Writes <root>/<segment>/index.html for every page and removes segment
// directories not in `pages`. Each file is written beside its target and
// renamed over it, so a visitor or unfurler never reads a half-written page.
export async function writeSharePages(root, pages, template) {
  const problem = templateProblem(template);
  if (problem) throw new Error(`refusing to write Essay Pages: the template ${problem}`);
  await mkdir(root, { recursive: true });
  const keep = new Set();
  let written = 0;
  const skipped = [];
  for (const { segment, meta } of pages) {
    if (!isSafeSegment(segment)) {
      skipped.push(segment);
      continue;
    }
    const dir = join(root, segment);
    const tmp = join(dir, `.index.html.${process.pid}.tmp`);
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, injectShareMeta(template, meta));
    await rename(tmp, join(dir, 'index.html'));
    await sweepStaleTmp(dir);
    keep.add(segment);
    written++;
  }
  let pruned = 0;
  for (const name of await readdir(root)) {
    if (name.startsWith('.') || keep.has(name)) continue;
    await rm(join(root, name), { recursive: true, force: true });
    pruned++;
  }
  return { written, skipped, pruned };
}
