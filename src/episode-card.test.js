import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEpisodeCardHtml } from './episode-card.js';

const REAL_IDX = 5;
const baseEpisode = {
  title: 'Halloween | Cinema Slime Podcast',
  pubDate: 'Mon, 14 Nov 2023 12:00:00 +0000',
  image: 'https://example.com/art.jpg',
  episodeType: 'full',
  episode: '42',
  duration: '1:23:45',
  guid: 'tag:anchor.fm,2023:podcast/43698817/episode/12345',
};

// --- keyboard operability ---

test('buildEpisodeCardHtml wraps the card in an anchor link to the Episode Page', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  const expected = `href="#/episode/${encodeURIComponent(baseEpisode.guid)}"`;
  assert.ok(html.includes(expected), `Expected href in:\n${html}`);
});

test('buildEpisodeCardHtml anchor link uses the episode-card-link class', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(html.includes('episode-card-link'), `Expected episode-card-link class in:\n${html}`);
});

test('buildEpisodeCardHtml renders the play control as a button element', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(
    html.includes('<button') && html.includes('episode-card-play'),
    `Expected <button class="episode-card-play"> in:\n${html}`,
  );
});

test('buildEpisodeCardHtml does not use a div for the play control', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(
    !html.includes('<div class="episode-card-play"'),
    `Play control must not be a <div> in:\n${html}`,
  );
});

test('buildEpisodeCardHtml play button has an aria-label', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(html.includes('aria-label='), `Expected aria-label on play button in:\n${html}`);
});

test('buildEpisodeCardHtml play button aria-label includes the cleaned episode title', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  // Title is "Halloween | Cinema Slime Podcast" — branding should be stripped
  assert.ok(html.includes('aria-label="Play Halloween"'), `Expected aria-label with cleaned title in:\n${html}`);
});

test('buildEpisodeCardHtml anchor link opens before the play button so the card is the primary tab stop', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(
    html.indexOf('episode-card-link') < html.indexOf('<button'),
    `Link wrapper must open before the play button in:\n${html}`,
  );
});

// --- content rendering ---

test('buildEpisodeCardHtml sets data-idx on the card article', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(html.includes(`data-idx="${REAL_IDX}"`), `Expected data-idx="${REAL_IDX}" in:\n${html}`);
});

test('buildEpisodeCardHtml strips Cinema Slime branding from the rendered title', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(html.includes('Halloween'), `Expected cleaned title "Halloween" in:\n${html}`);
  assert.ok(!html.includes('Cinema Slime Podcast'), `Branding suffix should not appear in:\n${html}`);
});

test('buildEpisodeCardHtml shows episode label for a full episode with a number', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(html.includes('EPISODE 42'), `Expected "EPISODE 42" label in:\n${html}`);
});

test('buildEpisodeCardHtml omits episode label when no episode number is set', () => {
  const noNumber = { ...baseEpisode, episode: '' };
  const html = buildEpisodeCardHtml(noNumber, REAL_IDX);
  assert.ok(!html.includes('EPISODE'), `Episode label should be absent in:\n${html}`);
});

test('buildEpisodeCardHtml shows BONUS type badge for bonus episodes', () => {
  const bonusEp = { ...baseEpisode, episodeType: 'bonus', episode: '' };
  const html = buildEpisodeCardHtml(bonusEp, REAL_IDX);
  assert.ok(html.includes('episode-card-type'), `Expected type badge for bonus in:\n${html}`);
  assert.ok(html.includes('bonus'), `Expected "bonus" text in:\n${html}`);
});

test('buildEpisodeCardHtml shows TRAILER type badge for trailer episodes', () => {
  const trailerEp = { ...baseEpisode, episodeType: 'trailer', episode: '' };
  const html = buildEpisodeCardHtml(trailerEp, REAL_IDX);
  assert.ok(html.includes('episode-card-type'), `Expected type badge for trailer in:\n${html}`);
  assert.ok(html.includes('trailer'), `Expected "trailer" text in:\n${html}`);
});

test('buildEpisodeCardHtml omits type badge for full episodes', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(!html.includes('episode-card-type'), `Type badge should be absent for full episodes in:\n${html}`);
});

test('buildEpisodeCardHtml shows the publication date', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(html.includes('2023'), `Expected year 2023 in:\n${html}`);
  assert.ok(html.includes('Nov'), `Expected month Nov in:\n${html}`);
});

test('buildEpisodeCardHtml shows the episode duration', () => {
  const html = buildEpisodeCardHtml(baseEpisode, REAL_IDX);
  assert.ok(html.includes('1:23:45'), `Expected duration in:\n${html}`);
});

test('buildEpisodeCardHtml HTML-escapes the image src', () => {
  const unsafe = { ...baseEpisode, image: 'https://example.com/a&b.jpg' };
  const html = buildEpisodeCardHtml(unsafe, REAL_IDX);
  assert.ok(html.includes('src="https://example.com/a&amp;b.jpg"'), `Expected escaped src in:\n${html}`);
  assert.ok(!html.includes('src="https://example.com/a&b.jpg"'), `Unescaped & should not appear in:\n${html}`);
});
