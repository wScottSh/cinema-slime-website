import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseEpisodes } from './rss-parse.js';

const ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';

// Wrap one or more <item> bodies in a minimal, itunes-namespaced RSS document.
function feed(...itemBodies) {
  const items = itemBodies.map((b) => `<item>${b}</item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:itunes="${ITUNES_NS}">
      <channel>${items}</channel>
    </rss>`;
  return new DOMParser().parseFromString(xml, 'text/xml');
}

function parse(itemBody, fallbackImage = '') {
  return parseEpisodes(feed(itemBody), fallbackImage)[0];
}

test('maps the core text fields of an item to an Episode', () => {
  const ep = parse(`
    <title>The Matrix (1999)</title>
    <pubDate>Wed, 01 May 2024 00:00:00 +0000</pubDate>
    <description>We jack in.</description>
    <link>https://pod.link/ep1</link>
    <guid>c363d1f1-832e-4add-9dcb-1f51225d0338</guid>
  `);

  assert.equal(ep.title, 'The Matrix (1999)');
  assert.equal(ep.pubDate, 'Wed, 01 May 2024 00:00:00 +0000');
  assert.equal(ep.description, 'We jack in.');
  assert.equal(ep.link, 'https://pod.link/ep1');
  assert.equal(ep.guid, 'c363d1f1-832e-4add-9dcb-1f51225d0338');
});

test('reads the audio URL from the enclosure element', () => {
  const ep = parse(`<enclosure url="https://cdn/ep1.mp3" type="audio/mpeg" length="123"/>`);
  assert.equal(ep.audioUrl, 'https://cdn/ep1.mp3');
});

test('reads iTunes-namespaced image/duration/episode/season/episodeType', () => {
  const ep = parse(`
    <itunes:image href="https://art/ep1.jpg"/>
    <itunes:duration>01:30:45</itunes:duration>
    <itunes:episode>7</itunes:episode>
    <itunes:season>2</itunes:season>
    <itunes:episodeType>bonus</itunes:episodeType>
  `);
  assert.equal(ep.image, 'https://art/ep1.jpg');
  assert.equal(ep.duration, '01:30:45');
  assert.equal(ep.episode, '7');
  assert.equal(ep.season, '2');
  assert.equal(ep.episodeType, 'bonus');
});

test('falls back to the supplied show art when itunes:image is absent', () => {
  const ep = parse(`<title>No art</title>`, 'https://art/show.jpg');
  assert.equal(ep.image, 'https://art/show.jpg');
});

test('defaults episodeType to "full" when absent', () => {
  const ep = parse(`<title>Regular</title>`);
  assert.equal(ep.episodeType, 'full');
});

test('passes through episodeType "full" when explicitly set', () => {
  const ep = parse(`<itunes:episodeType>full</itunes:episodeType>`);
  assert.equal(ep.episodeType, 'full');
});

test('passes through episodeType "trailer" when explicitly set', () => {
  const ep = parse(`<itunes:episodeType>trailer</itunes:episodeType>`);
  assert.equal(ep.episodeType, 'trailer');
});

test('returns empty strings for missing fields and no enclosure', () => {
  const ep = parse(`<title>Sparse</title>`);
  assert.equal(ep.pubDate, '');
  assert.equal(ep.description, '');
  assert.equal(ep.link, '');
  assert.equal(ep.guid, '');
  assert.equal(ep.audioUrl, '');
  assert.equal(ep.duration, '');
  assert.equal(ep.episode, '');
  assert.equal(ep.season, '');
});

test('trims surrounding whitespace from the guid', () => {
  const ep = parse(`<guid>  abc-123  </guid>`);
  assert.equal(ep.guid, 'abc-123');
});

test('maps every <item> in document order', () => {
  const doc = feed(`<title>First</title>`, `<title>Second</title>`, `<title>Third</title>`);
  const eps = parseEpisodes(doc);
  assert.equal(eps.length, 3);
  assert.deepEqual(eps.map((e) => e.title), ['First', 'Second', 'Third']);
});

test('returns an empty array for a feed with no items', () => {
  const doc = feed();
  assert.deepEqual(parseEpisodes(doc), []);
});
