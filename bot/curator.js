// The Curator: turns a Command into an Outcome. It knows nothing about
// Discord; the daemon and the break-glass CLI both drive it.
//
// One curate run: capture the Essay's signed body -> read the newest live
// Curation -> pure edit -> (if changed) presence gate + sign + publish + save
// the signed copy -> render every Essay Page from the vault -> GET our own page
// as Discordbot and require its og:url/og:title. A standardize run (CLI only)
// skips capture, re-derives every slug, and verifies every page. Each step
// converges on a re-run, so recovering from a crash is running the command again.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPublicKey } from 'nostr-tools/pure';
import { BRAND_RELAYS } from '../src/brand.js';
import { captureEssayFromInput } from '../src/curate-capture.js';
import { applyCurate, applyRename, applyStandardize, curationFromEvent } from '../src/curation.js';
import {
  SOURCE_RELAYS, harvestEssays, raiseCurationFloor, readCuration, runPublishWorkflow, saveLocalCuration, signCuration,
} from '../src/curation-publish.js';
import { parseLongFormEvent } from '../src/essay-data.js';
import { createEssayVault } from '../src/essay-vault.js';
import { SITE_ORIGIN, essayShareMeta, readShareMeta } from '../src/share-meta.js';
import { essayEntriesFromCuration, essayPageSpecs, writeSharePages } from '../src/share-pages.js';
import { acquireLock } from './lock.js';

const failed = (step, detail, published = false) => ({ kind: 'failed', step, detail: String(detail), published });

/**
 * @param {{
 *   relayPort: { publish(relays, event): Promise<{relay, ok, reason}[]>, collect(relays, filter, opts): Promise<object[]> },
 *   store: { load(coordinate): object | null, save(coordinate, event): void },   the droplet vault
 *   secretKey: Uint8Array,
 *   stateDir: string,        curation.json and curation-floor.json
 *   runtimeDir?: string,     curator.lock; a tmpfs cleared on reboot (default stateDir)
 *   webroot: string,         holds index.html (the template) and essay/
 *   origin?: string,
 *   fetch?: typeof fetch,
 *   verifyTimeoutMs?: number,   per GET of our own page, body included
 *   nowSec?: () => number,
 *   log?: (line: string) => void,
 * }} deps
 */
export function createCurator({
  relayPort, store, secretKey, stateDir, runtimeDir = stateDir, webroot,
  origin = SITE_ORIGIN, fetch = globalThis.fetch, verifyTimeoutMs = 10_000, nowSec = () => Math.floor(Date.now() / 1000), log = () => {},
}) {
  const release = acquireLock(join(runtimeDir, 'curator.lock'));
  const author = getPublicKey(secretKey);
  const localPath = join(stateDir, 'curation.json');
  const floorPath = join(stateDir, 'curation-floor.json');
  const vault = createEssayVault({ relayPort, store, readerRelays: BRAND_RELAYS, writerRelays: BRAND_RELAYS });
  let queue = Promise.resolve();

  async function capture(link) {
    const input = link.naddr
      ? { naddr: link.naddr, extraRelays: SOURCE_RELAYS }
      : { coordinate: link.coordinate, relays: SOURCE_RELAYS };
    const coordinate = await captureEssayFromInput(input, { vault, relayPort });
    return parseLongFormEvent(store.load(coordinate));
  }

  // Every listed body, newest version, into the vault: the presence gate
  // pushes them and the render reads them, on every run, not only on publish.
  async function harvest(curation) {
    try {
      await harvestEssays({
        coordinates: curation.entries.map((e) => e.coordinate),
        fetchEvents: (filter) => relayPort.collect(SOURCE_RELAYS, filter, { maxWait: 8000 }),
        vault,
      });
    } catch (err) {
      log(`harvest failed: ${err.message}`);
    }
  }

  async function publish(next) {
    const event = signCuration(next, { secretKey, nowSec: nowSec() });
    const gate = await runPublishWorkflow({
      essays: next.entries,
      vault,
      publishList: async () => {
        const results = await relayPort.publish(BRAND_RELAYS, event);
        log(`curation ${event.id.slice(0, 8)}: ${results.map((r) => `${r.ok ? 'ok' : 'FAIL'} ${r.relay}`).join(', ')}`);
        if (!results.some((r) => r.ok)) throw new Error('no brand relay accepted the Curation');
      },
    });
    if (!gate.published) return { gateMissing: gate.missing };
    return { event };
  }

  async function render(curation) {
    const template = await readFile(join(webroot, 'index.html'), 'utf-8');
    const { entries, missing } = essayEntriesFromCuration(curation, (c) => store.load(c));
    if (missing.length) throw new Error(`no relay or vault has the body of ${missing.join(', ')}`);
    await writeSharePages(join(webroot, 'essay'), essayPageSpecs(entries), template);
    return entries;
  }

  async function servesPreview(segment, meta) {
    const res = await fetch(`${origin}/essay/${encodeURIComponent(segment)}`, {
      headers: { 'User-Agent': 'Discordbot/2.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(verifyTimeoutMs),
    });
    const served = readShareMeta(await res.text());
    return res.status === 200 && served.url === meta.url && served.title === meta.title;
  }

  // Renders every page, then GETs the pages `pick(entries)` names as
  // Discordbot. Never throws: { entries?, failure?: [step, detail] }.
  async function renderAndVerify(curation, pick) {
    let entries;
    try {
      entries = await render(curation);
    } catch (err) {
      return { failure: ['render', err.message] };
    }
    const bad = [];
    for (const { segment, meta } of pick(entries)) {
      try {
        if (!(await servesPreview(segment, meta))) bad.push(`/essay/${segment} did not carry og:url ${meta.url} and its own og:title`);
      } catch (err) {
        bad.push(`/essay/${segment}: ${err.message}`);
      }
    }
    return bad.length ? { entries, failure: ['verify-html', bad.join('\n')] } : { entries };
  }

  async function renderAndVerifyWithRetry(curation, pick) {
    const check = await renderAndVerify(curation, pick);
    if (check.failure?.[0] !== 'verify-html') return check;
    log(`verify: ${check.failure[1]}; re-rendering once`);
    return renderAndVerify(curation, pick);
  }

  // Publishes a changed edit. Returns a failed Outcome, or the Curation now
  // live and whether this run published it.
  async function commit(edit) {
    if (edit.change === 'unchanged') return { curation: edit.next, published: false };
    let result;
    try {
      result = await publish(edit.next);
    } catch (err) {
      return failed('publish', err.message);
    }
    if (result.gateMissing) return { ...failed('presence-gate', result.gateMissing.join('\n')), missing: result.gateMissing };
    try {
      await raiseCurationFloor(floorPath, result.event.created_at);
      await saveLocalCuration(localPath, result.event);
    } catch (err) {
      return failed('save-local', err.message, true);
    }
    return { curation: curationFromEvent(result.event), published: true };
  }

  async function read() {
    try {
      return await readCuration({ relayPort, author, localPath, floorPath });
    } catch (err) {
      return failed('read-curation', err.message);
    }
  }

  // Shared tail of curate and rename, once the edit is decided.
  async function land(edit) {
    await harvest(edit.next);
    const committed = await commit(edit);
    if (committed.kind === 'failed') return committed;
    const { curation, published } = committed;
    const ownPage = (entries) => {
      const entry = entries.find((e) => e.coordinate === edit.entry.coordinate);
      return [{ segment: entry.slug || entry.coordinate, meta: essayShareMeta(entry) }];
    };
    const check = await renderAndVerifyWithRetry(curation, ownPage);
    if (check.failure) return failed(...check.failure, published);
    const [{ meta }] = ownPage(check.entries);
    const entry = check.entries.find((e) => e.coordinate === edit.entry.coordinate);
    return {
      kind: 'curated',
      change: edit.change,
      entry: edit.entry,
      title: entry.essay.title || entry.coordinate,
      url: meta.url,
      meta,
      total: curation.entries.length,
      createdAt: curation.createdAt,
      ...(edit.previousSlug !== undefined && { previousSlug: edit.previousSlug }),
    };
  }

  async function curateOrRename(command) {
    let essay;
    try {
      essay = await capture(command.link);
    } catch (err) {
      return failed('capture', err.message.replace(/^curate-capture: |^EssayVault\.captureEssay: /, ''));
    }
    const current = await read();
    if (current.kind !== 'read') return current;
    const { curation } = current;
    const edit = command.kind === 'rename'
      ? applyRename(curation, { coordinate: essay.coordinateString, slug: command.slug })
      : applyCurate(curation, {
        coordinate: essay.coordinateString,
        title: essay.title,
        author: essay.pubkey,
        identifier: essay.coordinate.identifier,
        slug: command.slug,
        name: command.name,
      });
    if (edit.kind === 'refused') return edit;
    const outcome = await land(edit);
    // A listed Essay's credit is never edited, so say so rather than drop the name silently.
    if (outcome.kind === 'curated' && command.name && edit.change === 'unchanged') outcome.ignoredName = command.name;
    return outcome;
  }

  // Every slug re-derived by the standard rule (ADR 0022) in one publish;
  // every old slug stays as an alias. Then every page, alias pages included,
  // must serve its Essay's canonical preview.
  async function standardize({ dryRun }) {
    const current = await read();
    if (current.kind !== 'read') return current;
    const { curation } = current;
    await harvest(curation);
    const titles = new Map();
    for (const { coordinate } of curation.entries) {
      const essay = parseLongFormEvent(store.load(coordinate));
      if (essay) titles.set(coordinate, essay.title);
    }
    const edit = applyStandardize(curation, titles);
    if (edit.kind === 'refused') return edit;
    const rows = curation.entries.map((e, i) => ({ title: titles.get(e.coordinate), from: e.slug, to: edit.next.entries[i].slug }));
    const outcome = { kind: 'standardized', dryRun, change: edit.change, rows, published: false };
    if (dryRun) return outcome;
    const committed = await commit(edit);
    if (committed.kind === 'failed') return committed;
    const check = await renderAndVerifyWithRetry(committed.curation, essayPageSpecs);
    if (check.failure) return failed(...check.failure, committed.published);
    return { ...outcome, published: committed.published, verified: essayPageSpecs(check.entries).length };
  }

  function execute(command) {
    switch (command.kind) {
      case 'curate':
      case 'rename':
        return curateOrRename(command);
      case 'standardize':
        return standardize(command);
      case 'help':
      case 'unknown':
        return Promise.resolve(command);
      default:
        throw new Error(`Curator: unknown command kind "${command.kind}"`);
    }
  }

  return {
    // Runs strictly one at a time, in arrival order.
    run(command) {
      const result = queue.then(() => execute(command));
      queue = result.catch(() => {});
      return result;
    },
    close: release,
  };
}
