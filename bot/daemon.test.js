import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMentionHandler, replayPending } from './daemon.js';
import { isAuthorized } from './discord.js';
import { MAX_REPLAY_AGE_MS, createJournal } from './journal.js';

const BOT = '1400000000000000001';
const CONFIG = { guildId: 'g', channelId: 'c', allowedUserIds: [] };
const MENTION = {
  messageId: 'm1', channelId: 'c', guildId: 'g', authorId: 'u', authorIsBot: false,
  content: `<@${BOT}> help`, mentionsBot: true,
};

function fakeDiscord({ replyFails = false, waitForCard = async () => null, messages = { m1: MENTION } } = {}) {
  const events = [];
  return {
    events,
    botUserId: BOT,
    async react(m, emoji) { events.push(['react', m.messageId, emoji]); },
    async reply(m, text) {
      if (replyFails) throw new Error('Discord 503');
      events.push(['reply', m.messageId, text]);
      return { id: `reply-${m.messageId}`, text, edit: async () => {}, waitForCard };
    },
    async fetchMention(channelId, messageId) {
      events.push(['fetch', messageId]);
      if (!messages[messageId]) throw new Error('Unknown Message');
      return messages[messageId];
    },
  };
}

const newJournal = (nowMs) => createJournal(join(mkdtempSync(join(tmpdir(), 'daemon-')), 'journal'), nowMs && { nowMs });
const replies = (discord) => discord.events.filter(([kind]) => kind === 'reply').length;
const CURATED = {
  kind: 'curated', change: 'added', entry: { coordinate: 'c', slug: 'birth-date' }, title: 'Birth Date',
  url: 'https://cinemaslime.com/essay/birth-date', meta: { url: 'https://cinemaslime.com/essay/birth-date', title: 'Birth Date' },
  total: 2, createdAt: 1,
};

test('an accepted mention gets 👀 first, then exactly one reply, then is journaled done', async () => {
  const discord = fakeDiscord();
  const journal = createJournal(join(mkdtempSync(join(tmpdir(), 'daemon-')), 'journal'));
  const curator = { run: async (command) => command };
  const handle = createMentionHandler({ curator, discord, journal });
  await handle(MENTION);
  assert.deepEqual(discord.events.map(([kind]) => kind), ['react', 'reply']);
  assert.equal(discord.events[0][2], '👀');
  assert.equal(journal.isSettled('m1'), true);
  assert.equal(journal.get('m1').replyId, 'reply-m1');

  await handle(MENTION);
  assert.equal(discord.events.length, 2, 'a redelivered message is not handled twice');
});

test('a Curator crash still gets one reply naming the failure', async () => {
  const discord = fakeDiscord();
  const journal = createJournal(join(mkdtempSync(join(tmpdir(), 'daemon-')), 'journal'));
  const handle = createMentionHandler({ curator: { run: async () => { throw new Error('boom'); } }, discord, journal });
  await handle(MENTION);
  assert.match(discord.events.at(-1)[2], /^❌ Something broke \(boom\)/);
});

test('a card check that throws after the reply still settles the message: no second reply on replay', async () => {
  const discord = fakeDiscord({ waitForCard: async () => { throw new Error('gateway closed'); } });
  const journal = newJournal();
  const handle = createMentionHandler({ curator: { run: async () => CURATED }, discord, journal });
  await handle(MENTION);
  assert.deepEqual(journal.pending(), []);
  await replayPending({ journal, discord, dispatch: handle });
  await handle(MENTION);
  assert.equal(replies(discord), 1);
});

test('a crash after the reply is recorded replays to done without replying again', async () => {
  const journal = newJournal();
  const crashed = fakeDiscord({ waitForCard: () => new Promise(() => {}) });
  createMentionHandler({ curator: { run: async () => CURATED }, discord: crashed, journal })(MENTION);
  while (replies(crashed) === 0) await new Promise(setImmediate);
  await new Promise(setImmediate);

  // The process dies here, mid card check; the next boot replays the journal.
  const discord = fakeDiscord();
  const dispatched = [];
  await replayPending({ journal, discord, dispatch: (m) => dispatched.push(m) });
  assert.deepEqual(dispatched, []);
  assert.deepEqual(discord.events, []);
  assert.equal(journal.get('m1').state, 'done');

  const redelivered = { ...MENTION, messageId: 'm2' };
  journal.begin(redelivered);
  journal.replied(redelivered, 'reply-m2', 'curated');
  await createMentionHandler({ curator: { run: async () => CURATED }, discord, journal })(redelivered);
  assert.deepEqual(discord.events, [], 'a redelivery after the reply neither reacts nor replies');
  assert.equal(journal.get('m2').state, 'done');
});

test('a reply that throws leaves the message pending, and the replay replies exactly once', async () => {
  const journal = newJournal();
  const curator = { run: async (command) => command };
  await assert.rejects(createMentionHandler({ curator, discord: fakeDiscord({ replyFails: true }), journal })(MENTION), /503/);
  assert.deepEqual(journal.pending().map((e) => [e.messageId, e.state]), [['m1', 'started']]);

  const discord = fakeDiscord();
  const handle = createMentionHandler({ curator, discord, journal });
  const runs = [];
  await replayPending({ journal, discord, dispatch: (m) => runs.push(handle(m)) });
  await Promise.all(runs);
  assert.equal(replies(discord), 1);
  assert.equal(journal.get('m1').state, 'done');
});

test('a pending message that vanished, or is older than 24h, is abandoned without a reply', async () => {
  let now = 1_000_000_000_000;
  const journal = newJournal(() => now);
  journal.begin({ messageId: 'm1', channelId: 'c' });
  now += MAX_REPLAY_AGE_MS + 1;
  journal.begin({ messageId: 'gone', channelId: 'c' });
  journal.begin({ messageId: 'fresh', channelId: 'c' });
  const discord = fakeDiscord({ messages: { fresh: { ...MENTION, messageId: 'fresh' } } });
  const dispatched = [];
  await replayPending({ journal, discord, dispatch: (m) => dispatched.push(m.messageId), nowMs: now });
  assert.deepEqual(dispatched, ['fresh']);
  assert.equal(journal.get('m1').state, 'abandoned');
  assert.equal(journal.get('gone').state, 'abandoned');
  assert.deepEqual(journal.pending().map((e) => e.messageId), ['fresh']);
  assert.ok(!discord.events.some(([kind, id]) => kind === 'fetch' && id === 'm1'), 'an old entry is not even fetched');
});

test('close() waits for an in-flight mention to reply, and defers a later one to the next start', async () => {
  const discord = fakeDiscord();
  const journal = newJournal();
  let finishRun;
  const curator = { run: () => new Promise((resolve) => { finishRun = () => resolve({ kind: 'help' }); }) };
  const handle = createMentionHandler({ curator, discord, journal });
  const running = handle(MENTION);
  while (!finishRun) await new Promise(setImmediate);
  let drained = false;
  const closing = handle.close().then(() => { drained = true; });
  await handle({ ...MENTION, messageId: 'late' });
  await new Promise(setImmediate);
  assert.equal(drained, false, 'still waiting on the in-flight run');
  finishRun();
  await closing;
  await running;
  assert.equal(replies(discord), 1);
  assert.equal(journal.get('m1').state, 'done');
  assert.deepEqual(journal.pending().map((e) => e.messageId), ['late']);
  assert.ok(!discord.events.some(([, id]) => id === 'late'), 'the late mention is neither reacted to nor replied to');
});

test('isAuthorized admits only an explicit mention by a human in the configured channel', () => {
  assert.equal(isAuthorized(MENTION, CONFIG), true);
  assert.equal(isAuthorized({ ...MENTION, channelId: 'other' }, CONFIG), false);
  assert.equal(isAuthorized({ ...MENTION, guildId: 'other' }, CONFIG), false);
  assert.equal(isAuthorized({ ...MENTION, authorIsBot: true }, CONFIG), false);
  assert.equal(isAuthorized({ ...MENTION, mentionsBot: false }, CONFIG), false);
  assert.equal(isAuthorized(MENTION, { ...CONFIG, allowedUserIds: ['someone-else'] }), false);
  assert.equal(isAuthorized(MENTION, { ...CONFIG, allowedUserIds: ['u'] }), true);
});
