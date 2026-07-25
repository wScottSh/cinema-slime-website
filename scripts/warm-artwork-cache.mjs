// Pre-warm the droplet's Episode-artwork derivative cache.
//
// nginx resizes each (width, path) pair once, the first time anyone asks, then
// serves it from disk forever after (ADR 0013). This script does that first ask
// for every current Episode at every rung of the width ladder, so real visitors
// essentially never pay a resize themselves. Run it after every deploy.
//
// It is a plain GET loop against the public site — no SSH, no secrets, safe to
// re-run any time. Warming an already-warm cache just reports HITs.
//
// Run: node scripts/warm-artwork-cache.mjs   (or `npm run warm:artwork`)
//      node scripts/warm-artwork-cache.mjs https://staging.example.com
import { DOMParser } from '@xmldom/xmldom';
import { parseEpisodes } from '../src/rss-parse.js';
import { artworkUrl, isArtworkUrl, ARTWORK_WIDTHS, ARTWORK_HOST } from '../src/artwork-url.js';

const SITE = (process.argv[2] || 'https://cinemaslime.com').replace(/\/$/, '');
// Modest: each miss costs the droplet a CloudFront fetch plus a GD decode of a
// 3000x3000 JPEG (~34 MB of bitmap), so don't ask for many at once.
const CONCURRENCY = 4;

async function fetchArtworkUrls() {
  const res = await fetch(`${SITE}/api/rss`);
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const episodes = parseEpisodes(xml, '');
  // isArtworkUrl, not a substring test — the set warmed here must be exactly the
  // set artworkUrl rewrites, or we'd fetch absolute third-party URLs by mistake.
  const distinct = new Set(episodes.map((e) => e.image).filter(isArtworkUrl));
  return [...distinct];
}

async function warm(url) {
  const res = await fetch(`${SITE}${url}`);
  const bytes = Number(res.headers.get('content-length') || 0);
  return { url, ok: res.ok, status: res.status, cache: res.headers.get('x-cache-status') || '-', bytes };
}

// Fixed-size worker pool over a shared cursor — no dependency, no unbounded fan-out.
async function warmAll(urls, onResult) {
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      onResult(await warm(urls[next++]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
}

async function main() {
  console.log(`Site:   ${SITE}`);
  const artwork = await fetchArtworkUrls();
  console.log(`Artwork: ${artwork.length} distinct Episode image(s) on ${ARTWORK_HOST}`);
  console.log(`Widths:  ${ARTWORK_WIDTHS.join(', ')}`);

  const targets = artwork.flatMap((raw) => ARTWORK_WIDTHS.map((w) => artworkUrl(raw, w)));
  console.log(`Warming ${targets.length} derivative(s)...\n`);

  const counts = { MISS: 0, HIT: 0, other: 0 };
  let failures = 0;
  let bytes = 0;
  await warmAll(targets, (r) => {
    bytes += r.bytes;
    if (!r.ok) {
      failures++;
      console.error(`  ✗ ${r.status} ${r.url}`);
      return;
    }
    if (r.cache === 'MISS' || r.cache === 'HIT') counts[r.cache]++;
    else counts.other++;
  });

  console.log(`\nResized now (MISS): ${counts.MISS}`);
  console.log(`Already cached (HIT): ${counts.HIT}`);
  if (counts.other) console.log(`Other cache status: ${counts.other}`);
  console.log(`Total transferred: ${(bytes / 1024 / 1024).toFixed(2)} MB across ${targets.length} derivative(s)`);

  if (failures) {
    console.error(`\n❌ ${failures} artwork request(s) failed. Check the nginx config and the playbook's smoke test.`);
    process.exit(1);
  }
  console.log('\n✅ Artwork cache warm.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
