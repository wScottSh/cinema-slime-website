// The Curator: turns a Command into an Outcome. It knows nothing about
// Discord; the daemon and the break-glass CLI both drive it.
//
// One curate run: capture the Essay's signed body -> read the newest live
// Curation -> pure edit -> (if changed) presence gate + sign + publish + save
// the signed copy -> render every Essay Page from the vault -> GET our own page
// as Discordbot and require its og:url/og:title. Each step converges on a
// re-run, so recovering from a crash is running the command again.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPublicKey } from 'nostr-tools/pure';
import { BRAND_RELAYS } from '../src/brand.js';
import { captureEssayFromInput } from '../src/curate-capture.js';
import { applyCurate, applyRename, curationFromEvent } from '../src/curation.js';
import {
  SOURCE_RELAYS, harvestEssays, readCuration, runPublishWorkflow, saveLocalCuration, signCuration,
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
 *   stateDir: string,        curation.json and curator.lock
 *   webroot: string,         holds index.html (the template) and essay/
 *   origin?: string,
 *   fetch?: typeof fetch,
 *   nowSec?: () => number,
 *   log?: (line: string) => void,
 * }} deps
 */
export function createCurator({
  relayPort, store, secretKey, stateDir, webroot,
  origin = SITE_ORIGIN, fetch = globalThis.fetch, nowSec = () => Math.floor(Date.now() / 1000), log = () => {},
}) {
  const release = acquireLock(join(stateDir, 'curator.lock'));
  const author = getPublicKey(secretKey);
  const localPath = join(stateDir, 'curation.json');
  const vault = createEssayVault({ relayPort, store, readerRelays: BRAND_RELAYS, writerRelays: BRAND_RELAYS });
  let queue = Promise.resolve();

  async function capture(link) {
    const input = link.naddr
      ? { naddr: link.naddr, extraRelays: SOURCE_RELAYS }
      : { coordinate: link.coordinate, relays: SOURCE_RELAYS };
    const coordinate = await captureEssayFromInput(input, { vault, relayPort });
    return parseLongFormEvent(store.load(coordinate));
  }

  async function publish(next) {
    await harvestEssays({
      coordinates: next.entries.map((e) => e.coordinate),
      fetchEvents: (filter) => relayPort.collect(SOURCE_RELAYS, filter, { maxWait: 8000 }),
      vault,
    });
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
    if (missing.length) throw new Error(`no stored body for ${missing.join(', ')}`);
    await writeSharePages(join(webroot, 'essay'), essayPageSpecs(entries), template);
    return entries;
  }

  async function servesOwnPreview(meta) {
    const res = await fetch(meta.url.replace(SITE_ORIGIN, origin), {
      headers: { 'User-Agent': 'Discordbot/2.0' },
      redirect: 'manual',
    });
    const served = readShareMeta(await res.text());
    return res.status === 200 && served.url === meta.url && served.title === meta.title;
  }

  // Never throws: { entry, meta, failure?: [step, detail] }.
  async function renderAndVerify(curation, coordinate) {
    let entry;
    try {
      entry = (await render(curation)).find((e) => e.coordinate === coordinate);
    } catch (err) {
      return { failure: ['render', err.message] };
    }
    const meta = essayShareMeta(entry);
    try {
      if (await servesOwnPreview(meta)) return { entry, meta };
      return { entry, meta, failure: ['verify-html', `${meta.url} did not carry og:url ${meta.url} and its own og:title`] };
    } catch (err) {
      return { entry, meta, failure: ['verify-html', err.message] };
    }
  }

  // Shared tail of curate and rename, once the edit is decided.
  async function land(edit) {
    let curation = edit.next;
    let published = false;
    if (edit.change !== 'unchanged') {
      let result;
      try {
        result = await publish(edit.next);
      } catch (err) {
        return failed('publish', err.message);
      }
      if (result.gateMissing) return failed('presence-gate', result.gateMissing.join('\n'));
      published = true;
      curation = curationFromEvent(result.event);
      try {
        await saveLocalCuration(localPath, result.event);
      } catch (err) {
        return failed('save-local', err.message, published);
      }
    }
    let check = await renderAndVerify(curation, edit.entry.coordinate);
    if (check.failure?.[0] === 'verify-html') {
      log(`verify ${check.meta.url}: ${check.failure[1]}; re-rendering once`);
      check = await renderAndVerify(curation, edit.entry.coordinate);
    }
    if (check.failure) return failed(...check.failure, published);
    return {
      kind: 'curated',
      change: edit.change,
      entry: edit.entry,
      title: check.entry.essay.title || check.entry.coordinate,
      url: check.meta.url,
      meta: check.meta,
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
    let curation;
    try {
      curation = await readCuration({ relayPort, author, localPath });
    } catch (err) {
      return failed('read-curation', err.message);
    }
    if (!curation) return { kind: 'refused', reason: 'curation-unreadable' };
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
    return land(edit);
  }

  function execute(command) {
    switch (command.kind) {
      case 'curate':
      case 'rename':
        return curateOrRename(command);
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
