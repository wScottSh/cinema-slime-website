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

test('buildEssayCardHtml omits the author element when authorName is empty', () => {
  const noAuthor = { ...baseEssay, authorName: '' };
  const html = buildEssayCardHtml(COORD, noAuthor);
  assert.ok(!html.includes('essay-card-author'), `Author element present but should be absent in:\n${html}`);
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

test('buildEssayCardHtml HTML-escapes the image URL in src', () => {
  const withImage = { ...baseEssay, image: 'https://example.com/a&b.jpg' };
  const html = buildEssayCardHtml(COORD, withImage);
  assert.ok(html.includes('src="https://example.com/a&amp;b.jpg"'), `Expected escaped src in:\n${html}`);
  assert.ok(!html.includes('src="https://example.com/a&b.jpg"'), `Unescaped & should not appear in:\n${html}`);
});

test('buildEssayCardHtml renders no image band when image is empty string', () => {
  const noImage = { ...baseEssay, image: '' };
  const html = buildEssayCardHtml(COORD, noImage);
  assert.ok(!html.includes('essay-card-image'), `Image band should be absent in:\n${html}`);
});

test('buildEssayCardHtml renders no image band when image is whitespace-only', () => {
  const noImage = { ...baseEssay, image: '   ' };
  const html = buildEssayCardHtml(COORD, noImage);
  assert.ok(!html.includes('essay-card-image'), `Image band should be absent for whitespace image in:\n${html}`);
});

test('buildEssayCardHtml image onerror handler removes the parent element to collapse the band on a dead URL', () => {
  const withImage = { ...baseEssay, image: 'https://example.com/cover.jpg' };
  const html = buildEssayCardHtml(COORD, withImage);
  assert.ok(
    html.includes('onerror="this.parentElement.remove()"'),
    `Expected onerror handler to remove parent element in:\n${html}`,
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
