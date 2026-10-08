// The one Link Preview page writer (ADR 0020), shared by
// scripts/render-share-pages.mjs (deploy and the hourly refresh) and the
// Curator bot, so every writer of html/essay/ projects the same Curation into
// the same bytes.
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLongFormEvent } from './essay-data.js';
import { essayShareMeta, injectShareMeta, isSafeSegment } from './share-meta.js';
import { nameOf } from './curation.js';

// An Essay is reachable by its Slug and by its coordinate; both unfurl the
// same, and both point og:url at the canonical (Slug-first) address.
export function essayPageSpecs(entries) {
  return entries.flatMap((entry) => {
    const meta = essayShareMeta(entry);
    return [entry.slug, entry.coordinate].filter(Boolean).map((segment) => ({ segment, meta }));
  });
}

// Discovery-shaped entries ({ coordinate, essay, slug }) for every Curation
// entry, from stored bodies instead of a relay read. `loadBody(coordinate)`
// returns the signed kind:30023 event or null; entries without one are
// returned in `missing`.
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
    entries.push({ coordinate, essay: { ...essay, authorName }, slug: slug ?? undefined });
  }
  return { entries, missing };
}

// Writes <root>/<segment>/index.html for every page and removes segment
// directories not in `pages`. Each file is written beside its target and
// renamed over it, so a visitor or unfurler never reads a half-written page.
export async function writeSharePages(root, pages, template) {
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
