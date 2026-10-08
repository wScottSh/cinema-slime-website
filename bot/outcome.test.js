import test from 'node:test';
import assert from 'node:assert/strict';
import { HELP, REPLY_MAX, TEMPLATES, renderOutcome } from './outcome.js';
import { cardMatches, verifyDiscordCard } from './card.js';

const URL_ = 'https://cinemaslime.com/essay/midnight-spider-man';
const META = { url: URL_, title: 'Birth Date — by Harrison' };
const CURATED = {
  kind: 'curated', change: 'added', entry: { coordinate: 'c', slug: 'midnight-spider-man' }, title: 'Birth Date',
  url: URL_, meta: META, total: 18, createdAt: 1759870000,
};

test('every refusal, failure and unknown reason the Curator and parser produce has its own message', () => {
  const produced = {
    REFUSED: ['slug-taken', 'slug-locked', 'author-unnamed', 'not-listed', 'curation-unreadable', 'curations-disagree', 'curation-stale', 'titles-missing',
      'craig-invalid-key', 'craig-no-rec', 'craig-recording-deleted', 'craig-rec-no-data', 'craig-invalid-rec', 'craig-other'],
    FAILED: ['capture', 'read-curation', 'presence-gate', 'publish', 'save-local', 'render', 'verify-html', 'internal',
      'craig', 'editor', 'editor-cert', 'editor-auth', 'editor-response', 'intake-off'],
    UNKNOWN: ['no-link', 'not-an-essay', 'bad-slug', 'bad-name', 'rename-needs-slug', 'craig-needs-key', 'two-links'],
    CURATED: ['added', 'renamed', 'unchanged'],
    EPISODE: ['created', 'exists'],
    STANDARDIZED: ['standardized', 'unchanged'],
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
  assert.match(renderOutcome({ ...CURATED, change: 'renamed', previousSlug: 'old' }), /\/essay\/old still works and lands here/);
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

const EPISODE_URL = 'https://edit.cinemaslime.com/ep_1';

test('an intake reply links the Episode, and a new one says where the upload folders will appear', () => {
  const created = renderOutcome({ kind: 'episode', change: 'created', episodeId: 'ep_1', url: EPISODE_URL, title: 'Noir S1E9' });
  assert.equal(created, `Started a new Episode **Noir S1E9** from that Craig recording.\n${EPISODE_URL}\nIts upload folders will be posted in this channel once Craig's audio is saved.`);
  assert.match(renderOutcome({ kind: 'episode', change: 'created', episodeId: 'ep_1', url: EPISODE_URL }), /^Started a new Episode from that Craig recording\./);
  assert.equal(renderOutcome({ kind: 'episode', change: 'exists', episodeId: 'ep_1', url: EPISODE_URL }), `That Craig recording already has an Episode.\n${EPISODE_URL}`);
});

test('every way an intake can stop says what stopped it', () => {
  const cases = [
    [{ kind: 'refused', reason: 'craig-invalid-key' }, /^🚫 Craig says that link's key is wrong/],
    [{ kind: 'refused', reason: 'craig-no-rec' }, /^🚫 Craig has no recording with that id/],
    [{ kind: 'refused', reason: 'craig-recording-deleted' }, /^🚫 Craig says that recording was deleted/],
    [{ kind: 'refused', reason: 'craig-rec-no-data' }, /^🚫 Craig says that recording has no audio/],
    [{ kind: 'refused', reason: 'craig-invalid-rec' }, /^🚫 Craig says that recording is invalid/],
    [{ kind: 'refused', reason: 'craig-other', code: 'rec_haunted' }, /^🚫 Craig refused that recording with `rec_haunted`/],
    [{ kind: 'failed', step: 'craig' }, /^❌ The editor couldn't reach Craig/],
    [{ kind: 'failed', step: 'editor', detail: 'ECONNREFUSED' }, /^❌ I couldn't reach the podcast editor \(ECONNREFUSED\)/],
    [{ kind: 'failed', step: 'editor-cert', detail: 'certificate AB' }, /^❌ .*doesn't match the pinned fingerprint, so I sent it nothing/],
    [{ kind: 'failed', step: 'editor-auth' }, /^❌ The podcast editor refused my intake secret.*cspod-intake-secret/],
    [{ kind: 'failed', step: 'editor-response', detail: 'HTTP 400: bad body' }, /^❌ .*\(HTTP 400: bad body\), so I can't say whether an Episode was started/],
    [{ kind: 'failed', step: 'intake-off' }, /^❌ Starting Episodes from Craig links isn't set up.*Essay links still work\.$/],
    [{ kind: 'unknown', reason: 'craig-needs-key' }, /^That Craig link has no key/],
    [{ kind: 'unknown', reason: 'two-links' }, /^One link per mention/],
  ];
  for (const [outcome, expected] of cases) assert.match(renderOutcome(outcome), expected, JSON.stringify(outcome));
});

test('help mentions Craig links', () => {
  assert.match(HELP, /craig\.horse\/rec\//);
});
