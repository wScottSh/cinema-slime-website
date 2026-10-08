import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileVaultStore } from './vault-store.js';
import { essayEntriesFromCuration, essayPageSpecs, writeSharePages } from './share-pages.js';

const TEMPLATE = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const vault = createFileVaultStore(new URL('../vault/essays', import.meta.url).pathname);
const HARRISON = '2b245b2d9010cabc724d4f078d0d811891b67f8390c19038fb0982519addfd2a';
const BIRTH_DATE = `30023:${HARRISON}:c3pwRmDcBE1ND9ZgBi8RL`;
const MISSING = `30023:${HARRISON}:not-in-the-vault`;
const CURATION = {
  entries: [{ coordinate: BIRTH_DATE, slug: 'midnight-spider-man' }, { coordinate: MISSING, slug: 'gone' }],
  names: [{ pubkey: HARRISON, name: 'Harrison' }],
  createdAt: 1,
  eventId: 'x',
};

test('essayEntriesFromCuration builds entries from stored bodies and Curation names', () => {
  const { entries, missing } = essayEntriesFromCuration(CURATION, (c) => vault.load(c));
  assert.deepEqual(missing, [MISSING]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slug, 'midnight-spider-man');
  assert.equal(entries[0].essay.authorName, 'Harrison');
  assert.match(entries[0].essay.title, /^Birth Date/);
});

test('essayPageSpecs gives each Essay a Slug page and a coordinate page with one canonical og:url', () => {
  const { entries } = essayEntriesFromCuration(CURATION, (c) => vault.load(c));
  const pages = essayPageSpecs(entries);
  assert.deepEqual(pages.map((p) => p.segment), ['midnight-spider-man', BIRTH_DATE]);
  assert.equal(pages[0].meta.url, 'https://cinemaslime.com/essay/midnight-spider-man');
  assert.equal(pages[1].meta, pages[0].meta);
});

test('writeSharePages writes every page, prunes stale ones, and leaves no temp files', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'share-pages-')), 'essay');
  await mkdir(join(root, 'renamed-away'), { recursive: true });
  await writeFile(join(root, 'renamed-away', 'index.html'), 'old');
  const { entries } = essayEntriesFromCuration(CURATION, (c) => vault.load(c));
  const result = await writeSharePages(root, essayPageSpecs(entries), TEMPLATE);
  assert.deepEqual(result, { written: 2, skipped: [], pruned: 1 });
  assert.deepEqual((await readdir(root)).sort(), [BIRTH_DATE, 'midnight-spider-man'].sort());
  assert.deepEqual(await readdir(join(root, 'midnight-spider-man')), ['index.html']);
  const html = await readFile(join(root, 'midnight-spider-man', 'index.html'), 'utf-8');
  assert.match(html, /<meta property="og:url" content="https:\/\/cinemaslime.com\/essay\/midnight-spider-man" \/>/);
  assert.match(html, /<meta property="og:title" content="Birth Date[^"]*— by Harrison" \/>/);
});

test('writeSharePages is idempotent and skips unsafe segments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'share-pages-'));
  const pages = [{ segment: 'ok', meta: { path: '/x', url: 'u', title: 't', documentTitle: 'd', description: 'x', image: 'i', imageAlt: 'a', type: 'article' } }];
  await writeSharePages(root, pages, TEMPLATE);
  const first = await readFile(join(root, 'ok', 'index.html'), 'utf-8');
  const again = await writeSharePages(root, [...pages, { segment: '../escape', meta: pages[0].meta }], TEMPLATE);
  assert.deepEqual(again, { written: 1, skipped: ['../escape'], pruned: 0 });
  assert.equal(await readFile(join(root, 'ok', 'index.html'), 'utf-8'), first);
});
