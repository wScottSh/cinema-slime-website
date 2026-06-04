import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEssayContent } from './essay-content-normalizer.js';

// Behavior 1 — tracer bullet: plain text paragraph → <p>
test('plain text is wrapped in a paragraph', () => {
  const { bodyHtml } = normalizeEssayContent('Hello world');
  assert.match(bodyHtml, /<p>Hello world<\/p>/);
});

// Behavior 2 — double newline separates paragraphs
test('double newline produces separate paragraphs', () => {
  const { bodyHtml } = normalizeEssayContent('First para\n\nSecond para');
  assert.match(bodyHtml, /<p>First para<\/p>/);
  assert.match(bodyHtml, /<p>Second para<\/p>/);
  const firstIdx = bodyHtml.indexOf('<p>First para</p>');
  const secondIdx = bodyHtml.indexOf('<p>Second para</p>');
  assert.ok(firstIdx < secondIdx, 'first paragraph comes before second');
});

// Behavior 3 — markdown headings
test('# heading renders as h1', () => {
  const { bodyHtml } = normalizeEssayContent('# My Title');
  assert.match(bodyHtml, /<h1>My Title<\/h1>/);
});

test('## heading renders as h2', () => {
  const { bodyHtml } = normalizeEssayContent('## Section');
  assert.match(bodyHtml, /<h2>Section<\/h2>/);
});

test('### heading renders as h3', () => {
  const { bodyHtml } = normalizeEssayContent('### Sub-section');
  assert.match(bodyHtml, /<h3>Sub-section<\/h3>/);
});

// Behavior 4 — markdown images render inline
test('markdown image syntax renders as an img tag', () => {
  const { bodyHtml } = normalizeEssayContent('![A cat](https://example.com/cat.jpg)');
  assert.match(bodyHtml, /<img src="https:\/\/example\.com\/cat\.jpg" alt="A cat"/);
});

test('image alt text is preserved', () => {
  const { bodyHtml } = normalizeEssayContent('![Cinema Slime logo](https://example.com/logo.png)');
  assert.match(bodyHtml, /alt="Cinema Slime logo"/);
});

// Behavior 5 — YouTube watch URL on its own line → iframe embed
test('YouTube watch URL on its own line becomes an iframe embed', () => {
  const { bodyHtml } = normalizeEssayContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.match(bodyHtml, /<iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
});

// Behavior 6 — youtu.be short URL on its own line → iframe embed
test('youtu.be short URL on its own line becomes an iframe embed', () => {
  const { bodyHtml } = normalizeEssayContent('https://youtu.be/dQw4w9WgXcQ');
  assert.match(bodyHtml, /<iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
});

// Behavior 7 — <script> tags in markdown text are escaped, not executed
test('<script> tag in markdown body is escaped, not rendered as a tag', () => {
  const { bodyHtml } = normalizeEssayContent('<script>alert("xss")</script>');
  assert.ok(!bodyHtml.includes('<script>'), 'raw <script> must not appear in output');
  assert.match(bodyHtml, /&lt;script&gt;/);
});

// Behavior 8 — raw HTML with event handlers is escaped (no live tags survive)
test('raw HTML img with onerror is escaped — no live tag in output', () => {
  const { bodyHtml } = normalizeEssayContent('<img src=x onerror="alert(1)">');
  assert.ok(!bodyHtml.includes('<img '), 'raw <img tag must not appear unescaped in output');
  assert.match(bodyHtml, /&lt;img/, 'the tag should appear as escaped text');
});

// Behavior 9 — javascript: URL in image syntax is not rendered as an img
test('javascript: URL in image syntax is not rendered as an img tag', () => {
  const { bodyHtml } = normalizeEssayContent('![evil](javascript:alert(1))');
  assert.ok(!bodyHtml.includes('<img'), 'no img tag should be emitted for javascript: URLs');
});

// Behavior 10 — empty / null / undefined input
test('empty string returns empty bodyHtml', () => {
  const { bodyHtml, rawMarkdown } = normalizeEssayContent('');
  assert.equal(bodyHtml, '');
  assert.equal(rawMarkdown, '');
});

test('null input returns empty bodyHtml', () => {
  const { bodyHtml, rawMarkdown } = normalizeEssayContent(null);
  assert.equal(bodyHtml, '');
  assert.equal(rawMarkdown, '');
});

test('undefined input returns empty bodyHtml', () => {
  const { bodyHtml } = normalizeEssayContent(undefined);
  assert.equal(bodyHtml, '');
});

// Behavior 11 — rawMarkdown is always the unmodified input
test('rawMarkdown equals the original input string', () => {
  const input = '# Title\n\nSome content with ![img](https://x.com/a.png)';
  const { rawMarkdown } = normalizeEssayContent(input);
  assert.equal(rawMarkdown, input);
});
