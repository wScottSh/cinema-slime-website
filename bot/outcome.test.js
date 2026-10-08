import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELP, REPLY_MAX, TEMPLATES, renderOutcome } from './outcome.js';
import { cardMatches, verifyDiscordCard } from './card.js';
import { createJournal } from './journal.js';

const URL_ = 'https://cinemaslime.com/essay/midnight-spider-man';
const META = { url: URL_, title: 'Birth Date — by Harrison' };
const CURATED = {
  kind: 'curated', change: 'added', entry: { coordinate: 'c', slug: 'midnight-spider-man' }, title: 'Birth Date',
  url: URL_, meta: META, total: 18, createdAt: 1759870000,
};

test('every refusal, failure and unknown reason the Curator and parser produce has its own message', () => {
  const produced = {
    REFUSED: ['slug-taken', 'slug-locked', 'author-unnamed', 'not-listed', 'curation-unreadable', 'curations-disagree', 'curation-stale'],
    FAILED: ['capture', 'read-curation', 'presence-gate', 'publish', 'save-local', 'render', 'verify-html', 'internal'],
    UNKNOWN: ['no-link', 'not-an-essay', 'bad-slug', 'rename-needs-slug'],
    CURATED: ['added', 'renamed', 'unchanged'],
  };
  for (const [table, keys] of Object.entries(produced)) {
    assert.deepEqual(Object.keys(TEMPLATES[table]).sort(), [...keys].sort(), table);
  }
});

test('renderOutcome throws on a variant with no template rather than replying generically', () => {
  assert.throws(() => renderOutcome({ kind: 'refused', reason: 'brand-new' }), /no template/);
  assert.throws(() => renderOutcome({ kind: 'mystery' }), /unknown outcome kind/);
});

test('a reply naming 40 Essays fits in one Discord message and keeps the count', () => {
  const missing = Array.from({ length: 40 }, (_, i) => `30023:${'ab'.repeat(32)}:essay-number-${i}`);
  for (const outcome of [
    { kind: 'refused', reason: 'curations-disagree', missing },
    { kind: 'failed', step: 'presence-gate', detail: missing.join('\n'), published: false, missing },
  ]) {
    const text = renderOutcome(outcome);
    assert.ok(text.length <= 2000 - 120, `${outcome.reason ?? outcome.step}: ${text.length} characters`);
    assert.match(text, /\b40 /);
    assert.ok(text.includes(missing[0]));
    assert.match(text, /…and 35 more$/);
  }
  const huge = renderOutcome({ kind: 'failed', step: 'capture', detail: 'x'.repeat(5000), published: false });
  assert.equal(huge.length, REPLY_MAX);
  assert.ok(huge.endsWith('…'));
});

test('a curated reply ends with the link and claims nothing about the card', () => {
  const text = renderOutcome(CURATED);
  assert.ok(text.endsWith(`\n${URL_}`));
  assert.ok(!text.includes('✅'));
  assert.match(renderOutcome({ ...CURATED, change: 'renamed', previousSlug: 'old' }), /\/essay\/old no longer works/);
  assert.equal(renderOutcome({ kind: 'help' }), HELP);
});

test('cardMatches needs the page title and the canonical URL, query ignored', () => {
  assert.equal(cardMatches({ title: META.title, url: `${URL_}?v=1` }, META), true);
  assert.equal(cardMatches({ title: 'Cinema Slime Podcast', url: 'https://cinemaslime.com/' }, META), false);
  assert.equal(cardMatches(null, META), false);
});

function fakeReply(cards) {
  const edits = [];
  return {
    text: renderOutcome(CURATED),
    edits,
    async edit(text) { edits.push(text); },
    async waitForCard(matches) { const card = cards.shift(); return card && matches(card) ? card : null; },
  };
}

test('verifyDiscordCard marks a matching card verified', async () => {
  const reply = fakeReply([{ title: META.title, url: URL_ }]);
  assert.equal(await verifyDiscordCard(reply, CURATED), 'verified');
  assert.match(reply.edits.at(-1), /✅ Discord preview card verified\.$/);
});

test('verifyDiscordCard busts a generic card once with ?v=<created_at>', async () => {
  const reply = fakeReply([{ title: 'Cinema Slime Podcast', url: 'https://cinemaslime.com/' }, { title: META.title, url: URL_ }]);
  assert.equal(await verifyDiscordCard(reply, CURATED), 'verified-after-bust');
  assert.ok(reply.edits[0].endsWith(`${URL_}?v=1759870000`));
  assert.match(reply.edits.at(-1), /✅/);
});

test('verifyDiscordCard never claims ✅ when no matching card shows up', async () => {
  const reply = fakeReply([null, null]);
  assert.equal(await verifyDiscordCard(reply, CURATED, { timeoutMs: 10 }), 'not-observed');
  assert.ok(reply.edits.every((text) => !text.includes('✅')));
  assert.match(reply.edits.at(-1), /⚠️/);
});

test('the journal skips done messages and lists started ones for replay', () => {
  const journal = createJournal(join(mkdtempSync(join(tmpdir(), 'journal-')), 'journal'));
  journal.begin({ messageId: '1', channelId: 'c' });
  journal.begin({ messageId: '2', channelId: 'c' });
  journal.finish({ messageId: '2', channelId: 'c' }, 'curated');
  assert.equal(journal.isDone('2'), true);
  assert.equal(journal.isDone('1'), false);
  assert.deepEqual(journal.pending(), [{ messageId: '1', channelId: 'c', state: 'started' }]);
});
