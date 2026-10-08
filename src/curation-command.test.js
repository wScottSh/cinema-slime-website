import test from 'node:test';
import assert from 'node:assert/strict';
import { nip19 } from 'nostr-tools';
import { botMentionTokens, buildCommand, parseLink, parseMention } from './curation-command.js';

const BOT = '1400000000000000001';
const HARRISON = '2b245b2d9010cabc724d4f078d0d811891b67f8390c19038fb0982519addfd2a';
const D = 'c3pwRmDcBE1ND9ZgBi8RL';
const COORDINATE = `30023:${HARRISON}:${D}`;
const NADDR = nip19.naddrEncode({ kind: 30023, pubkey: HARRISON, identifier: D, relays: ['wss://nos.lol'] });
const LINK = { coordinate: COORDINATE, naddr: NADDR };

test('a bare naddr mention curates it', () => {
  assert.deepEqual(parseMention(`<@${BOT}> ${NADDR}`, BOT), { kind: 'curate', link: LINK });
});

test('an naddr inside a client URL, nickname mention, or <suppressed> link is found', () => {
  for (const content of [
    `<@!${BOT}> https://yakihonne.com/article/${NADDR}`,
    `<@${BOT}> <https://njump.me/${NADDR}>`,
    `hey <@${BOT}> can you add https://habla.news/a/${NADDR} thanks`,
  ]) {
    assert.deepEqual(parseMention(content, BOT), { kind: 'curate', link: LINK }, content);
  }
});

test('a bare 30023 coordinate curates it', () => {
  assert.deepEqual(parseMention(`<@${BOT}> ${COORDINATE}`, BOT), { kind: 'curate', link: { coordinate: COORDINATE } });
});

test('slug: and name: options ride along, including a quoted name', () => {
  assert.deepEqual(parseMention(`<@${BOT}> ${NADDR} slug:birth-date name:"Harrison J"`, BOT), {
    kind: 'curate', link: LINK, slug: 'birth-date', name: 'Harrison J',
  });
  assert.equal(parseMention(`<@${BOT}> name:Harrison ${NADDR}`, BOT).name, 'Harrison');
});

test('name: and slug: take straight or curly quotes', () => {
  for (const quoted of ['"Harrison J"', '“Harrison J”', '“Harrison J"', '"Harrison J”']) {
    assert.equal(parseMention(`<@${BOT}> ${NADDR} name:${quoted}`, BOT).name, 'Harrison J', quoted);
  }
  assert.equal(parseMention(`<@${BOT}> ${NADDR} slug:“birth-date”`, BOT).slug, 'birth-date');
  assert.equal(parseMention(`<@${BOT}> ${NADDR} slug:"birth-date"`, BOT).slug, 'birth-date');
});

test('a name with an unmatched or stray quote, or no name at all, is refused rather than guessed', () => {
  for (const content of [
    `${NADDR} name:"Harrison J`,
    `${NADDR} name:“Harrison J`,
    `${NADDR} name:"Harrison" J"`,
    `${NADDR} name:Harrison"`,
    `${NADDR} name:""`,
    `${NADDR} name:`,
  ]) {
    assert.deepEqual(parseMention(`<@${BOT}> ${content}`, BOT), { kind: 'unknown', reason: 'bad-name' }, content);
  }
});

test('a mention of the bot\'s managed role counts as a mention of the bot', () => {
  const ROLE = '1400000000000000009';
  assert.deepEqual(parseMention(`<@&${ROLE}> ${NADDR}`, BOT, ROLE), { kind: 'curate', link: LINK });
  assert.deepEqual(parseMention(`<@&${ROLE}>`, BOT, ROLE), { kind: 'help' });
  assert.deepEqual(botMentionTokens(BOT, ROLE), [`<@${BOT}>`, `<@!${BOT}>`, `<@&${ROLE}>`]);
  assert.deepEqual(botMentionTokens(BOT, null), [`<@${BOT}>`, `<@!${BOT}>`]);
});

test('rename needs a slug', () => {
  assert.deepEqual(parseMention(`<@${BOT}> ${NADDR} rename slug:birth-date`, BOT), { kind: 'rename', link: LINK, slug: 'birth-date' });
  assert.deepEqual(parseMention(`<@${BOT}> rename ${NADDR}`, BOT), { kind: 'unknown', reason: 'rename-needs-slug' });
});

test('an invalid slug is refused at the boundary, never passed on raw', () => {
  assert.deepEqual(parseMention(`<@${BOT}> ${NADDR} slug:The_Mirror`, BOT), { kind: 'unknown', reason: 'bad-slug', slug: 'The_Mirror' });
});

test('a bare mention or "help" is help; other text without a link is no-link', () => {
  assert.deepEqual(parseMention(`<@${BOT}>`, BOT), { kind: 'help' });
  assert.deepEqual(parseMention(`<@${BOT}> help`, BOT), { kind: 'help' });
  assert.deepEqual(parseMention(`<@${BOT}> what's up`, BOT), { kind: 'unknown', reason: 'no-link' });
});

test('an naddr of another kind is not an Essay', () => {
  const note = nip19.naddrEncode({ kind: 30024, pubkey: HARRISON, identifier: D });
  assert.deepEqual(parseMention(`<@${BOT}> ${note}`, BOT), { kind: 'unknown', reason: 'not-an-essay' });
});

test('parseLink rejects malformed coordinates and undecodable naddrs', () => {
  assert.equal(parseLink('30023:nothex:x'), null);
  assert.equal(parseLink('naddr1qqqqqq'), null);
  assert.equal(parseLink(''), null);
});

test('buildCommand serves the CLI with the same rules', () => {
  assert.deepEqual(buildCommand({ input: COORDINATE, slug: 'x', name: 'Sam' }), { kind: 'curate', link: { coordinate: COORDINATE }, slug: 'x', name: 'Sam' });
  assert.deepEqual(buildCommand({ verb: 'rename', input: COORDINATE, slug: 'x' }), { kind: 'rename', link: { coordinate: COORDINATE }, slug: 'x' });
  assert.equal(buildCommand({ input: 'nope' }).reason, 'no-link');
  assert.deepEqual(buildCommand({ verb: 'standardize', dryRun: true }), { kind: 'standardize', dryRun: true });
  assert.deepEqual(buildCommand({ verb: 'standardize' }), { kind: 'standardize', dryRun: false });
});

test('standardize is CLI only: a Discord mention can never ask for it', () => {
  for (const content of [`<@${BOT}> standardize`, `<@${BOT}> standardize --dry-run`, `<@${BOT}> ${NADDR} standardize`]) {
    assert.notEqual(parseMention(content, BOT).kind, 'standardize', content);
  }
});

const CRAIG = 'https://craig.horse/rec/6JPyMh5Jcb5X?key=Kq7dummy';
const RECORDING = { id: '6JPyMh5Jcb5X', key: 'Kq7dummy' };

test('a Craig link starts an intake, bare or <suppressed>, on craig.horse or craig.chat', () => {
  for (const content of [
    `<@${BOT}> ${CRAIG}`,
    `<@!${BOT}> <${CRAIG}>`,
    `<@${BOT}> https://craig.chat/rec/6JPyMh5Jcb5X?key=Kq7dummy`,
  ]) {
    assert.deepEqual(parseMention(content, BOT), { kind: 'intake', craig: RECORDING }, content);
  }
});

test('the rest of the message is the Episode title, and the delete key goes nowhere', () => {
  const command = parseMention(`<@${BOT}>  Spider-Man Noir   S1E9 ${CRAIG}&delete=Zq9xDeL3te&foo=1 `, BOT);
  assert.deepEqual(command, { kind: 'intake', craig: RECORDING, title: 'Spider-Man Noir S1E9' });
  assert.ok(!JSON.stringify(command).includes('Zq9xDeL3te'));
  assert.deepEqual(parseMention(`<@${BOT}> https://craig.horse/rec/6JPyMh5Jcb5X?delete=Zq9xDeL3te&key=Kq7dummy`, BOT), { kind: 'intake', craig: RECORDING });
});

test("a long title is cut to the editor's 120 characters", () => {
  const command = parseMention(`<@${BOT}> ${CRAIG} ${'word '.repeat(40)}`, BOT);
  assert.equal(command.title.length, 119);
  assert.ok(command.title.startsWith('word word'));
});

test('a Craig link without a usable key is not an intake', () => {
  for (const link of ['https://craig.horse/rec/6JPyMh5Jcb5X', 'https://craig.horse/rec/6JPyMh5Jcb5X?key=', 'https://craig.horse/rec/6JPyMh5Jcb5X?key=a-b']) {
    assert.deepEqual(parseMention(`<@${BOT}> ${link}`, BOT), { kind: 'unknown', reason: 'craig-needs-key' }, link);
  }
  for (const link of ['https://craig.example/rec/6JPyMh5Jcb5X?key=Kq7dummy', 'http://craig.horse/rec/6JPyMh5Jcb5X?key=Kq7dummy']) {
    assert.notEqual(parseMention(`<@${BOT}> ${link}`, BOT).kind, 'intake', link);
  }
});

test('a Craig link with a second link of either kind is refused rather than guessing which was meant', () => {
  for (const content of [`${CRAIG} ${NADDR}`, `<https://njump.me/${NADDR}> ${CRAIG}`, `${CRAIG} ${CRAIG.replace('craig.horse', 'craig.chat')}`]) {
    assert.deepEqual(parseMention(`<@${BOT}> ${content}`, BOT), { kind: 'unknown', reason: 'two-links' }, content);
  }
});
