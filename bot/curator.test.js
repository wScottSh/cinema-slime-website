import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { BRAND_RELAYS } from '../src/brand.js';
import { readShareMeta } from '../src/share-meta.js';
import { createCurator } from './curator.js';
import { acquireLock, lockIdentity } from './lock.js';
import { renderOutcome } from './outcome.js';

const BRAND_SK = generateSecretKey();
const HARRISON_SK = generateSecretKey();
const HARRISON = getPublicKey(HARRISON_SK);
const NEWCOMER_SK = generateSecretKey();
const SOURCE = 'wss://nos.lol';

function essay(sk, identifier, title) {
  return finalizeEvent({ kind: 30023, created_at: 1_700_000_000, tags: [['d', identifier], ['title', title]], content: `${title} body.` }, sk);
}
const coordinateOf = (e) => `30023:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')[1]}`;

const MIRROR = essay(HARRISON_SK, 'mirror', 'The Mirror - Spider-Man Noir S1E8 (Spoilers)');
const BIRTH_DATE = essay(HARRISON_SK, 'birth', 'Birth Date - Midnight Spider-Man #1 (Spoilers)');
const SECOND_BIRTH = essay(HARRISON_SK, 'birth-2', 'Rebirth - Midnight Spider-Man #1');
const NEWCOMER_ESSAY = essay(NEWCOMER_SK, 'hello', 'Hello - World');

function liveCuration(createdAt = 1_700_000_100, extra = []) {
  return finalizeEvent({
    kind: 30001,
    created_at: createdAt,
    tags: [['d', 'cinema-slime-essays'], ['a', coordinateOf(MIRROR), '', 'the-mirror'], ...extra, ['p', HARRISON, '', 'Harrison']],
    content: '',
  }, BRAND_SK);
}

// Every relay in one in-memory network: publish stores, collect filters.
function fakeRelays(seed) {
  const relays = new Map(Object.entries(seed).map(([url, events]) => [url, [...events]]));
  const published = [];
  const matches = (event, filter) => (!filter.kinds || filter.kinds.includes(event.kind))
    && (!filter.authors || filter.authors.includes(event.pubkey))
    && (!filter['#d'] || filter['#d'].includes(event.tags.find((t) => t[0] === 'd')?.[1]));
  return {
    published,
    curationsPublished: () => published.filter((p) => p.event.kind === 30001),
    // A relay set that lost everything published so far (lagging, or restored from backup).
    forgetPublished() {
      const ids = new Set(published.map((p) => p.event.id));
      for (const [url, events] of relays) relays.set(url, events.filter((e) => !ids.has(e.id)));
    },
    async publish(urls, event) {
      published.push({ urls, event });
      for (const url of urls) relays.set(url, [...(relays.get(url) ?? []).filter((e) => e.id !== event.id), event]);
      return urls.map((relay) => ({ relay, ok: true, reason: null }));
    },
    async collect(urls, filter) {
      const found = new Map();
      for (const url of urls) for (const e of relays.get(url) ?? []) if (matches(e, filter)) found.set(e.id, e);
      return [...found.values()];
    },
  };
}

function memoryStore(events = []) {
  const map = new Map(events.map((e) => [coordinateOf(e), e]));
  return { load: (c) => map.get(c) ?? null, save: (c, e) => map.set(c, e) };
}

// nginx's share location: the page if it exists, else the generic index.html.
function fakeSite(webroot) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ua: init.headers['User-Agent'] });
    const segment = decodeURIComponent(new URL(url).pathname.replace(/^\/essay\//, ''));
    const page = join(webroot, 'essay', segment, 'index.html');
    const body = readFileSync(existsSync(page) ? page : join(webroot, 'index.html'), 'utf-8');
    return { status: 200, text: async () => body };
  };
  return { fetch, calls };
}

function setup({ relayCuration = true, brandCuration = liveCuration(), seedLocal = null, fetch, wrapFetch = (f) => f, verifyTimeoutMs } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'curator-'));
  const stateDir = join(root, 'state');
  const webroot = join(root, 'html');
  mkdirSync(stateDir);
  mkdirSync(webroot);
  copyFileSync(new URL('../index.html', import.meta.url), join(webroot, 'index.html'));
  if (seedLocal) writeFileSync(join(stateDir, 'curation.json'), JSON.stringify(seedLocal));
  const brand = relayCuration ? [brandCuration] : [];
  const relayPort = fakeRelays({
    ...Object.fromEntries(BRAND_RELAYS.map((r) => [r, [...brand, MIRROR]])),
    [SOURCE]: [MIRROR, BIRTH_DATE, SECOND_BIRTH, NEWCOMER_ESSAY],
  });
  const site = fakeSite(webroot);
  const curator = createCurator({
    relayPort, store: memoryStore([MIRROR]), secretKey: BRAND_SK, stateDir, webroot,
    fetch: fetch ?? wrapFetch(site.fetch), verifyTimeoutMs, nowSec: () => 1_800_000_000,
  });
  return { curator, relayPort, site, stateDir, webroot };
}

const curate = (event, extra = {}) => ({ kind: 'curate', link: { coordinate: coordinateOf(event) }, ...extra });
const pagesIn = (webroot) => readdirSync(join(webroot, 'essay')).sort();
const servedMeta = (webroot, segment) => readShareMeta(readFileSync(join(webroot, 'essay', segment, 'index.html'), 'utf-8'));

test('a new Essay is added: published once, every page written, our page verified as Discordbot', async (t) => {
  const { curator, relayPort, site, stateDir, webroot } = setup();
  t.after(curator.close);
  const outcome = await curator.run(curate(BIRTH_DATE));

  assert.equal(outcome.kind, 'curated', renderOutcome(outcome));
  assert.equal(outcome.change, 'added');
  assert.equal(outcome.url, 'https://cinemaslime.com/essay/midnight-spider-man-1');
  assert.equal(outcome.total, 2);
  assert.equal(outcome.createdAt, 1_800_000_000);

  const [published] = relayPort.curationsPublished();
  assert.equal(relayPort.curationsPublished().length, 1);
  assert.deepEqual(published.urls, BRAND_RELAYS);
  assert.deepEqual(published.event.tags.filter((t) => t[0] === 'a').map((t) => t[3]), ['the-mirror', 'midnight-spider-man-1']);
  assert.equal(JSON.parse(readFileSync(join(stateDir, 'curation.json'), 'utf8')).id, published.event.id, 'signed copy saved');

  assert.deepEqual(pagesIn(webroot), [coordinateOf(BIRTH_DATE), coordinateOf(MIRROR), 'midnight-spider-man-1', 'the-mirror'].sort());
  for (const segment of pagesIn(webroot)) {
    assert.deepEqual(readdirSync(join(webroot, 'essay', segment)), ['index.html'], `no temp file left in ${segment}`);
  }
  assert.equal(servedMeta(webroot, 'midnight-spider-man-1').url, outcome.url);
  assert.equal(servedMeta(webroot, coordinateOf(BIRTH_DATE)).url, outcome.url, 'coordinate page points at the Slug');

  assert.deepEqual(site.calls, [{ url: outcome.url, ua: 'Discordbot/2.0' }]);
  assert.match(renderOutcome(outcome), /Official Essay #2\.\nhttps:\/\/cinemaslime\.com\/essay\/midnight-spider-man-1$/);
});

test('the same Essay again is already listed: no publish, pages re-rendered and re-verified', async (t) => {
  const { curator, relayPort, site, webroot } = setup();
  t.after(curator.close);
  await curator.run(curate(BIRTH_DATE));
  const outcome = await curator.run(curate(BIRTH_DATE));

  assert.equal(outcome.kind, 'curated');
  assert.equal(outcome.change, 'unchanged');
  assert.equal(relayPort.curationsPublished().length, 1, 'only the first run published');
  assert.equal(site.calls.length, 2, 'verified again');
  assert.equal(servedMeta(webroot, 'midnight-spider-man-1').url, outcome.url);
  assert.match(renderOutcome(outcome), /already listed as `midnight-spider-man-1`/);
});

test('name: on an already listed Essay is ignored, and the reply says so', async (t) => {
  const { curator, relayPort } = setup();
  t.after(curator.close);
  const outcome = await curator.run(curate(MIRROR, { name: 'Sam' }));
  assert.equal(outcome.change, 'unchanged');
  assert.equal(outcome.ignoredName, 'Sam');
  assert.equal(relayPort.curationsPublished().length, 0);
  assert.match(renderOutcome(outcome), /I ignored `name:"Sam"`/);
  assert.doesNotMatch(renderOutcome(await curator.run(curate(MIRROR))), /ignored/);
});

test('slug collisions: an explicit taken slug is refused; a picked one is suffixed', async (t) => {
  const { curator, relayPort } = setup();
  t.after(curator.close);
  const refused = await curator.run(curate(BIRTH_DATE, { slug: 'the-mirror' }));
  assert.deepEqual(refused, { kind: 'refused', reason: 'slug-taken', slug: 'the-mirror' });
  assert.equal(relayPort.curationsPublished().length, 0);

  await curator.run(curate(BIRTH_DATE));
  const second = await curator.run(curate(SECOND_BIRTH));
  assert.equal(second.change, 'added');
  assert.equal(second.entry.slug, 'midnight-spider-man-1-2');
});

test('a different slug for a listed Essay is refused toward rename, and rename moves it', async (t) => {
  const { curator, relayPort, webroot } = setup();
  t.after(curator.close);
  const locked = await curator.run(curate(MIRROR, { slug: 'mirror' }));
  assert.equal(locked.reason, 'slug-locked');
  const renamed = await curator.run({ kind: 'rename', link: { coordinate: coordinateOf(MIRROR) }, slug: 'mirror' });
  assert.equal(renamed.change, 'renamed');
  assert.equal(renamed.previousSlug, 'the-mirror');
  assert.ok(pagesIn(webroot).includes('mirror'));
  assert.equal(servedMeta(webroot, 'the-mirror').url, 'https://cinemaslime.com/essay/mirror', 'the old link unfurls as the new one');
  const published = relayPort.curationsPublished().at(-1).event;
  assert.deepEqual(published.tags.filter((t) => t[0] === 'alias'), [['alias', 'the-mirror', coordinateOf(MIRROR)]]);
  assert.match(renderOutcome(renamed), /old link \/essay\/the-mirror still works/);
});

test('an empty Curation read refuses and publishes nothing', async (t) => {
  const { curator, relayPort, webroot } = setup({ relayCuration: false });
  t.after(curator.close);
  const outcome = await curator.run(curate(BIRTH_DATE));
  assert.deepEqual(outcome, { kind: 'refused', reason: 'curation-unreadable' });
  assert.equal(relayPort.curationsPublished().length, 0);
  assert.equal(existsSync(join(webroot, 'essay')), false, 'no pages touched');
});

test('the locally saved Curation stands in when relays have none', async (t) => {
  const { curator, relayPort } = setup({ relayCuration: false, seedLocal: liveCuration() });
  t.after(curator.close);
  const outcome = await curator.run(curate(BIRTH_DATE));
  assert.equal(outcome.change, 'added');
  assert.equal(outcome.total, 2, 'built on the saved list, not from nothing');
  assert.equal(relayPort.curationsPublished().length, 1);
});

test('a Curation older than one this machine published is refused, even with the local copy gone', async (t) => {
  const { curator, relayPort, stateDir } = setup();
  t.after(curator.close);
  assert.equal((await curator.run(curate(BIRTH_DATE))).change, 'added');
  relayPort.forgetPublished();
  unlinkSync(join(stateDir, 'curation.json'));
  const outcome = await curator.run(curate(SECOND_BIRTH));
  assert.deepEqual(outcome, { kind: 'refused', reason: 'curation-stale', newest: 1_700_000_100, floor: 1_800_000_000 });
  assert.equal(relayPort.curationsPublished().length, 1, 'nothing published over the stale list');
  assert.match(renderOutcome(outcome), /^🚫 The newest Official Essay list I can read/);
});

test('a new author without a name is refused; with name: they are credited', async (t) => {
  const { curator, relayPort, webroot } = setup();
  t.after(curator.close);
  const refused = await curator.run(curate(NEWCOMER_ESSAY));
  assert.deepEqual(refused, { kind: 'refused', reason: 'author-unnamed', author: getPublicKey(NEWCOMER_SK) });
  assert.equal(relayPort.curationsPublished().length, 0);

  const added = await curator.run(curate(NEWCOMER_ESSAY, { name: 'Sam' }));
  assert.equal(added.change, 'added');
  assert.equal(servedMeta(webroot, 'hello').title, 'Hello - World — by Sam');
});

test('a page that never serves its own preview fails verify-html after one re-render', async (t) => {
  let fetches = 0;
  const generic = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
  const { curator } = setup({ fetch: async () => { fetches++; return { status: 200, text: async () => generic }; } });
  t.after(curator.close);
  const outcome = await curator.run(curate(BIRTH_DATE));
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.step, 'verify-html');
  assert.equal(outcome.published, true);
  assert.equal(fetches, 2);
  assert.match(renderOutcome(outcome), /^❌ The list is live, but the Essay Page/);
});

test('a second Curator is refused while a live process holds the lock; a dead holder is taken over', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'curator-'));
  const runtimeDir = mkdtempSync(join(tmpdir(), 'curator-run-'));
  const lock = join(runtimeDir, 'curator.lock');
  const deps = { relayPort: fakeRelays({}), store: memoryStore(), secretKey: BRAND_SK, stateDir, runtimeDir, webroot: stateDir };
  writeFileSync(lock, lockIdentity(process.ppid));
  assert.throws(() => createCurator(deps), /holds/);

  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
  writeFileSync(lock, `${dead} 12345`);
  const curator = createCurator(deps);
  assert.equal(readFileSync(lock, 'utf8'), lockIdentity(process.pid));
  assert.equal(existsSync(join(stateDir, 'curator.lock')), false, 'the lock lives in runtimeDir, not the state directory');
  curator.close();
  assert.deepEqual(readdirSync(runtimeDir), [], 'released, and no temp or guard file left');
});

test('a lock whose pid now belongs to a different process is stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lock-'));
  const lock = join(dir, 'curator.lock');
  const [pid, start] = lockIdentity(process.ppid).split(' ');
  assert.notEqual(start, '?', 'this host exposes /proc/<pid>/stat');
  writeFileSync(lock, `${pid} ${Number(start) + 1}`);
  const release = acquireLock(lock);
  assert.equal(readFileSync(lock, 'utf8'), lockIdentity(process.pid));
  release();
});

test('a takeover never removes a lock another process took over first', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lock-race-'));
  const lock = join(dir, 'curator.lock');
  const stale = '999999999 1';
  const winner = lockIdentity(process.ppid);
  writeFileSync(lock, stale);
  // Another process completes its takeover right after this one reads the stale holder.
  const realRead = fs.readFileSync;
  let raced = false;
  fs.readFileSync = function (path, ...rest) {
    const content = realRead.call(this, path, ...rest);
    if (path === lock && !raced) {
      raced = true;
      writeFileSync(lock, winner);
    }
    return content;
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.readFileSync = realRead;
    syncBuiltinESMExports();
  });
  assert.throws(() => acquireLock(lock), /holds/);
  assert.ok(raced);
  assert.equal(realRead(lock, 'utf8'), winner, 'the winner keeps its lock');
});

test('runs are serialized in arrival order', async (t) => {
  const { curator, relayPort } = setup();
  t.after(curator.close);
  const [first, second] = await Promise.all([curator.run(curate(BIRTH_DATE)), curator.run(curate(SECOND_BIRTH))]);
  assert.equal(first.entry.slug, 'midnight-spider-man-1');
  assert.equal(second.entry.slug, 'midnight-spider-man-1-2');
  assert.equal(second.total, 3, 'the second run read the first run\'s Curation');
  assert.equal(relayPort.curationsPublished().length, 2);
});

test('a local save that fails after the relays accepted reports the list as published', async (t) => {
  const { curator, relayPort, stateDir } = setup();
  t.after(curator.close);
  mkdirSync(join(stateDir, `curation.json.${process.pid}.tmp`));
  const outcome = await curator.run(curate(BIRTH_DATE));
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.step, 'save-local');
  assert.equal(outcome.published, true);
  assert.equal(relayPort.curationsPublished().length, 1);
  assert.match(renderOutcome(outcome), /^❌ The list is live on the relays, but saving my own copy/);
});

test('every run harvests listed bodies the vault lacks before it renders', async (t) => {
  const listed = liveCuration(1_700_000_100, [['a', coordinateOf(BIRTH_DATE), '', 'birth-date']]);
  const { curator, relayPort, webroot } = setup({ brandCuration: listed });
  t.after(curator.close);
  const outcome = await curator.run(curate(MIRROR));
  assert.equal(outcome.kind, 'curated', renderOutcome(outcome));
  assert.equal(outcome.change, 'unchanged');
  assert.equal(relayPort.curationsPublished().length, 0);
  assert.equal(servedMeta(webroot, 'birth-date').title, 'Birth Date - Midnight Spider-Man #1 (Spoilers) — by Harrison');
});

test('a listed body no relay has fails the render and names it', async (t) => {
  const lost = `30023:${HARRISON}:lost`;
  const { curator } = setup({ brandCuration: liveCuration(1_700_000_100, [['a', lost, '', 'lost']]) });
  t.after(curator.close);
  const outcome = await curator.run(curate(MIRROR));
  assert.equal(outcome.step, 'render');
  assert.equal(outcome.published, false);
  assert.match(renderOutcome(outcome), new RegExp(`no relay or vault has the body of ${lost}$`));
});

test('a broken html/index.html fails the render and writes no pages', async (t) => {
  const { curator, webroot } = setup();
  t.after(curator.close);
  writeFileSync(join(webroot, 'index.html'), '<html><head></head><body></body></html>');
  const outcome = await curator.run(curate(MIRROR));
  assert.equal(outcome.step, 'render');
  assert.match(outcome.detail, /refusing to write Essay Pages: the template is \d+ characters/);
  assert.equal(existsSync(join(webroot, 'essay')), false);
});

test('a GET of our own page that never answers times out as verify-html', { timeout: 5000 }, async (t) => {
  // AbortSignal.timeout's timer does not hold the event loop open; a real socket would.
  const socket = setInterval(() => {}, 1000);
  t.after(() => clearInterval(socket));
  const hang = (url, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
  const { curator } = setup({ fetch: hang, verifyTimeoutMs: 50 });
  t.after(curator.close);
  const outcome = await curator.run(curate(MIRROR));
  assert.equal(outcome.step, 'verify-html');
  assert.match(outcome.detail, /timeout|aborted/i);
});

const nonStandard = () => liveCuration(1_700_000_100, [['a', coordinateOf(BIRTH_DATE), '', 'midnight-spider-man']]);

test('standardize --dry-run reports old -> new and touches nothing', async (t) => {
  const { curator, relayPort, webroot } = setup({ brandCuration: nonStandard() });
  t.after(curator.close);
  const outcome = await curator.run({ kind: 'standardize', dryRun: true });
  assert.equal(outcome.kind, 'standardized', renderOutcome(outcome));
  assert.deepEqual(outcome.rows.map((r) => [r.from, r.to]), [['the-mirror', 'spider-man-noir-s1e8'], ['midnight-spider-man', 'midnight-spider-man-1']]);
  assert.equal(relayPort.curationsPublished().length, 0);
  assert.equal(existsSync(join(webroot, 'essay')), false, 'no pages touched');
  assert.equal(
    renderOutcome(outcome),
    'Dry run: 2 of 2 Essay Slugs would change. Nothing was published.\n'
      + 'the-mirror          -> spider-man-noir-s1e8\n'
      + 'midnight-spider-man -> midnight-spider-man-1',
  );
});

test('standardize publishes once, keeps every old slug as an alias, and verifies every page', async (t) => {
  const { curator, relayPort, site, webroot } = setup({ brandCuration: nonStandard() });
  t.after(curator.close);
  const outcome = await curator.run({ kind: 'standardize', dryRun: false });
  assert.equal(outcome.kind, 'standardized', renderOutcome(outcome));
  assert.equal(outcome.published, true);
  const published = relayPort.curationsPublished();
  assert.equal(published.length, 1);
  const tags = published[0].event.tags;
  assert.deepEqual(tags.filter((t) => t[0] === 'a').map((t) => t[3]), ['spider-man-noir-s1e8', 'midnight-spider-man-1']);
  assert.deepEqual(tags.filter((t) => t[0] === 'alias'), [
    ['alias', 'the-mirror', coordinateOf(MIRROR)],
    ['alias', 'midnight-spider-man', coordinateOf(BIRTH_DATE)],
  ]);
  const pages = [coordinateOf(BIRTH_DATE), coordinateOf(MIRROR), 'midnight-spider-man', 'midnight-spider-man-1', 'spider-man-noir-s1e8', 'the-mirror'];
  assert.deepEqual(pagesIn(webroot), pages.sort());
  assert.equal(servedMeta(webroot, 'the-mirror').url, 'https://cinemaslime.com/essay/spider-man-noir-s1e8');
  assert.equal(servedMeta(webroot, 'midnight-spider-man').url, 'https://cinemaslime.com/essay/midnight-spider-man-1');
  assert.equal(outcome.verified, 6);
  const fetched = site.calls.map((c) => decodeURIComponent(new URL(c.url).pathname.replace('/essay/', '')));
  assert.deepEqual(fetched.sort(), pages.sort(), 'every page, alias pages included, fetched as Discordbot');
  assert.match(renderOutcome(outcome), /^Standardized 2 of 2 Essay Slugs\. Every old slug is now a Slug Alias; 6 pages verified\./);

  const again = await curator.run({ kind: 'standardize', dryRun: false });
  assert.equal(again.change, 'unchanged');
  assert.equal(relayPort.curationsPublished().length, 1, 'a second run publishes nothing');
  assert.equal(renderOutcome(again), 'All 2 Essay Slugs are already standard. 6 pages verified.');
});

test('standardize fails verify-html when an alias page does not carry the canonical preview', async (t) => {
  // A stale alias page: it still names itself as the canonical address.
  const wrapFetch = (siteFetch) => async (url, init) => {
    const res = await siteFetch(url, init);
    if (!url.endsWith('/essay/the-mirror')) return res;
    const body = (await res.text()).replaceAll('/essay/spider-man-noir-s1e8"', '/essay/the-mirror"');
    return { status: 200, text: async () => body };
  };
  const { curator } = setup({ brandCuration: nonStandard(), wrapFetch });
  t.after(curator.close);
  const outcome = await curator.run({ kind: 'standardize', dryRun: false });
  assert.equal(outcome.step, 'verify-html');
  assert.equal(outcome.published, true);
  assert.match(outcome.detail, /^\/essay\/the-mirror did not carry og:url https:\/\/cinemaslime\.com\/essay\/spider-man-noir-s1e8/);
});
