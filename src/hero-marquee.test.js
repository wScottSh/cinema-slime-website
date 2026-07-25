import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGrungeFiltersHtml,
  buildSeasonTag,
  buildCatalogueLine,
  pickLatestEpisode,
  buildHeroMarqueeHtml,
} from './hero-marquee.js';

const LOGO = '/cs-logo.png';

const baseEpisode = {
  guid: 'guid-123',
  title: 'The Blob | Cinema Slime Podcast',
  pubDate: 'Tue, 14 Nov 2023 08:00:00 GMT',
  duration: '1:24:00',
  image: 'https://example.com/art.jpg',
  episodeType: 'full',
  season: '2',
  episode: '10',
};

const COORD = '30023:' + 'a'.repeat(64) + ':my-essay';
const baseEntry = {
  coordinate: COORD,
  essay: {
    title: 'On Cinema',
    authorName: 'Harrison Jensen',
    publishedAt: 1700000000,
    image: 'https://example.com/essay.jpg',
  },
};

function build(overrides = {}) {
  return buildHeroMarqueeHtml({
    episode: baseEpisode,
    episodeIndex: 0,
    episodeCount: 70,
    description: 'A blob eats a town.',
    essayEntry: baseEntry,
    logoUrl: LOGO,
    ...overrides,
  });
}

// ===== the SVG filter defs =====

test('buildGrungeFiltersHtml defines every filter the marquee references', () => {
  const html = buildGrungeFiltersHtml();
  for (const id of ['grunge-torn', 'grunge-torn-sm', 'grunge-ink', 'grunge-grain']) {
    assert.ok(html.includes(`id="${id}"`), `filter ${id} missing in:\n${html}`);
  }
});

test('buildGrungeFiltersHtml blurs the turbulence before displacing it', () => {
  // Displacing un-blurred fractal noise stair-steps the torn edge into 8-bit
  // jaggies — the blur is what keeps it organic.
  const html = buildGrungeFiltersHtml();
  const blur = html.indexOf('feGaussianBlur');
  const displace = html.indexOf('feDisplacementMap');
  assert.ok(blur !== -1, 'no feGaussianBlur');
  assert.ok(displace !== -1, 'no feDisplacementMap');
  assert.ok(blur < displace, 'turbulence must be blurred before it is displaced');
});

// ===== season tag =====

test('buildSeasonTag surfaces season and episode together', () => {
  assert.equal(buildSeasonTag(baseEpisode), 'S2 · E10');
});

test('buildSeasonTag falls back to the episode number when there is no season', () => {
  assert.equal(buildSeasonTag({ ...baseEpisode, season: '' }), 'EP 10');
});

test('buildSeasonTag labels bonus and trailer episodes by type', () => {
  assert.equal(buildSeasonTag({ ...baseEpisode, episodeType: 'bonus' }), 'BONUS');
  assert.equal(buildSeasonTag({ ...baseEpisode, episodeType: 'trailer' }), 'TRAILER');
});

test('buildSeasonTag is empty when there is neither a season nor an episode number', () => {
  assert.equal(buildSeasonTag({ ...baseEpisode, season: '', episode: '' }), '');
  assert.equal(buildSeasonTag(null), '');
});

// ===== catalogue line =====

test('buildCatalogueLine demotes the catalogue count to a depth line', () => {
  assert.equal(buildCatalogueLine(70), '70 episodes deep');
});

test('buildCatalogueLine is empty for an empty catalogue', () => {
  assert.equal(buildCatalogueLine(0), '');
  assert.equal(buildCatalogueLine(undefined), '');
});

// ===== picking the one Episode =====

test('pickLatestEpisode prefers the newest full episode', () => {
  const eps = [
    { ...baseEpisode, episodeType: 'trailer', guid: 't' },
    { ...baseEpisode, episodeType: 'full', guid: 'f' },
  ];
  assert.deepEqual(pickLatestEpisode(eps), { episode: eps[1], index: 1 });
});

test('pickLatestEpisode falls back to the newest episode of any type', () => {
  const eps = [{ ...baseEpisode, episodeType: 'bonus', guid: 'b' }];
  assert.deepEqual(pickLatestEpisode(eps), { episode: eps[0], index: 0 });
});

test('pickLatestEpisode returns null when there is nothing to show', () => {
  assert.equal(pickLatestEpisode([]), null);
  assert.equal(pickLatestEpisode(undefined), null);
});

// ===== the Episode panel =====

test('buildHeroMarqueeHtml renders the episode title with the podcast suffix stripped', () => {
  const html = build();
  assert.ok(html.includes('The Blob'), `title missing in:\n${html}`);
  assert.ok(!html.includes('| Cinema Slime Podcast'), `title suffix not stripped in:\n${html}`);
});

test('buildHeroMarqueeHtml shows the season tag rather than a raw episode label', () => {
  const html = build();
  assert.ok(html.includes('S2 · E10'), `season tag missing in:\n${html}`);
  assert.ok(!html.includes('EPISODE 10'), `raw episode label should be gone from:\n${html}`);
});

test('buildHeroMarqueeHtml demotes the catalogue count beside the season tag', () => {
  const html = build();
  assert.ok(html.includes('70 episodes deep'), `catalogue line missing in:\n${html}`);
  assert.ok(!html.includes('70 EPISODES AND COUNTING'), `old count line still present in:\n${html}`);
});

test('buildHeroMarqueeHtml shows the publication date and duration', () => {
  const html = build();
  assert.ok(html.includes('Nov'), `month missing in:\n${html}`);
  assert.ok(html.includes('2023'), `year missing in:\n${html}`);
  assert.ok(html.includes('1:24:00'), `duration missing in:\n${html}`);
});

test('buildHeroMarqueeHtml renders the supplied short description', () => {
  assert.ok(build().includes('A blob eats a town.'));
});

test('buildHeroMarqueeHtml renders the artwork once, unclipped, at 1:1', () => {
  // Episode artwork is square and must never be cropped: the aspect ratio goes
  // on the <img>, and object-fit contains rather than covers.
  const html = build();
  assert.ok(html.includes('https://example.com/art.jpg'), `artwork missing in:\n${html}`);
  assert.ok(html.includes('hero-marquee-poster'), `poster frame missing in:\n${html}`);
});

test('buildHeroMarqueeHtml wires playback and the episode page to the panel', () => {
  const html = build({ episodeIndex: 4 });
  assert.ok(html.includes('data-play="4"'), `play hook missing in:\n${html}`);
  assert.ok(html.includes('data-open="guid-123"'), `episode-page hook missing in:\n${html}`);
});

test('buildHeroMarqueeHtml escapes HTML in the episode title', () => {
  const html = build({ episode: { ...baseEpisode, title: '<script>alert(1)</script>' } });
  assert.ok(!html.includes('<script>'), `unescaped script tag in:\n${html}`);
  assert.ok(html.includes('&lt;script&gt;'), `escaped title missing in:\n${html}`);
});

test('buildHeroMarqueeHtml escapes HTML in the description', () => {
  const html = build({ description: '<em>slime</em>' });
  assert.ok(!html.includes('<em>slime</em>'), `unescaped description in:\n${html}`);
});

// ===== the logo sticker and the deck =====

test('buildHeroMarqueeHtml slaps the logo over the panel as a sticker', () => {
  const html = build();
  assert.ok(html.includes('hero-sticker'), `sticker missing in:\n${html}`);
  assert.ok(html.includes(`src="${LOGO}"`), `logo src missing in:\n${html}`);
});

test('buildHeroMarqueeHtml carries no typed CINEMA / SLIME headline — the logo carries it', () => {
  const html = build();
  assert.ok(!html.includes('hero-title'), `typed wordmark still present in:\n${html}`);
});

test('buildHeroMarqueeHtml renders the deck copy', () => {
  const html = build();
  assert.ok(html.includes('Film obsession'), `deck missing in:\n${html}`);
});

// ===== the one Essay =====

test('buildHeroMarqueeHtml pastes exactly one Essay flyer onto the panel', () => {
  const html = build();
  assert.ok(html.includes('On Cinema'), `essay title missing in:\n${html}`);
  assert.equal(html.split('hero-essay-flyer"').length - 1, 1, 'more than one flyer rendered');
});

test('buildHeroMarqueeHtml links the flyer to the essay page by coordinate', () => {
  const html = build();
  assert.ok(html.includes(`href="#/essay/${encodeURIComponent(COORD)}"`), `coordinate href missing in:\n${html}`);
});

test('buildHeroMarqueeHtml prefers the Essay Slug in the flyer link', () => {
  const html = build({ essayEntry: { ...baseEntry, slug: 'on-cinema' } });
  assert.ok(html.includes('href="#/essay/on-cinema"'), `slug href missing in:\n${html}`);
});

test('buildHeroMarqueeHtml shows the Cinema Slime Name when the brand designates one', () => {
  assert.ok(build().includes('Harrison Jensen'));
});

test('buildHeroMarqueeHtml omits the flyer entirely when there is no Essay', () => {
  const html = build({ essayEntry: null });
  assert.ok(!html.includes('hero-essay-flyer'), `flyer present but should be absent in:\n${html}`);
});

test('buildHeroMarqueeHtml falls back to a film leader when the Essay has no Cover Image', () => {
  const html = build({ essayEntry: { ...baseEntry, essay: { ...baseEntry.essay, image: '' } } });
  assert.ok(html.includes('essay-cover-leader'), `film leader missing in:\n${html}`);
});

test('buildHeroMarqueeHtml escapes HTML in the essay title', () => {
  const html = build({ essayEntry: { ...baseEntry, essay: { ...baseEntry.essay, title: '<b>x</b>' } } });
  assert.ok(!html.includes('<b>x</b>'), `unescaped essay title in:\n${html}`);
});

// ===== loading and empty states =====

test('buildHeroMarqueeHtml renders a skeleton panel while episodes load', () => {
  const html = buildHeroMarqueeHtml({ loading: true, logoUrl: LOGO });
  assert.ok(html.includes('hero-marquee--skeleton'), `skeleton missing in:\n${html}`);
  assert.ok(html.includes('hero-sticker'), `sticker should hold its place while loading:\n${html}`);
});

test('buildHeroMarqueeHtml drops the panel but keeps the branding when there are no episodes', () => {
  const html = buildHeroMarqueeHtml({ episode: null, logoUrl: LOGO });
  assert.ok(!html.includes('hero-marquee-panel'), `panel present but should be absent in:\n${html}`);
  assert.ok(html.includes('hero-sticker'), `sticker missing in:\n${html}`);
});

test('buildHeroMarqueeHtml still shows the Essay flyer while episodes load', () => {
  const html = buildHeroMarqueeHtml({ loading: true, logoUrl: LOGO, essayEntry: baseEntry });
  assert.ok(html.includes('On Cinema'), `essay missing during load in:\n${html}`);
});
