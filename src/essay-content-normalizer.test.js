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

test('#### heading renders as h4', () => {
  const { bodyHtml } = normalizeEssayContent('#### Small heading');
  assert.match(bodyHtml, /<h4>Small heading<\/h4>/);
});

test('##### heading renders as h5', () => {
  const { bodyHtml } = normalizeEssayContent('##### Tiny heading');
  assert.match(bodyHtml, /<h5>Tiny heading<\/h5>/);
});

test('###### heading renders as h6', () => {
  const { bodyHtml } = normalizeEssayContent('###### Micro heading');
  assert.match(bodyHtml, /<h6>Micro heading<\/h6>/);
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

test('images carry loading="lazy"', () => {
  const { bodyHtml } = normalizeEssayContent('![alt](https://example.com/img.png)');
  assert.match(bodyHtml, /loading="lazy"/);
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

test('YouTube embed is wrapped in .youtube-embed div', () => {
  const { bodyHtml } = normalizeEssayContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.match(bodyHtml, /class="youtube-embed"/);
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

// Behavior 9b — javascript: URL in link syntax is not rendered as a link
test('javascript: URL in link syntax is not rendered as an anchor tag', () => {
  const { bodyHtml } = normalizeEssayContent('[click me](javascript:alert(1))');
  assert.ok(!bodyHtml.includes('href="javascript:'), 'no javascript: href must appear in output');
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

// Behavior 12 — bold and italic inline formatting
test('bold text renders as <strong>', () => {
  const { bodyHtml } = normalizeEssayContent('**bold text**');
  assert.match(bodyHtml, /<strong>bold text<\/strong>/);
});

test('italic text renders as <em>', () => {
  const { bodyHtml } = normalizeEssayContent('*italic text*');
  assert.match(bodyHtml, /<em>italic text<\/em>/);
});

// Behavior 13 — external links get target="_blank" rel="noopener"
test('external http link has target="_blank"', () => {
  const { bodyHtml } = normalizeEssayContent('[Cinema Slime](https://example.com)');
  assert.match(bodyHtml, /target="_blank"/);
});

test('external http link has rel="noopener"', () => {
  const { bodyHtml } = normalizeEssayContent('[Cinema Slime](https://example.com)');
  assert.match(bodyHtml, /rel="noopener"/);
});

test('external https link renders with href', () => {
  const { bodyHtml } = normalizeEssayContent('[Cinema Slime](https://example.com)');
  assert.match(bodyHtml, /href="https:\/\/example\.com"/);
});

// Behavior 14 — bare URLs are auto-linked (linkify)
test('bare https URL auto-links in text', () => {
  const { bodyHtml } = normalizeEssayContent('Visit https://example.com for more');
  assert.match(bodyHtml, /href="https:\/\/example\.com"/);
});

// Behavior 15 — mailto: links are allowed
test('mailto: URL in link syntax renders as an anchor tag', () => {
  const { bodyHtml } = normalizeEssayContent('[Email us](mailto:hello@example.com)');
  assert.match(bodyHtml, /href="mailto:hello@example\.com"/);
});

// Behavior 16 — unordered lists
test('unordered list renders as <ul> with <li> items', () => {
  const { bodyHtml } = normalizeEssayContent('- First item\n- Second item\n- Third item');
  assert.match(bodyHtml, /<ul>/);
  assert.match(bodyHtml, /<li>First item<\/li>/);
  assert.match(bodyHtml, /<li>Second item<\/li>/);
});

// Behavior 17 — ordered lists
test('ordered list renders as <ol> with <li> items', () => {
  const { bodyHtml } = normalizeEssayContent('1. First item\n2. Second item\n3. Third item');
  assert.match(bodyHtml, /<ol>/);
  assert.match(bodyHtml, /<li>First item<\/li>/);
  assert.match(bodyHtml, /<li>Second item<\/li>/);
});

// Behavior 18 — nested lists
test('nested list renders with nested <ul>', () => {
  const md = '- Parent item\n  - Child item\n  - Another child';
  const { bodyHtml } = normalizeEssayContent(md);
  assert.match(bodyHtml, /<ul>/);
  assert.match(bodyHtml, /<li>/);
  // Nested list should produce a second ul
  const ulCount = (bodyHtml.match(/<ul>/g) || []).length;
  assert.ok(ulCount >= 2, 'nested list should produce at least two <ul> elements');
});

// Behavior 19 — blockquotes
test('blockquote renders as <blockquote>', () => {
  const { bodyHtml } = normalizeEssayContent('> This is a quote');
  assert.match(bodyHtml, /<blockquote>/);
  assert.match(bodyHtml, /This is a quote/);
});

// Behavior 20 — inline code
test('inline code renders as <code>', () => {
  const { bodyHtml } = normalizeEssayContent('Use `npm install` to install');
  assert.match(bodyHtml, /<code>npm install<\/code>/);
});

// Behavior 21 — fenced code blocks
test('fenced code block renders as <pre><code>', () => {
  const md = '```\nconst x = 1;\n```';
  const { bodyHtml } = normalizeEssayContent(md);
  assert.match(bodyHtml, /<pre>/);
  assert.match(bodyHtml, /<code>/);
  assert.match(bodyHtml, /const x = 1;/);
});

// Behavior 22 — tables
test('markdown table renders as <table>', () => {
  const md = '| Name | Value |\n|------|-------|\n| foo  | bar   |';
  const { bodyHtml } = normalizeEssayContent(md);
  assert.match(bodyHtml, /<table>/);
  assert.match(bodyHtml, /<th>/);
  assert.match(bodyHtml, /<td>/);
  assert.match(bodyHtml, /foo/);
  assert.match(bodyHtml, /bar/);
});

// Behavior 23 — horizontal rules
test('horizontal rule renders as <hr>', () => {
  const { bodyHtml } = normalizeEssayContent('---');
  assert.match(bodyHtml, /<hr/);
});
