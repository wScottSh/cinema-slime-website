import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEssaySpotlightHtml } from './essay-spotlight.js';

const COORD = '30023:' + 'a'.repeat(64) + ':my-essay';
const baseEssay = {
  title: 'On Cinema',
  authorName: 'Harrison Jensen',
  publishedAt: 1700000000,
  summary: 'A look at the art of film.',
  image: 'https://example.com/img.jpg',
};
const baseEntry = { coordinate: COORD, essay: baseEssay };

// --- collapse cases ---

test('buildEssaySpotlightHtml returns empty string for null', () => {
  assert.equal(buildEssaySpotlightHtml(null), '');
});

test('buildEssaySpotlightHtml returns empty string for undefined', () => {
  assert.equal(buildEssaySpotlightHtml(undefined), '');
});

test('buildEssaySpotlightHtml returns empty string for empty array', () => {
  assert.equal(buildEssaySpotlightHtml([]), '');
});

// --- eyebrow and title ---

test('buildEssaySpotlightHtml renders the LATEST ESSAY eyebrow', () => {
  const html = buildEssaySpotlightHtml([baseEntry]);
  assert.ok(html.includes('LATEST ESSAY'), `Eyebrow missing in:\n${html}`);
});

test('buildEssaySpotlightHtml renders the essay title', () => {
  const html = buildEssaySpotlightHtml([baseEntry]);
  assert.ok(html.includes('On Cinema'), `Title missing in:\n${html}`);
});

// --- author ---

test('buildEssaySpotlightHtml renders the Cinema Slime Name when present', () => {
  const html = buildEssaySpotlightHtml([baseEntry]);
  assert.ok(html.includes('Harrison Jensen'), `Author missing in:\n${html}`);
});

test('buildEssaySpotlightHtml omits the author element when authorName is empty', () => {
  const entry = { ...baseEntry, essay: { ...baseEssay, authorName: '' } };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('essay-spotlight-author'), `Author element present but should be absent in:\n${html}`);
});

test('buildEssaySpotlightHtml omits the author element when authorName is absent', () => {
  const { authorName: _, ...essayNoAuthor } = baseEssay;
  const entry = { ...baseEntry, essay: essayNoAuthor };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('essay-spotlight-author'), `Author element present but should be absent in:\n${html}`);
});

// --- date ---

test('buildEssaySpotlightHtml shows the publication date', () => {
  // publishedAt 1700000000 → Nov 14, 2023 in en-US locale
  const html = buildEssaySpotlightHtml([baseEntry]);
  assert.ok(html.includes('2023'), `Year missing in:\n${html}`);
  assert.ok(html.includes('Nov'), `Month missing in:\n${html}`);
});

// --- summary ---

test('buildEssaySpotlightHtml renders the summary when present', () => {
  const html = buildEssaySpotlightHtml([baseEntry]);
  assert.ok(html.includes('A look at the art of film.'), `Summary missing in:\n${html}`);
});

test('buildEssaySpotlightHtml omits the summary element when summary is empty', () => {
  const entry = { ...baseEntry, essay: { ...baseEssay, summary: '' } };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('essay-spotlight-summary'), `Summary element present but should be absent in:\n${html}`);
});

test('buildEssaySpotlightHtml omits the summary element when summary is absent', () => {
  const { summary: _, ...essayNoSummary } = baseEssay;
  const entry = { ...baseEntry, essay: essayNoSummary };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('essay-spotlight-summary'), `Summary element present but should be absent in:\n${html}`);
});

// --- image variants ---

test('buildEssaySpotlightHtml renders an img tag when the essay has an image', () => {
  const html = buildEssaySpotlightHtml([baseEntry]);
  assert.ok(html.includes('<img'), `Image tag missing in:\n${html}`);
  assert.ok(html.includes('https://example.com/img.jpg'), `Image src missing in:\n${html}`);
});

test('buildEssaySpotlightHtml renders text-only (no img tag) when the essay has no image', () => {
  const entry = { ...baseEntry, essay: { ...baseEssay, image: '' } };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('<img'), `Img tag present but should be absent in:\n${html}`);
});

test('buildEssaySpotlightHtml renders text-only when image is absent', () => {
  const { image: _, ...essayNoImage } = baseEssay;
  const entry = { ...baseEntry, essay: essayNoImage };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('<img'), `Img tag present but should be absent in:\n${html}`);
});

// --- link / slug threading ---

test('buildEssaySpotlightHtml wraps the card in a link to the essay page using the coordinate', () => {
  const html = buildEssaySpotlightHtml([baseEntry]);
  const expected = `href="#/essay/${encodeURIComponent(COORD)}"`;
  assert.ok(html.includes(expected), `Expected coordinate href not found in:\n${html}`);
});

test('buildEssaySpotlightHtml uses the slug URL when a slug is provided', () => {
  const entry = { ...baseEntry, slug: 'on-cinema' };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(html.includes('href="#/essay/on-cinema"'), `Slug href missing in:\n${html}`);
  assert.ok(!html.includes(encodeURIComponent(COORD)), `Coordinate href should not appear when slug is present in:\n${html}`);
});

test('buildEssaySpotlightHtml uses the newest essay (entries[0])', () => {
  const COORD_B = '30023:' + 'b'.repeat(64) + ':other-essay';
  const secondEntry = { coordinate: COORD_B, essay: { ...baseEssay, title: 'Second Essay' } };
  const html = buildEssaySpotlightHtml([baseEntry, secondEntry]);
  assert.ok(html.includes('On Cinema'), 'First entry title missing');
  assert.ok(!html.includes('Second Essay'), 'Second entry title should not appear');
});

// --- HTML escaping ---

test('buildEssaySpotlightHtml escapes HTML in title', () => {
  const entry = { ...baseEntry, essay: { ...baseEssay, title: '<script>alert(1)</script>' } };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('<script>'), `Unescaped script tag found in:\n${html}`);
  assert.ok(html.includes('&lt;script&gt;'), `Escaped title missing in:\n${html}`);
});

test('buildEssaySpotlightHtml escapes HTML in authorName', () => {
  const entry = { ...baseEntry, essay: { ...baseEssay, authorName: '<b>Bold</b>' } };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('<b>Bold</b>'), `Unescaped HTML in author found in:\n${html}`);
  assert.ok(html.includes('&lt;b&gt;Bold&lt;/b&gt;'), `Escaped author missing in:\n${html}`);
});

test('buildEssaySpotlightHtml escapes HTML in summary', () => {
  const entry = { ...baseEntry, essay: { ...baseEssay, summary: '<em>great</em>' } };
  const html = buildEssaySpotlightHtml([entry]);
  assert.ok(!html.includes('<em>great</em>'), `Unescaped HTML in summary found in:\n${html}`);
  assert.ok(html.includes('&lt;em&gt;great&lt;/em&gt;'), `Escaped summary missing in:\n${html}`);
});
