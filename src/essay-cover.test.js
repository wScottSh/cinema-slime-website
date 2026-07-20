import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBodyImage, resolveCoverImage, buildFilmLeaderHtml } from './essay-cover.js';

// --- extractBodyImage: the three embed styles ---

test('extractBodyImage finds a markdown image', () => {
  const body = 'intro\n\n![a still](https://example.com/still.jpg)\n';
  assert.equal(extractBodyImage(body), 'https://example.com/still.jpg');
});

test('extractBodyImage finds a markdown image carrying a title attribute', () => {
  const body = '![a still](https://example.com/still.jpg "The Still")';
  assert.equal(extractBodyImage(body), 'https://example.com/still.jpg');
});

test('extractBodyImage tolerates whitespace inside the markdown parens', () => {
  const body = '![a]( https://example.com/still.jpg )';
  assert.equal(extractBodyImage(body), 'https://example.com/still.jpg');
});

test('extractBodyImage finds a raw img tag', () => {
  const body = 'words\n\n<img src="https://example.com/raw.png" alt="x">\n';
  assert.equal(extractBodyImage(body), 'https://example.com/raw.png');
});

test('extractBodyImage finds a raw img tag using single quotes', () => {
  const body = "<img class='hero' src='https://example.com/raw.png'>";
  assert.equal(extractBodyImage(body), 'https://example.com/raw.png');
});

test('extractBodyImage finds a bare image URL', () => {
  const body = 'see this\n\nhttps://example.com/bare.webp\n\nmore words';
  assert.equal(extractBodyImage(body), 'https://example.com/bare.webp');
});

test('extractBodyImage recognises each of the image extensions', () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']) {
    const body = `text https://example.com/pic.${ext} text`;
    assert.equal(extractBodyImage(body), `https://example.com/pic.${ext}`, `Failed for .${ext}`);
  }
});

test('extractBodyImage ignores a bare URL that is not an image', () => {
  const body = 'read https://example.com/article.html for more';
  assert.equal(extractBodyImage(body), null);
});

// --- extractBodyImage: a bare URL sitting in ordinary prose ---
// A bare URL is normally written inside a sentence, so the pattern must survive the
// punctuation that follows it while still keeping a real query string (see ADR 0009).

test('extractBodyImage finds a bare URL followed by a full stop', () => {
  const body = 'See https://example.com/a.png. done';
  assert.equal(extractBodyImage(body), 'https://example.com/a.png');
});

test('extractBodyImage finds a bare URL followed by a comma', () => {
  const body = 'See https://example.com/a.png, done';
  assert.equal(extractBodyImage(body), 'https://example.com/a.png');
});

test('extractBodyImage finds a bare URL followed by a closing paren', () => {
  const body = 'A still (see https://example.com/a.png) from the film';
  assert.equal(extractBodyImage(body), 'https://example.com/a.png');
});

test('extractBodyImage finds a bare URL followed by other sentence punctuation', () => {
  for (const punct of [';', ':', '!', ']', '}']) {
    const body = `look https://example.com/a.png${punct} then more`;
    assert.equal(extractBodyImage(body), 'https://example.com/a.png', `Failed for "${punct}"`);
  }
});

test('extractBodyImage keeps a genuine query string on a bare URL', () => {
  const body = 'resized https://example.com/a.png?w=800 inline';
  assert.equal(extractBodyImage(body), 'https://example.com/a.png?w=800');
});

test('extractBodyImage keeps a query string on a bare URL at the end of the body', () => {
  assert.equal(
    extractBodyImage('resized https://example.com/a.png?w=800&h=600'),
    'https://example.com/a.png?w=800&h=600',
  );
});

test('extractBodyImage does not swallow a sentence-final question mark as a query string', () => {
  const body = 'Is this the one https://example.com/a.png? I think so';
  assert.equal(extractBodyImage(body), 'https://example.com/a.png');
});

test('extractBodyImage still refuses a punctuation-trailed URL preceded by a markdown paren', () => {
  // The lookbehind must survive the punctuation change: the markdown pattern owns this
  // URL, and the bare pattern must not claim it a second time at a later index.
  const body = '![alt](https://example.com/only.jpg).';
  assert.equal(extractBodyImage(body), 'https://example.com/only.jpg');
});

// --- extractBodyImage: earliest-wins across styles ---

test('extractBodyImage picks the earliest match when a raw img tag precedes a markdown image', () => {
  const body = '<img src="https://example.com/first.png">\n\n![later](https://example.com/second.jpg)';
  assert.equal(extractBodyImage(body), 'https://example.com/first.png');
});

test('extractBodyImage picks the earliest match when a markdown image precedes a raw img tag', () => {
  const body = '![first](https://example.com/first.jpg)\n\n<img src="https://example.com/second.png">';
  assert.equal(extractBodyImage(body), 'https://example.com/first.jpg');
});

test('extractBodyImage picks the earliest match when a bare URL precedes a markdown image', () => {
  const body = 'https://example.com/first.gif\n\n![later](https://example.com/second.jpg)';
  assert.equal(extractBodyImage(body), 'https://example.com/first.gif');
});

test('extractBodyImage does not treat a markdown image URL as a bare URL match', () => {
  // The markdown match starts at index 0; a naive bare-URL scan would match the same
  // URL a few characters later. Earliest-wins must still yield the markdown hit.
  const body = '![alt](https://example.com/only.jpg)';
  assert.equal(extractBodyImage(body), 'https://example.com/only.jpg');
});

// --- extractBodyImage: exclusions and degenerate input ---

test('extractBodyImage skips data: URIs and takes the next real image', () => {
  const body = '![inline](data:image/png;base64,AAAA)\n\n![real](https://example.com/real.jpg)';
  assert.equal(extractBodyImage(body), 'https://example.com/real.jpg');
});

test('extractBodyImage returns null when the body has no images', () => {
  assert.equal(extractBodyImage('just words, no pictures at all'), null);
});

test('extractBodyImage returns null for an empty body', () => {
  assert.equal(extractBodyImage(''), null);
});

test('extractBodyImage returns null for a non-string body', () => {
  assert.equal(extractBodyImage(undefined), null);
  assert.equal(extractBodyImage(null), null);
  assert.equal(extractBodyImage(42), null);
});

// --- resolveCoverImage: the cascade ---

test('resolveCoverImage prefers the hero image when present', () => {
  const essay = { image: 'https://example.com/hero.jpg', body: '![b](https://example.com/body.jpg)' };
  assert.equal(resolveCoverImage(essay), 'https://example.com/hero.jpg');
});

test('resolveCoverImage falls back to the first body image when the hero image is absent', () => {
  const essay = { image: '', body: 'words\n\n![b](https://example.com/body.jpg)' };
  assert.equal(resolveCoverImage(essay), 'https://example.com/body.jpg');
});

test('resolveCoverImage falls back to the body image when the hero image is whitespace-only', () => {
  const essay = { image: '   ', body: '![b](https://example.com/body.jpg)' };
  assert.equal(resolveCoverImage(essay), 'https://example.com/body.jpg');
});

test('resolveCoverImage trims a padded hero image URL', () => {
  const essay = { image: '  https://example.com/hero.jpg  ', body: '' };
  assert.equal(resolveCoverImage(essay), 'https://example.com/hero.jpg');
});

test('resolveCoverImage returns null when both the hero image and body images are absent', () => {
  assert.equal(resolveCoverImage({ image: '', body: 'no pictures here' }), null);
});

test('resolveCoverImage returns null for a missing essay', () => {
  assert.equal(resolveCoverImage(undefined), null);
  assert.equal(resolveCoverImage(null), null);
});

// --- buildFilmLeaderHtml ---

test('buildFilmLeaderHtml renders sprocket bands and the wordmark', () => {
  const html = buildFilmLeaderHtml('On Cinema');
  assert.ok(html.includes('essay-cover-leader'), `Expected film leader class in:\n${html}`);
  assert.ok(html.includes('essay-cover-sprockets'), `Expected sprockets in:\n${html}`);
  assert.ok(html.includes('CINEMA SLIME'), `Expected wordmark in:\n${html}`);
});

test('buildFilmLeaderHtml is deterministic for the same seed', () => {
  assert.equal(buildFilmLeaderHtml('On Cinema'), buildFilmLeaderHtml('On Cinema'));
});

test('buildFilmLeaderHtml varies the gradient across different seeds', () => {
  const seeds = ['On Cinema', 'On Slime', 'The Third One', 'A Fourth', 'Five', 'Six', 'Seven'];
  const rendered = new Set(seeds.map(buildFilmLeaderHtml));
  assert.ok(rendered.size > 1, 'Expected different seeds to produce different gradients');
});

test('buildFilmLeaderHtml renders a valid leader for an empty seed', () => {
  const html = buildFilmLeaderHtml('');
  assert.ok(html.includes('essay-cover-leader'), `Expected film leader class in:\n${html}`);
  assert.ok(html.includes('CINEMA SLIME'), `Expected wordmark in:\n${html}`);
});

test('buildFilmLeaderHtml emits only brand-palette colours in its inline style', () => {
  const PALETTE = ['#39ff14', '#e63220', '#ff8c00', '#0a0a0a'];
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const colours = buildFilmLeaderHtml(seed).match(/#[0-9a-f]{6}/gi) || [];
    assert.ok(colours.length > 0, `Expected colours in leader for seed ${seed}`);
    for (const c of colours) {
      assert.ok(PALETTE.includes(c.toLowerCase()), `Non-brand colour ${c} for seed ${seed}`);
    }
  }
});
