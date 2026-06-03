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

test('buildEssaysSectionHtml shows an empty state when entries is an empty array', () => {
  const html = buildEssaysSectionHtml([]);
  assert.ok(html.includes('No essays'), `Expected empty-state message in:\n${html}`);
});

test('buildEssaysSectionHtml shows a failure state when entries is null (relays unavailable)', () => {
  const html = buildEssaysSectionHtml(null);
  assert.ok(html.includes('unavailable') || html.includes('reach'), `Expected failure-state message in:\n${html}`);
});
