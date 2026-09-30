import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEpisodeTopHtml, buildEpisodeReelHtml, buildEpisodeLowerHtml, ransomStrips, runtimeLabel,
} from './episode-page.js';

const EP = {
  title: 'Logan (2017) + OCTOBER CATEGORY LOTTERY',
  image: 'https://example.com/logan.jpg',
  pubDate: '2026-09-23T12:00:00Z',
  duration: '01:43:11',
  season: '2',
  episode: '18',
  episodeType: 'full',
};
const NOTES = {
  quote: 'Nature made me a freak.',
  chapters: [
    { at: '7:15', secs: 435, len: 654, label: 'MOVIES WE WATCHED' },
    { at: '18:09', secs: 1089, len: 3871, label: 'LOGAN x 2017' },
  ],
  billing: { label: 'HARRISON’S PICK', theme: 'DAD-TEMBER' },
  proseHtml: '<p>In a bleak, near-future world.</p>',
};

// --- runtimeLabel ---

test('runtimeLabel reads hours and minutes, or minutes alone under an hour', () => {
  assert.equal(runtimeLabel('01:43:11'), '1h 43m');
  assert.equal(runtimeLabel('00:16:22'), '16 min');
});

test('runtimeLabel is empty when the duration is missing or unparseable', () => {
  assert.equal(runtimeLabel(''), '');
  assert.equal(runtimeLabel(undefined), '');
  assert.equal(runtimeLabel('n/a'), '');
});

// --- ransomStrips ---

const TITLES = [
  'Charlie & The Chocolate Factory (2005) + SEPTEMBER CATEGORY LOTTERY',
  'Logan (2017) + OCTOBER CATEGORY LOTTERY',
  'Son of The White Mare (1981)',
  'OCTOBER 2026 x "Noir-ctober" Film Lottery',
  'Sentimental Value (2025) + OCTOBER LOTTERY',
  'The Secret of NIMH (1982) x Don Bluth Deep Dive Week 1',
];

test('ransomStrips keeps every word, in order', () => {
  for (const t of TITLES) {
    assert.equal(ransomStrips(t).map((s) => s.text).join(' '), t.split(/\s+/).join(' '));
  }
});

test('ransomStrips gives the same title the same strips every time', () => {
  for (const t of TITLES) assert.deepEqual(ransomStrips(t), ransomStrips(t));
});

test('ransomStrips does not cycle the stock (the flag bug)', () => {
  const stocks = ransomStrips(TITLES[0]).map((s) => s.stock);
  const cycled = stocks.every((s, i) => i < 3 || s === stocks[i - 3]);
  assert.ok(!cycled, `Stock repeats with period 3: ${stocks.join(', ')}`);
});

test('ransomStrips never lets two red strips touch, or one stock run three in a row', () => {
  for (const t of TITLES) {
    const stocks = ransomStrips(t).map((s) => s.stock);
    stocks.forEach((s, i) => {
      if (i >= 1) assert.ok(!(s === 'red' && stocks[i - 1] === 'red'), `Touching reds in "${t}": ${stocks}`);
      if (i >= 2) assert.ok(!(s === stocks[i - 1] && s === stocks[i - 2]), `Three ${s} in a row in "${t}": ${stocks}`);
    });
  }
});

test('ransomStrips caps red as the accent and always uses it on a title of three or more strips', () => {
  for (const t of TITLES) {
    const strips = ransomStrips(t);
    const reds = strips.filter((s) => s.stock === 'red').length;
    assert.ok(reds <= (strips.length >= 7 ? 2 : 1), `Too many reds in "${t}"`);
    if (strips.length >= 3) assert.ok(reds >= 1, `No red in "${t}"`);
  }
});

test('ransomStrips keeps angle, lift and size within a readable range', () => {
  for (const s of TITLES.flatMap(ransomStrips)) {
    assert.ok(Math.abs(s.rot) <= 3.2, `rot ${s.rot}`);
    assert.ok(Math.abs(s.lift) <= 0.3, `lift ${s.lift}`);
    assert.ok(s.scale >= 0.9 && s.scale <= 1.08, `scale ${s.scale}`);
  }
});

test('ransomStrips of an empty title is no strips', () => {
  assert.deepEqual(ransomStrips(''), []);
});

// --- the top ---

test('buildEpisodeTopHtml renders the title as ransom strips, labelled with the whole title', () => {
  const html = buildEpisodeTopHtml(EP, NOTES);
  assert.ok(html.includes('aria-label="Logan (2017) + OCTOBER CATEGORY LOTTERY"'), html);
  assert.ok(html.includes('episode-cut--'), html);
});

test('buildEpisodeTopHtml cuts a short title bigger', () => {
  assert.ok(buildEpisodeTopHtml({ ...EP, title: 'Son of The White Mare (1981)' }, NOTES).includes('episode-ransom--short'));
  assert.ok(buildEpisodeTopHtml(EP, NOTES).includes('episode-ransom--long'));
});

test('buildEpisodeTopHtml strips the podcast-name suffix from the title', () => {
  const html = buildEpisodeTopHtml({ ...EP, title: 'Logan | Cinema Slime Podcast' }, NOTES);
  assert.ok(!html.includes('Cinema Slime Podcast'), html);
});

test('buildEpisodeTopHtml shows the billing as label and theme', () => {
  const html = buildEpisodeTopHtml(EP, NOTES);
  assert.ok(html.includes('HARRISON’S PICK'), html);
  assert.ok(html.includes('× DAD-TEMBER'), html);
});

test('buildEpisodeTopHtml shows a billing label alone when it has no theme', () => {
  const html = buildEpisodeTopHtml(EP, { ...NOTES, billing: { label: "RENN'S PICK", theme: '' } });
  assert.ok(html.includes('RENN&#39;S PICK'), html);
  assert.ok(!html.includes('episode-billing-theme'), html);
});

test('buildEpisodeTopHtml falls back to a "Now showing" stencil with no billing', () => {
  const html = buildEpisodeTopHtml(EP, { ...NOTES, billing: null });
  assert.ok(html.includes('Now showing'), html);
  assert.ok(!html.includes('episode-billing'), html);
});

test('buildEpisodeTopHtml shows the season tag, date and runtime', () => {
  const html = buildEpisodeTopHtml(EP, NOTES);
  assert.ok(html.includes('S2 · E18'), html);
  assert.ok(html.includes('Sep 23, 2026'), html);
  assert.ok(html.includes('1h 43m'), html);
});

test('buildEpisodeTopHtml renders a Play button and the way back', () => {
  const html = buildEpisodeTopHtml(EP, NOTES);
  assert.ok(html.includes('id="episode-play-btn"'), html);
  assert.ok(html.includes('id="back-to-episodes"'), html);
});

test('buildEpisodeTopHtml escapes the title', () => {
  const html = buildEpisodeTopHtml({ ...EP, title: '<script>x</script>' }, NOTES);
  assert.ok(!html.includes('<script>'), html);
});

// --- the Reel ---

test('buildEpisodeReelHtml renders one seek button per Chapter, carrying its seconds', () => {
  const html = buildEpisodeReelHtml(NOTES.chapters);
  assert.equal((html.match(/class="episode-frame"/g) || []).length, 2);
  assert.ok(html.includes('data-seek="435"'), html);
  assert.ok(html.includes('data-seek="1089"'), html);
});

test('buildEpisodeReelHtml sizes each frame by its share of the runtime', () => {
  const html = buildEpisodeReelHtml(NOTES.chapters);
  assert.ok(html.includes('flex-grow:654'), html);
  assert.ok(html.includes('flex-grow:3871'), html);
});

test('buildEpisodeReelHtml draws a Chapter of unknown length at the average width', () => {
  const html = buildEpisodeReelHtml([...NOTES.chapters, { at: '1:22:40', secs: 4960, len: 0, label: 'RATINGS' }]);
  assert.ok(html.includes(`flex-grow:${Math.round((654 + 3871) / 2)}`), html);
});

test('buildEpisodeReelHtml tells the reader the frames are clickable', () => {
  const html = buildEpisodeReelHtml(NOTES.chapters);
  assert.ok(html.includes('any frame to jump straight to that part'), html);
  assert.ok(html.includes('aria-label="Play from 7:15: MOVIES WE WATCHED"'), html);
});

test('buildEpisodeReelHtml is empty when there are no Chapters', () => {
  assert.equal(buildEpisodeReelHtml([]), '');
  assert.equal(buildEpisodeReelHtml(undefined), '');
});

// --- the lower wall ---

test('buildEpisodeLowerHtml renders the quote and the synopsis', () => {
  const html = buildEpisodeLowerHtml(NOTES);
  assert.ok(html.includes('“Nature made me a freak.”'), html);
  assert.ok(html.includes('<p>In a bleak, near-future world.</p>'), html);
  assert.ok(html.includes('The film'), html);
});

test('buildEpisodeLowerHtml omits the quote strip when there is no quote', () => {
  assert.ok(!buildEpisodeLowerHtml({ ...NOTES, quote: '' }).includes('episode-quote'));
});

test('buildEpisodeLowerHtml labels an unpatterned description as show notes', () => {
  assert.ok(buildEpisodeLowerHtml({ ...NOTES, billing: null }).includes('Show notes'));
});

test('buildEpisodeLowerHtml says so when there is no description at all', () => {
  assert.ok(buildEpisodeLowerHtml({ quote: '', chapters: [], billing: null, proseHtml: '' }).includes('No description available'));
});
