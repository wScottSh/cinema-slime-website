import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAboutSectionHtml,
  buildSubscribeSectionHtml,
  buildFooterHtml,
  FOOTER_SOCIAL_KEYS,
} from './site-bottom.js';

const SOCIAL = {
  youtube: { url: 'https://youtube.com/@cinemaslime', label: 'YouTube' },
  spotify: { url: 'https://example.com/spotify', label: 'Spotify' },
  patreon: { url: 'https://patreon.com/CinemaSlime', label: 'Patreon' },
  discord: { url: 'https://discord.gg/abc', label: 'Discord' },
  instagram: { url: 'https://example.com/ig', label: 'Instagram' },
  tiktok: { url: 'https://example.com/tiktok', label: 'TikTok' },
};

test('about section keeps the #about id the nav links to', () => {
  assert.match(buildAboutSectionHtml({}), /id="about"/);
});

test('about section bills all three hosts', () => {
  const html = buildAboutSectionHtml({});
  for (const name of ['Harrison Jensen', 'Renn Jensen', 'Scott Sheppard']) {
    assert.ok(html.includes(name), `missing host ${name}`);
  }
});

test('about section links the Discord CTA and the contact address', () => {
  const html = buildAboutSectionHtml({ discordUrl: 'https://discord.gg/abc' });
  assert.match(html, /href="https:\/\/discord\.gg\/abc"/);
  assert.match(html, /mailto:cinemaslimepodcast@gmail\.com/);
});

test('about section renders the logo sticker from the url it is given', () => {
  assert.match(buildAboutSectionHtml({ logoUrl: '/cs-logo.png' }), /src="\/cs-logo\.png"/);
});

test('subscribe section keeps the #subscribe id the nav links to', () => {
  assert.match(buildSubscribeSectionHtml(SOCIAL), /id="subscribe"/);
});

test('subscribe marquee carries every platform, with its per-platform id', () => {
  const html = buildSubscribeSectionHtml(SOCIAL);
  for (const [key, s] of Object.entries(SOCIAL)) {
    assert.ok(html.includes(`id="subscribe-${key}"`), `missing id for ${key}`);
    assert.ok(html.includes(s.label), `missing label for ${key}`);
  }
});

test('subscribe marquee renders nothing but the frame when there are no platforms', () => {
  const html = buildSubscribeSectionHtml({});
  assert.match(html, /marquee-letters/);
  assert.ok(!html.includes('marquee-letter-face'));
});

test('footer carries the short link set, not every platform', () => {
  const html = buildFooterHtml({ social: SOCIAL, year: 2026 });
  for (const key of FOOTER_SOCIAL_KEYS) {
    assert.ok(html.includes(SOCIAL[key].url), `missing footer link ${key}`);
  }
  // TikTok is in SOCIAL but not in the footer's short set.
  assert.ok(!html.includes(SOCIAL.tiktok.url));
});

test('footer skips a link whose platform is absent from SOCIAL', () => {
  const html = buildFooterHtml({ social: { youtube: SOCIAL.youtube }, year: 2026 });
  assert.match(html, /YouTube/);
  assert.ok(!html.includes('Spotify'));
});

test('footer prints the year it is given', () => {
  assert.match(buildFooterHtml({ social: SOCIAL, year: 2031 }), /© 2031 Cinema Slime Productions/);
});

test('external link labels are escaped, never interpolated raw', () => {
  const html = buildSubscribeSectionHtml({
    evil: { url: 'https://example.com/"onload="x', label: '<script>alert(1)</script>' },
  });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});
