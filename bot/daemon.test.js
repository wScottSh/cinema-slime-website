import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMentionHandler } from './daemon.js';
import { isAuthorized } from './discord.js';
import { createJournal } from './journal.js';

const BOT = '1400000000000000001';
const CONFIG = { guildId: 'g', channelId: 'c', allowedUserIds: [] };
const MENTION = {
  messageId: 'm1', channelId: 'c', guildId: 'g', authorId: 'u', authorIsBot: false,
  content: `<@${BOT}> help`, mentionsBot: true,
};

function fakeDiscord() {
  const events = [];
  return {
    events,
    botUserId: BOT,
    async react(m, emoji) { events.push(['react', m.messageId, emoji]); },
    async reply(m, text) { events.push(['reply', m.messageId, text]); return { text, edit: async () => {}, waitForCard: async () => null }; },
  };
}

test('an accepted mention gets 👀 first, then exactly one reply, then is journaled done', async () => {
  const discord = fakeDiscord();
  const journal = createJournal(join(mkdtempSync(join(tmpdir(), 'daemon-')), 'journal'));
  const curator = { run: async (command) => command };
  const handle = createMentionHandler({ curator, discord, journal });
  await handle(MENTION);
  assert.deepEqual(discord.events.map(([kind]) => kind), ['react', 'reply']);
  assert.equal(discord.events[0][2], '👀');
  assert.equal(journal.isDone('m1'), true);

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

test('isAuthorized admits only an explicit mention by a human in the configured channel', () => {
  assert.equal(isAuthorized(MENTION, CONFIG), true);
  assert.equal(isAuthorized({ ...MENTION, channelId: 'other' }, CONFIG), false);
  assert.equal(isAuthorized({ ...MENTION, guildId: 'other' }, CONFIG), false);
  assert.equal(isAuthorized({ ...MENTION, authorIsBot: true }, CONFIG), false);
  assert.equal(isAuthorized({ ...MENTION, mentionsBot: false }, CONFIG), false);
  assert.equal(isAuthorized(MENTION, { ...CONFIG, allowedUserIds: ['someone-else'] }), false);
  assert.equal(isAuthorized(MENTION, { ...CONFIG, allowedUserIds: ['u'] }), true);
});
