import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEssayCardHtml, buildEssaysSectionHtml } from './essay-card.js';

const COORD = '30023:' + 'a'.repeat(64) + ':my-essay';
const baseEssay = { title: 'On Cinema', authorName: 'Harrison Jensen', publishedAt: 1700000000 };

// --- buildEssayCardHtml ---

test('buildEssayCardHtml renders the essay title', () => {
  const html = buildEssayCardHtml(COORD, baseEssay);
  assert.ok(html.includes('On Cinema'));
});

test('buildEssayCardHtml wraps the card in a link to the essay page', () => {
  const html = buildEssayCardHtml(COORD, baseEssay);
  const expected = `href="#/essay/${encodeURIComponent(COORD)}"`;
  assert.ok(html.includes(expected), `Expected href not found in:\n${html}`);
});

test('buildEssayCardHtml uses the slug URL when a slug is provided', () => {
  const html = buildEssayCardHtml(COORD, baseEssay, 'first');
  assert.ok(html.includes('href="#/essay/first"'), `Expected slug href in:\n${html}`);
  assert.ok(!html.includes(encodeURIComponent(COORD)), `Coordinate href should not appear when slug is present:\n${html}`);
});

test('buildEssayCardHtml falls back to coordinate URL when no slug is provided', () => {
  const html = buildEssayCardHtml(COORD, baseEssay, undefined);
  const expected = `href="#/essay/${encodeURIComponent(COORD)}"`;
  assert.ok(html.includes(expected), `Expected coordinate fallback href in:\n${html}`);
});

test('buildEssayCardHtml shows the publication date', () => {
  // publishedAt 1700000000 → Nov 14, 2023 in en-US locale
  const html = buildEssayCardHtml(COORD, baseEssay);
  assert.ok(html.includes('2023'), `Expected year 2023 in:\n${html}`);
  assert.ok(html.includes('Nov'), `Expected month Nov in:\n${html}`);
});

test('buildEssayCardHtml shows the author name when present', () => {
  const html = buildEssayCardHtml(COORD, baseEssay);
  assert.ok(html.includes('Harrison Jensen'), `Expected author name in:\n${html}`);
});

test('buildEssayCardHtml reserves the author line when authorName is empty', () => {
  const noAuthor = { ...baseEssay, authorName: '' };
  const html = buildEssayCardHtml(COORD, noAuthor);
  assert.ok(html.includes('essay-card-author'), `Author element should be reserved, not collapsed, in:\n${html}`);
  assert.ok(html.includes('&nbsp;'), `Expected a non-breaking space holding the author line open in:\n${html}`);
  assert.ok(
    html.includes('essay-card-author--empty'),
    `Expected the empty modifier so the "by " prefix is suppressed in:\n${html}`,
  );
});

test('buildEssayCardHtml does not mark a populated author line as empty', () => {
  const html = buildEssayCardHtml(COORD, baseEssay);
  assert.ok(!html.includes('essay-card-author--empty'), `Populated author wrongly marked empty in:\n${html}`);
});

test('buildEssayCardHtml renders an essay-card-image band when image is present', () => {
  const withImage = { ...baseEssay, image: 'https://example.com/cover.jpg' };
  const html = buildEssayCardHtml(COORD, withImage);
  assert.ok(html.includes('essay-card-image'), `Expected essay-card-image band in:\n${html}`);
  assert.ok(html.includes('src="https://example.com/cover.jpg"'), `Expected src in:\n${html}`);
  assert.ok(html.includes(`alt="${baseEssay.title}"`), `Expected alt=title in:\n${html}`);
  assert.ok(html.includes('loading="lazy"'), `Expected loading=lazy in:\n${html}`);
  assert.ok(html.includes('onerror='), `Expected onerror handler in:\n${html}`);
});

// --- cover art cascade (ticket 99) ---

test('buildEssayCardHtml uses the first body image when the hero image is absent', () => {
  const essay = { ...baseEssay, image: '', body: 'words\n\n![still](https://example.com/body.jpg)' };
  const html = buildEssayCardHtml(COORD, essay);
  assert.ok(html.includes('src="https://example.com/body.jpg"'), `Expected body image as cover in:\n${html}`);
});

test('buildEssayCardHtml prefers the hero image over a body image', () => {
  const essay = { ...baseEssay, image: 'https://example.com/hero.jpg', body: '![b](https://example.com/body.jpg)' };
  const html = buildEssayCardHtml(COORD, essay);
  assert.ok(html.includes('src="https://example.com/hero.jpg"'), `Expected hero image as cover in:\n${html}`);
  assert.ok(!html.includes('body.jpg'), `Body image should not be used when a hero image exists:\n${html}`);
});

test('buildEssayCardHtml renders the film leader when no image can be resolved', () => {
  const essay = { ...baseEssay, image: '', body: 'no pictures here' };
  const html = buildEssayCardHtml(COORD, essay);
  assert.ok(html.includes('essay-cover-leader'), `Expected film leader in:\n${html}`);
  assert.ok(html.includes('CINEMA SLIME'), `Expected film leader wordmark in:\n${html}`);
  assert.ok(!html.includes('<img'), `No image element should be rendered without a cover URL:\n${html}`);
});

test('buildEssayCardHtml always renders a cover band, whatever the data completeness', () => {
  const cases = [
    { ...baseEssay, image: 'https://example.com/hero.jpg' },
    { ...baseEssay, image: '', body: '![b](https://example.com/body.jpg)' },
    { ...baseEssay, image: '', body: '' },
    { title: '', authorName: '', publishedAt: 0, image: '', body: '' },
  ];
  for (const essay of cases) {
    const html = buildEssayCardHtml(COORD, essay);
    assert.ok(html.includes('essay-card-image'), `Cover band missing for ${JSON.stringify(essay)}`);
  }
});

test('buildEssayCardHtml layers the film leader behind the cover image so a 404 reveals it', () => {
  const essay = { ...baseEssay, image: 'https://example.com/cover.jpg', body: '' };
  const html = buildEssayCardHtml(COORD, essay);
  assert.ok(html.includes('essay-cover-leader'), `Leader should sit behind every cover image in:\n${html}`);
  assert.ok(
    html.indexOf('essay-cover-leader') < html.indexOf('<img'),
    `Leader must precede the image so the image layers over it in:\n${html}`,
  );
});

test('buildEssayCardHtml renders a complete card for an essay with an empty title', () => {
  const essay = { ...baseEssay, title: '', image: '' };
  const html = buildEssayCardHtml(COORD, essay);
  assert.ok(html.includes('essay-card-image'), `Cover band missing for empty title in:\n${html}`);
  assert.ok(html.includes('<h3>Untitled</h3>'), `Expected an Untitled placeholder in:\n${html}`);
  assert.ok(html.includes('essay-card-author'), `Author line missing for empty title in:\n${html}`);
  assert.ok(html.includes('card-meta'), `Meta line missing for empty title in:\n${html}`);
});

test('buildEssayCardHtml HTML-escapes the image URL in src', () => {
  const withImage = { ...baseEssay, image: 'https://example.com/a&b.jpg' };
  const html = buildEssayCardHtml(COORD, withImage);
  assert.ok(html.includes('src="https://example.com/a&amp;b.jpg"'), `Expected escaped src in:\n${html}`);
  assert.ok(!html.includes('src="https://example.com/a&b.jpg"'), `Unescaped & should not appear in:\n${html}`);
});

test('buildEssayCardHtml renders the film leader band when image is empty string', () => {
  const noImage = { ...baseEssay, image: '' };
  const html = buildEssayCardHtml(COORD, noImage);
  assert.ok(html.includes('essay-card-image'), `Cover band should still be present in:\n${html}`);
  assert.ok(html.includes('essay-cover-leader'), `Expected film leader in:\n${html}`);
});

test('buildEssayCardHtml renders the film leader band when image is whitespace-only', () => {
  const noImage = { ...baseEssay, image: '   ' };
  const html = buildEssayCardHtml(COORD, noImage);
  assert.ok(html.includes('essay-cover-leader'), `Expected film leader for whitespace image in:\n${html}`);
  assert.ok(!html.includes('<img'), `Whitespace image should not become an img src in:\n${html}`);
});

test('buildEssayCardHtml image onerror handler removes only the image, leaving the leader beneath', () => {
  const withImage = { ...baseEssay, image: 'https://example.com/cover.jpg' };
  const html = buildEssayCardHtml(COORD, withImage);
  assert.ok(
    html.includes('onerror="this.remove()"'),
    `Expected onerror handler to remove just the image in:\n${html}`,
  );
});

test('buildEssayCardHtml image band is inside the card link so the whole card is a single click target', () => {
  const withImage = { ...baseEssay, image: 'https://example.com/cover.jpg' };
  const html = buildEssayCardHtml(COORD, withImage);
  const href = `href="#/essay/${encodeURIComponent(COORD)}"`;
  assert.ok(html.includes(href), `Card link missing when image is present in:\n${html}`);
  assert.ok(
    html.indexOf(href) < html.indexOf('essay-card-image'),
    `Image band should appear after the link opens (inside it) in:\n${html}`,
  );
});

// --- buildEssaysSectionHtml ---

const COORD_B = '30023:' + 'b'.repeat(64) + ':other-essay';
const essayA = { title: 'On Cinema', authorName: 'Harrison Jensen', publishedAt: 1700000000 };
const essayB = { title: 'On Slime', authorName: 'Renn Jensen', publishedAt: 1710000000 };

test('buildEssaysSectionHtml renders one card per entry', () => {
  const entries = [
    { coordinate: COORD, essay: essayA },
    { coordinate: COORD_B, essay: essayB },
  ];
  const html = buildEssaysSectionHtml(entries);
  assert.ok(html.includes('On Cinema'), 'First essay title missing');
  assert.ok(html.includes('On Slime'), 'Second essay title missing');
});

test('buildEssaysSectionHtml threads slug through to card link', () => {
  const entries = [
    { coordinate: COORD, essay: essayA, slug: 'first' },
    { coordinate: COORD_B, essay: essayB },
  ];
  const html = buildEssaysSectionHtml(entries);
  assert.ok(html.includes('href="#/essay/first"'), 'Slug href missing for first essay');
  assert.ok(html.includes(`href="#/essay/${encodeURIComponent(COORD_B)}"`), 'Coordinate fallback href missing for second essay');
});

test('buildEssaysSectionHtml shows an empty state when entries is an empty array', () => {
  const html = buildEssaysSectionHtml([]);
  assert.ok(html.includes('No essays'), `Expected empty-state message in:\n${html}`);
});

test('buildEssaysSectionHtml shows a failure state when entries is null (relays unavailable)', () => {
  const html = buildEssaysSectionHtml(null);
  assert.ok(html.includes('unavailable') || html.includes('reach'), `Expected failure-state message in:\n${html}`);
});
