import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEssayHeaderHtml, BRAND_MARK_URL } from './essay-header.js';

const baseEssay = {
  title: 'On Cinema',
  authorName: 'Harrison Jensen',
  publishedAt: 1700000000,
  image: 'https://example.com/cover.jpg',
  summary: 'A short summary of the essay.',
};

// --- hero image ---

test('buildEssayHeaderHtml uses the essay cover image when present', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('https://example.com/cover.jpg'), `Cover image URL not found in:\n${html}`);
  assert.ok(!html.includes(BRAND_MARK_URL), `Brand mark should not appear when cover image is present:\n${html}`);
});

test('buildEssayHeaderHtml falls back to the brand mark when image is absent', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, image: '' });
  assert.ok(html.includes(BRAND_MARK_URL), `Brand mark not found in:\n${html}`);
  assert.ok(!html.includes('example.com'), `Cover image should not appear when absent:\n${html}`);
});

test('buildEssayHeaderHtml falls back to the brand mark when image is undefined', () => {
  const { image: _ignored, ...noImage } = baseEssay;
  const html = buildEssayHeaderHtml(noImage);
  assert.ok(html.includes(BRAND_MARK_URL), `Brand mark not found in:\n${html}`);
});

test('buildEssayHeaderHtml applies brand-backdrop class when falling back to brand mark', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, image: '' });
  assert.ok(html.includes('essay-hero--brand'), `Brand-backdrop class not found in:\n${html}`);
});

test('buildEssayHeaderHtml applies cover-image class when using essay cover image', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('essay-hero--image'), `Cover-image class not found in:\n${html}`);
});

// --- header order: hero → title → byline → date → deck ---

test('buildEssayHeaderHtml renders the essay title', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('On Cinema'), `Title not found in:\n${html}`);
});

test('buildEssayHeaderHtml renders the Cinema Slime Name byline when present', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('Harrison Jensen'), `Byline not found in:\n${html}`);
});

test('buildEssayHeaderHtml omits the byline when authorName is empty', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, authorName: '' });
  assert.ok(!html.includes('Harrison Jensen'), `Byline should be absent when authorName is empty:\n${html}`);
  assert.ok(!html.includes('essay-author'), `Author element should not appear when authorName is empty:\n${html}`);
});

test('buildEssayHeaderHtml renders the publication date', () => {
  // publishedAt 1700000000 → Nov 14, 2023
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('2023'), `Year 2023 not found in:\n${html}`);
  assert.ok(html.includes('Nov'), `Month Nov not found in:\n${html}`);
});

// --- summary deck ---

test('buildEssayHeaderHtml renders the summary deck when summary is present', () => {
  const html = buildEssayHeaderHtml(baseEssay);
  assert.ok(html.includes('A short summary of the essay.'), `Summary not found in:\n${html}`);
  assert.ok(html.includes('essay-deck'), `Deck class not found in:\n${html}`);
});

test('buildEssayHeaderHtml omits the summary deck when summary is absent', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, summary: '' });
  assert.ok(!html.includes('essay-deck'), `Deck should be absent when summary is empty:\n${html}`);
});

test('buildEssayHeaderHtml omits the summary deck when summary is undefined', () => {
  const { summary: _ignored, ...noSummary } = baseEssay;
  const html = buildEssayHeaderHtml(noSummary);
  assert.ok(!html.includes('essay-deck'), `Deck should be absent when summary is undefined:\n${html}`);
});

// --- HTML escaping ---

test('buildEssayHeaderHtml HTML-escapes the title', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, title: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), `Raw <script> tag must not appear in:\n${html}`);
  assert.ok(html.includes('&lt;script&gt;'), `Escaped title not found in:\n${html}`);
});

test('buildEssayHeaderHtml HTML-escapes the Cinema Slime Name byline', () => {
  const html = buildEssayHeaderHtml({ ...baseEssay, authorName: '<b>Evil</b>' });
  assert.ok(!html.includes('<b>Evil</b>'), `Raw <b> tag must not appear in:\n${html}`);
  assert.ok(html.includes('&lt;b&gt;Evil&lt;/b&gt;'), `Escaped byline not found in:\n${html}`);
});

// --- no DOM dependency ---

test('buildEssayHeaderHtml returns a string (no DOM)', () => {
  const result = buildEssayHeaderHtml(baseEssay);
  assert.equal(typeof result, 'string');
});
