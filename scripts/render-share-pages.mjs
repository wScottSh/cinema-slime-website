// Writes one Link Preview page per Episode Page and Essay Page (ADR 0020):
//
//   <out>/episode/<guid>/index.html
//   <out>/essay/<slug>/index.html  and  <out>/essay/<coordinate>/index.html
//
// Each is the template (the built index.html) with that page's own <title>,
// description, Open Graph and Twitter Card tags. nginx's existing
// `try_files $uri $uri/ /index.html` serves /episode/<guid> from the matching
// directory; a page with no file yet (a brand-new Episode before the next
// refresh) falls through to index.html and unfurls with the site-wide preview.
//
// Data comes from the same sources the site reads: the Anchor feed and the
// brand relay set. A source that fails is reported and skipped — the other
// still renders — and the script exits 1 so the failure is visible.
//
// Run: node scripts/render-share-pages.mjs [--template dist/index.html] [--out dist]
//      (or `npm run build:share`, after `npm run build`)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DOMParser } from '@xmldom/xmldom';
import { parseEpisodes } from '../src/rss-parse.js';
import { fetchEssaysForDiscovery } from '../src/nostr-pool.js';
import { SHOW_ART, episodeShareMeta } from '../src/share-meta.js';
import { essayPageSpecs, writeSharePages } from '../src/share-pages.js';

const FEED_URL = 'https://anchor.fm/s/1050fb0e4/podcast/rss';

async function fetchEpisodes() {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`feed answered HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const episodes = parseEpisodes(doc, SHOW_ART).filter((ep) => ep.guid);
  if (!episodes.length) throw new Error('feed parsed to zero Episodes');
  return episodes;
}

async function fetchEssays() {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error(`Node ${process.version} has no global WebSocket; run on Node 22+`);
  }
  const entries = await fetchEssaysForDiscovery({ timeout: 15_000 });
  if (entries === null) throw new Error('relay fetch failed');
  return entries;
}

// One directory per route segment; a removed Episode or Essay's directory is
// pruned so it does not leave a stale page behind.
async function writePages(outDir, routeDir, pages, template) {
  const { written, skipped } = await writeSharePages(join(outDir, routeDir), pages, template);
  for (const segment of skipped) console.warn(`  skip ${routeDir}/${segment}: not a safe directory name`);
  return written;
}

async function main() {
  const { values } = parseArgs({
    options: {
      template: { type: 'string', default: 'dist/index.html' },
      out: { type: 'string', default: 'dist' },
    },
  });
  const template = await readFile(values.template, 'utf-8');
  const failures = [];

  const [episodes, essays] = await Promise.allSettled([fetchEpisodes(), fetchEssays()]);

  if (episodes.status === 'fulfilled') {
    const pages = episodes.value.map((ep) => ({ segment: ep.guid.trim(), meta: episodeShareMeta(ep) }));
    const n = await writePages(values.out, 'episode', pages, template);
    console.log(`episode: ${n} Link Preview page(s)`);
  } else {
    failures.push(`Episodes: ${episodes.reason?.message ?? episodes.reason}`);
  }

  if (essays.status === 'fulfilled') {
    const n = await writePages(values.out, 'essay', essayPageSpecs(essays.value), template);
    console.log(`essay: ${n} Link Preview page(s)`);
  } else {
    failures.push(`Essays: ${essays.reason?.message ?? essays.reason}`);
  }

  for (const f of failures) console.error(`FAILED ${f} — those pages keep the site-wide preview`);
  return failures.length ? 1 : 0;
}

// The relay pool can hold sockets open after the fetch settles; exit explicitly.
main().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1); },
);
