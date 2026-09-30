import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEssayHeaderHtml, buildEssayRailHtml, buildEssayDeckHtml, readingMinutes } from './essay-header.js';

const baseEssay = {
  title: 'On Cinema',
  authorName: 'Harrison Jensen',
  publishedAt: 1700000000,
  image: 'https://example.com/cover.jpg',
  summary: 'A short summary of the essay.',
  body: 'Some words about a film.',
};

// --- the screen: cover cascade ---

test('buildEssayHeaderHtml uses the essay cover image when present', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('https://example.com/cover.jpg'), `Cover image URL not found in:\n${html}`);
});

test('buildEssayHeaderHtml falls back to the first body image when image is absent', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, image: '', body: 'Intro\n\n![still](https://example.com/still.png)' });
  assert.ok(html.includes('https://example.com/still.png'), `Body image not found in:\n${html}`);
});

test('buildEssayHeaderHtml shows only the film leader when the essay has no image at all', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, image: '', body: 'No pictures here.' });
  assert.ok(html.includes('essay-cover-leader'), `Film leader not found in:\n${html}`);
  assert.ok(!html.includes('<img'), `No <img> should render without a cover:\n${html}`);
});

test('buildEssayHeaderHtml always renders the film leader beneath a cover image', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.indexOf('essay-cover-leader') < html.indexOf('<img'), `Leader must precede the image:\n${html}`);
});

test('buildEssayHeaderHtml renders the essay title', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('On Cinema'), `Title not found in:\n${html}`);
});

test('buildEssayHeaderHtml falls back to Untitled when title is empty', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, title: '' });
  assert.ok(html.includes('Untitled'), `Untitled fallback not found in:\n${html}`);
});

test('buildEssayHeaderHtml HTML-escapes the title', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, title: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), `Raw <script> tag must not appear in:\n${html}`);
  assert.ok(html.includes('&lt;script&gt;'), `Escaped title not found in:\n${html}`);
});

// --- the rail ---

test('buildEssayRailHtml renders the Cinema Slime Name byline when present', () => {
  const html = buildEssayRailHtml(baseEssay);
  assert.ok(html.includes('Harrison Jensen'), `Byline not found in:\n${html}`);
});

test('buildEssayRailHtml omits the byline when authorName is empty', () => {
  const html = buildEssayRailHtml({ ...baseEssay, authorName: '' });
  assert.ok(!html.includes('essay-author'), `Author element should not appear when authorName is empty:\n${html}`);
  assert.ok(!html.includes('Written by'), `Byline label should not appear when authorName is empty:\n${html}`);
});

test('buildEssayRailHtml HTML-escapes the Cinema Slime Name byline', () => {
  const html = buildEssayRailHtml({ ...baseEssay, authorName: '<b>Evil</b>' });
  assert.ok(!html.includes('<b>Evil</b>'), `Raw <b> tag must not appear in:\n${html}`);
  assert.ok(html.includes('&lt;b&gt;Evil&lt;/b&gt;'), `Escaped byline not found in:\n${html}`);
});

test('buildEssayRailHtml renders the publication date', () => {
  // publishedAt 1700000000 → Nov 14, 2023
  const html = buildEssayRailHtml(baseEssay);
  assert.ok(html.includes('Nov 14, 2023'), `Date not found in:\n${html}`);
});

test('buildEssayRailHtml renders the read time', () => {
  const html = buildEssayRailHtml(baseEssay);
  assert.ok(html.includes('1 min'), `Read time not found in:\n${html}`);
});

test('buildEssayRailHtml carries the back link the page binds to', () => {
  const html = buildEssayRailHtml(baseEssay);
  assert.ok(html.includes('id="back-from-essay"'), `Back link not found in:\n${html}`);
});

test('buildEssayRailHtml includes social proof only when given', () => {
  assert.ok(buildEssayRailHtml(baseEssay, { socialProofHtml: '<div class="social-proof">x</div>' }).includes('social-proof'));
  assert.ok(!buildEssayRailHtml(baseEssay).includes('social-proof'));
});

// --- the deck ---

test('buildEssayDeckHtml renders the summary deck when summary is present', () => {
  const html = buildEssayDeckHtml(baseEssay);
  assert.ok(html.includes('A short summary of the essay.'), `Summary not found in:\n${html}`);
  assert.ok(html.includes('essay-deck'), `Deck class not found in:\n${html}`);
});

test('buildEssayDeckHtml returns nothing when summary is absent or undefined', () => {
  assert.equal(buildEssayDeckHtml({ ...baseEssay, summary: '' }), '');
  const { summary: _ignored, ...noSummary } = baseEssay;
  assert.equal(buildEssayDeckHtml(noSummary), '');
});

test('buildEssayDeckHtml HTML-escapes the summary', () => {
  const html = buildEssayDeckHtml({ ...baseEssay, summary: '<i>x</i>' });
  assert.ok(html.includes('&lt;i&gt;x&lt;/i&gt;'), `Escaped summary not found in:\n${html}`);
});

// --- read time ---

test('readingMinutes is never less than one', () => {
  assert.equal(readingMinutes(''), 1);
  assert.equal(readingMinutes(undefined), 1);
});

test('readingMinutes counts words at 230 per minute', () => {
  assert.equal(readingMinutes(Array(690).fill('word').join(' ')), 3);
});

test('readingMinutes does not count URLs, markup or bare punctuation as words', () => {
  const body = `${Array(230).fill('word').join(' ')} ![a](https://x.com/a.png) <img src="y"> — https://x.com/b`;
  assert.equal(readingMinutes(body), 1);
});

// --- no DOM dependency ---

test('builders return strings (no DOM)', () => {
  assert.equal(typeof buildEssayHeaderHtml(baseEssay), 'string');
  assert.equal(typeof buildEssayRailHtml(baseEssay), 'string');
  assert.equal(typeof buildEssayDeckHtml(baseEssay), 'string');
});
