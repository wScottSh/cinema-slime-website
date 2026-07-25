// Verify that the live site's same-origin /api/ endpoints are actually the
// things they are supposed to be.
//
// Everything under /api/ — the RSS proxy, the two Essays snapshots, and the
// Episode-artwork derivatives — is nginx config on the droplet, not code in the
// deployed artifact. It can therefore rot without any build failing, and it
// had: /api/art/* was 404ing for every request, and /api/essays/* was answering
// 200 text/html (the SPA shell, via `try_files … /index.html`) because nginx
// had no location for it. Both clients degrade quietly, so nothing surfaced.
//
// This is the thin IO half: it discovers real artwork from the live feed,
// fetches every endpoint, measures the CloudFront originals, reads the
// configured image_filter_buffer out of the committed nginx config, and hands
// it all to src/edge-contract.js, which owns every assertion. Exits 1 if any
// check fails.
//
// Plain GETs and HEADs against public URLs — no SSH, no secrets, no writes,
// safe to re-run any time.
//
// Run: node scripts/verify-edge-contract.mjs   (or `npm run verify:edge`)
//      node scripts/verify-edge-contract.mjs https://staging.example.com
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseEpisodes } from '../src/rss-parse.js';
import { isArtworkUrl, ARTWORK_HOST, ARTWORK_WIDTHS } from '../src/artwork-url.js';
import {
  buildEdgeContract,
  parseImageFilterBuffer,
  pickArtworkSample,
  verdictImageFilterBuffer,
} from '../src/edge-contract.js';

const SITE = (process.argv[2] || 'https://cinemaslime.com').replace(/\/$/, '');

// Same reasoning as warm-artwork-cache.mjs: a cache miss costs the droplet a
// CloudFront fetch plus a GD decode of a 3000x3000 JPEG (~34 MB of bitmap), so
// never fan out unbounded.
const CONCURRENCY = 4;

// Enough artworks to prove the endpoint works at every rung without re-running
// `warm:artwork`'s full 210-request sweep. The spread is deterministic.
const ARTWORK_SAMPLE = 3;

const ART_CONF = fileURLToPath(new URL('../deploy/nginx/cinemaslime-art-cache.conf', import.meta.url));

// Fixed-size worker pool over a shared cursor — no dependency, no unbounded fan-out.
async function mapPool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

// The response descriptor src/edge-contract.js verdicts against. Bodies are
// read as bytes and only decoded inside the pure module, so an image and a feed
// travel through here identically.
async function describe(url) {
  const res = await fetch(url);
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers),
    body: new Uint8Array(await res.arrayBuffer()),
  };
}

// Same discovery as warm-artwork-cache.mjs, and deliberately from the LIVE feed
// rather than a fixture: the set verified must be the set visitors request.
async function fetchArtworkUrls() {
  const res = await fetch(`${SITE}/api/rss`);
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const episodes = parseEpisodes(xml, '');
  // isArtworkUrl, not a substring test — anything else risks HEADing arbitrary
  // third-party hosts.
  return [...new Set(episodes.map((e) => e.image).filter(isArtworkUrl))];
}

// HEAD the originals so the "materially smaller" and buffer checks run on real
// numbers rather than a constant someone measured once.
async function measureOrigins(urls) {
  const sizes = new Map();
  await mapPool(urls, async (url) => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const bytes = Number(res.headers.get('content-length'));
      if (res.ok && Number.isFinite(bytes) && bytes > 0) sizes.set(url, bytes);
    } catch {
      // Left unmeasured on purpose: the artwork verdict FAILS on an unknown
      // origin size rather than skipping, so a flaky HEAD is loud, not silent.
    }
  });
  return sizes;
}

function report(results) {
  let failures = 0;
  for (const { path, expectation, verdict } of results) {
    console.log(`  ${verdict.pass ? '✅' : '❌'} ${path}`);
    console.log(`       ${verdict.reason}`);
    // The expectation is only worth the line when something is wrong; on a
    // failure it is the difference between "this is broken" and "this is what
    // it was supposed to be".
    if (!verdict.pass) {
      failures++;
      console.log(`       expected: ${expectation}`);
    }
  }
  return failures;
}

async function main() {
  console.log(`Site:   ${SITE}`);

  const artwork = await fetchArtworkUrls();
  console.log(`Artwork: ${artwork.length} distinct Episode image(s) on ${ARTWORK_HOST}`);
  console.log(`Widths:  ${ARTWORK_WIDTHS.join(', ')}`);

  // Sizes come from the WHOLE catalogue (the buffer must clear the largest of
  // them all), while the derivative checks run against a sample.
  console.log(`Measuring ${artwork.length} CloudFront original(s) with HEAD...`);
  const originBytes = await measureOrigins(artwork);
  const unmeasured = artwork.length - originBytes.size;
  if (unmeasured) console.log(`  (${unmeasured} original(s) did not answer HEAD)`);

  const sample = pickArtworkSample(artwork, ARTWORK_SAMPLE);
  const contract = buildEdgeContract({ artworkUrls: sample, originBytes });
  console.log(`\nChecking ${contract.length} endpoint contract(s) (${sample.length} sampled artwork x ${ARTWORK_WIDTHS.length} rungs)...\n`);

  const results = await mapPool(contract, async (check) => ({
    ...check,
    verdict: await describe(`${SITE}${check.path}`)
      .then(check.verdict)
      .catch((err) => ({ pass: false, reason: `request failed: ${err.message}` })),
  }));

  let failures = report(results);

  // The one check that is not an HTTP request: committed nginx config against
  // the measured catalogue. Parsed from the conf file rather than hardcoded, so
  // the assertion cannot drift away from what is actually deployed.
  console.log('\nimage_filter_buffer (deploy/nginx/cinemaslime-art-cache.conf):');
  const bufferBytes = parseImageFilterBuffer(await readFile(ART_CONF, 'utf8'));
  const maxOriginBytes = Math.max(0, ...originBytes.values());
  const buffer = verdictImageFilterBuffer({ maxOriginBytes, bufferBytes });
  console.log(`  ${buffer.pass ? '✅' : '❌'} ${buffer.reason}`);
  if (!buffer.pass) failures++;

  console.log(`\n${contract.length + 1} check(s), ${failures} failure(s).`);
  if (failures) {
    console.error('\n❌ EDGE CONTRACT VIOLATED — an /api/ endpoint is not what the site expects it to be.');
    console.error('   These fail silently in the browser; see docs/deploy/nginx-artwork-proxy.md');
    console.error('   and docs/deploy/nginx-essays-proxy.md for the config each path needs.');
    process.exit(1);
  }
  console.log('\n✅ Edge contract holds.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
