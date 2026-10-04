import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  episodeShareMeta, essayShareMeta, injectShareMeta, episodeTag, truncate,
  htmlToText, markdownToText, isSafeSegment, SHOW_ART,
} from './share-meta.js';

const TEMPLATE = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

const EPISODE = {
  guid: '8f82183d-b0ec-4956-af69-5c00ee43878f',
  title: 'Logan (2017) + OCTOBER CATEGORY LOTTERY',
  season: '2',
  episode: '18',
  episodeType: 'full',
  duration: '01:40:00',
  image: 'https://d3t3ozftmdmh3i.cloudfront.net/staging/podcast_uploaded_episode/1/logan.jpg',
  description: '<p><em>"Nature made me a freak."</em></p>'
    + '<p>(0:00) Intro</p><p>(5:40) LOGAN x 2017</p>'
    + '<p><strong>HARRISON\'S PICK x DAD-TEMBER</strong></p>'
    + '<p>In a bleak, near-future world where mutants are nearly extinct, a weary Logan cares for an ailing Professor X.</p>'
    + '<p>EXPERIENCE MOVIES WITH US!</p>',
};

const ESSAY_ENTRY = {
  coordinate: '30023:36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0:my-own-private-idaho-x-1991',
  slug: 'my-own-private-idaho',
  essay: {
    title: 'My Own Private Idaho x 1991',
    authorName: 'Renn',
    summary: 'Reflections on My Own Private Idaho.',
    image: 'https://blossom.primal.net/abc.jpg',
    body: '# Heading\n\nBody text.',
  },
};

test('episodeShareMeta titles an Episode by name and season/episode', () => {
  const meta = episodeShareMeta(EPISODE);
  assert.equal(meta.title, 'Logan (2017) + OCTOBER CATEGORY LOTTERY · S2E18');
  assert.equal(meta.documentTitle, 'Logan (2017) + OCTOBER CATEGORY LOTTERY | Cinema Slime Podcast');
  assert.equal(meta.url, 'https://cinemaslime.com/episode/8f82183d-b0ec-4956-af69-5c00ee43878f');
});

test('episodeShareMeta leads the description with the billing, then the synopsis — no Chapters or boilerplate', () => {
  const { description } = episodeShareMeta(EPISODE);
  assert.match(description, /^HARRISON'S PICK x DAD-TEMBER — In a bleak, near-future world/);
  assert.doesNotMatch(description, /LOGAN x 2017|EXPERIENCE MOVIES/);
});

test('episodeShareMeta uses the 640px same-origin artwork derivative, absolute', () => {
  assert.equal(episodeShareMeta(EPISODE).image,
    'https://cinemaslime.com/api/art/640/staging/podcast_uploaded_episode/1/logan.jpg');
});

test('episodeShareMeta falls back to the quote, then the site blurb, when there is no prose', () => {
  const quoteOnly = { ...EPISODE, description: '<p><em>"Nature made me a freak."</em></p>' };
  assert.equal(episodeShareMeta(quoteOnly).description, 'Nature made me a freak.');
  assert.match(episodeShareMeta({ ...EPISODE, description: '' }).description, /Experience movies with us/);
});

test('episodeTag names bonus, trailer, season-less and numbered Episodes', () => {
  assert.equal(episodeTag({ episodeType: 'bonus', episode: '3' }), 'Bonus');
  assert.equal(episodeTag({ episodeType: 'trailer' }), 'Trailer');
  assert.equal(episodeTag({ episodeType: 'full', episode: '39' }), 'E39');
  assert.equal(episodeTag({ episodeType: 'full', season: '2', episode: '1' }), 'S2E1');
  assert.equal(episodeTag({ episodeType: 'full' }), '');
});

test('essayShareMeta bylines the Cinema Slime Name and points og:url at the Slug', () => {
  const meta = essayShareMeta(ESSAY_ENTRY);
  assert.equal(meta.title, 'My Own Private Idaho x 1991 — by Renn');
  assert.equal(meta.url, 'https://cinemaslime.com/essay/my-own-private-idaho');
  assert.equal(meta.description, 'Reflections on My Own Private Idaho.');
  assert.equal(meta.image, 'https://blossom.primal.net/abc.jpg');
});

test('essayShareMeta falls back to the coordinate URL, the body text and the show art', () => {
  const meta = essayShareMeta({
    coordinate: ESSAY_ENTRY.coordinate,
    essay: { title: 'Untitled', body: '## Summary\n\nAlfred is **back** in [Gotham](https://x.test).' },
  });
  assert.equal(meta.url, `https://cinemaslime.com/essay/${encodeURIComponent(ESSAY_ENTRY.coordinate)}`);
  assert.equal(meta.title, 'Untitled');
  assert.equal(meta.description, 'Alfred is back in Gotham.');
  assert.equal(meta.image, SHOW_ART);
});

test('injectShareMeta replaces the title and every site-wide preview tag exactly once', () => {
  const html = injectShareMeta(TEMPLATE, episodeShareMeta(EPISODE));
  assert.match(html, /<title>Logan \(2017\) \+ OCTOBER CATEGORY LOTTERY \| Cinema Slime Podcast<\/title>/);
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name', 'twitter:card']) {
    assert.equal(html.split(`property="${tag}"`).length + html.split(`name="${tag}"`).length - 2, 1, tag);
  }
  assert.equal(html.split('name="description"').length - 1, 1);
  assert.equal(html.split('rel="canonical"').length - 1, 1);
  assert.match(html, /<script type="module"/, 'the SPA still boots');
});

test('injectShareMeta is idempotent, so the live page can serve as the template', () => {
  const once = injectShareMeta(TEMPLATE, episodeShareMeta(EPISODE));
  const twice = injectShareMeta(once, episodeShareMeta(EPISODE));
  assert.equal(twice, once);
});

test('injectShareMeta escapes attribute values', () => {
  const html = injectShareMeta(TEMPLATE, { ...episodeShareMeta(EPISODE), title: 'A "quoted" <b>' });
  assert.match(html, /og:title" content="A &quot;quoted&quot; &lt;b&gt;"/);
});

test('htmlToText strips tags, decodes entities and drops stray bullets', () => {
  assert.equal(htmlToText('<p>* Tom &amp; Jerry&#39;s</p><p>&#x2014;fun</p>'), "Tom & Jerry's —fun");
});

test('markdownToText drops images, headings and bare URLs', () => {
  assert.equal(markdownToText('![x](a.png)\n# Title\nSee https://a.test and _this_.'), 'See and this.');
});

test('truncate ends on a word with an ellipsis', () => {
  const out = truncate('word '.repeat(100), 50);
  assert.ok(out.length <= 50);
  assert.match(out, /word…$/);
  assert.equal(truncate('short'), 'short');
});

test('isSafeSegment admits guids, slugs and coordinates, not traversal or slashes', () => {
  assert.ok(isSafeSegment('8f82183d-b0ec-4956-af69-5c00ee43878f'));
  assert.ok(isSafeSegment('my-own-private-idaho'));
  assert.ok(isSafeSegment(ESSAY_ENTRY.coordinate));
  assert.ok(!isSafeSegment('..'));
  assert.ok(!isSafeSegment('a/b'));
  assert.ok(!isSafeSegment(''));
  assert.ok(!isSafeSegment('with space'));
});
