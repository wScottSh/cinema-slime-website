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
import zlib from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { parseEpisodes } from '../src/rss-parse.js';
import { isArtworkUrl, ARTWORK_HOST, ARTWORK_WIDTHS } from '../src/artwork-url.js';
import {
  buildEdgeContract,
  classifyCheckOutcome,
  CROSS_ENCODING_HEADERS,
  parseImageFilterBuffer,
  pickArtworkSample,
  upstreamsOf,
  verdictCrossEncoding,
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

// Short on purpose: this probe only has to answer "is the gateway answering
// anything", and a slow answer is not a useful one when the whole point is to
// decide whether to blame a 504 on it.
const UPSTREAM_PROBE_TIMEOUT_MS = 8000;

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

// Decode a fetched `/api/rss` body to text, honoring whatever the response
// says it did to the bytes. Only gzip is expected in practice — nginx emits
// at most gzip after the Option A/C fix (docs/deploy/rss-accept-encoding-
// staleness-research.md) normalizes the outbound Accept-Encoding to identity
// and re-compresses to the client itself — but br/deflate are handled too
// since they are cheap to support and this check sends raw Accept-Encoding
// values a real browser would send.
function decodeRssBody(buffer, contentEncoding) {
  const enc = contentEncoding.toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer).toString('utf8');
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer).toString('utf8');
    if (enc.includes('deflate')) return zlib.inflateSync(buffer).toString('utf8');
    if (enc.includes('zstd')) {
      if (typeof zlib.zstdDecompressSync !== 'function') {
        throw new Error(`this Node.js runtime has no zstd decoder (${process.version})`);
      }
      return zlib.zstdDecompressSync(buffer).toString('utf8');
    }
    return buffer.toString('utf8');
  } catch (err) {
    if (enc.includes('zstd')) {
      // zstd is not a nginx-emitted encoding in this setup — seeing it at all,
      // and failing to decode it, is anomalous enough that silently
      // misreading the compressed bytes as text would hide a real problem
      // rather than surface one. Loud failure, not a fallback.
      throw new Error(`cannot decode content-encoding "${contentEncoding}": ${err.message}`);
    }
    // undici may have already transparently decoded the body even though the
    // response still carries a content-encoding header, or nginx sent
    // something this decoder doesn't need to touch — treat the bytes as utf8
    // text rather than failing the whole check on a decode mismatch.
    return buffer.toString('utf8');
  }
}

// One `/api/rss` fetch, sent with `encoding` as the OUTBOUND Accept-Encoding
// request header, decoded to text and shaped into the `{ encoding, res }`
// sample `verdictCrossEncoding` (src/edge-contract.js) takes. Errors are
// caught here, not left to reject the whole `Promise.all` below, so one
// encoding's fetch/decode failure is reported by name instead of losing every
// other sample's result.
async function fetchCrossEncodingSample(encoding) {
  try {
    const res = await fetch(`${SITE}/api/rss`, { headers: { 'Accept-Encoding': encoding } });
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentEncoding = res.headers.get('content-encoding') || '';
    const body = contentEncoding ? decodeRssBody(buffer, contentEncoding) : buffer.toString('utf8');
    return { encoding, res: { status: res.status, headers: Object.fromEntries(res.headers), body } };
  } catch (err) {
    return { encoding, res: { status: null, headers: {}, body: '' }, fetchError: err.message };
  }
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

// Is the third-party gateway reachable AT ALL, right now, independently of our
// own nginx? This is the evidence that lets a 504 be attributed to someone
// else's outage rather than to our config (see classifyCheckOutcome).
//
// Deliberately the weakest possible question: any HTTP answer, of any status,
// counts as reachable. We are not testing whether the gateway is CORRECT — if
// it answers at all and our endpoint still 504s, that is our problem again.
async function probeUpstream(host) {
  try {
    await fetch(`https://${host}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(UPSTREAM_PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

async function probeUpstreams(hosts) {
  const reachable = new Map();
  if (!hosts.length) return reachable;
  console.log(`\nProbing ${hosts.length} third-party upstream(s)...`);
  await Promise.all(hosts.map(async (host) => {
    const up = await probeUpstream(host);
    reachable.set(host, up);
    console.log(`  ${up ? '✅' : '⚠️ '} ${host} ${up ? 'reachable' : 'UNREACHABLE — its failures will not block the deploy'}`);
  }));
  return reachable;
}

function report(results, upstreamReachable) {
  let failures = 0;
  let degraded = 0;
  for (const { path, expectation, verdict, status, upstream } of results) {
    const outcome = classifyCheckOutcome({
      verdict,
      status,
      upstream,
      upstreamReachable: upstream ? upstreamReachable.get(upstream) : undefined,
    });
    const icon = { pass: '✅', degraded: '⚠️ ', fatal: '❌' }[outcome];
    console.log(`  ${icon} ${path}`);
    console.log(`       ${verdict.reason}`);
    // The expectation is only worth the line when something is wrong; on a
    // failure it is the difference between "this is broken" and "this is what
    // it was supposed to be".
    if (outcome === 'fatal') {
      failures++;
      console.log(`       expected: ${expectation}`);
    }
    if (outcome === 'degraded') {
      degraded++;
      console.log(`       ${upstream} is down — NOT a config fault, not blocking.`);
      console.log('       Readers are served by the nginx stale cache and the wss relays (ADR 0008).');
    }
  }
  return { failures, degraded };
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

  // The upstream probe runs alongside the contract, not after it: both must
  // describe the same moment, or a gateway that recovers mid-run gets a 504
  // blamed on config it did not come from.
  const [upstreamReachable, results] = await Promise.all([
    probeUpstreams(upstreamsOf(contract)),
    mapPool(contract, async (check) => {
      // The raw status is kept alongside the verdict — the verdict says whether
      // the endpoint is right, the status says who to blame when it is not.
      const res = await describe(`${SITE}${check.path}`).catch((err) => ({ error: err }));
      if (res.error) {
        return { ...check, status: null, verdict: { pass: false, reason: `request failed: ${res.error.message}` } };
      }
      return { ...check, status: res.status, verdict: check.verdict(res) };
    }),
  ]);

  console.log('');
  const { failures: checkFailures, degraded } = report(results, upstreamReachable);
  let failures = checkFailures;

  // The one check that is not an HTTP request: committed nginx config against
  // the measured catalogue. Parsed from the conf file rather than hardcoded, so
  // the assertion cannot drift away from what is actually deployed.
  console.log('\nimage_filter_buffer (deploy/nginx/cinemaslime-art-cache.conf):');
  const bufferBytes = parseImageFilterBuffer(await readFile(ART_CONF, 'utf8'));
  const maxOriginBytes = Math.max(0, ...originBytes.values());
  const buffer = verdictImageFilterBuffer({ maxOriginBytes, bufferBytes });
  console.log(`  ${buffer.pass ? '✅' : '❌'} ${buffer.reason}`);
  if (!buffer.pass) failures++;

  // The other non-HTTP-status check: does /api/rss agree with itself across
  // every Accept-Encoding a real browser might send? This is the regression
  // docs/deploy/rss-accept-encoding-staleness-research.md exists for — Fastly
  // (fronting anchor.fm) caches a distinct variant per Accept-Encoding, so two
  // browsers could silently see two different feeds. It has no `upstream`
  // declared (same as the `rss` snapshot check), so a mismatch here is FATAL,
  // not degradable — this is our nginx's own behavior, not a third-party
  // outage.
  console.log(`\nCross-encoding regression check (docs/deploy/rss-accept-encoding-staleness-research.md):`);
  const crossEncodingSamples = await Promise.all(CROSS_ENCODING_HEADERS.map(fetchCrossEncodingSample));
  for (const s of crossEncodingSamples) {
    if (s.fetchError) console.log(`  ⚠️  [${s.encoding}] fetch/decode error: ${s.fetchError}`);
  }
  const crossEncoding = verdictCrossEncoding(crossEncodingSamples);
  console.log(`  ${crossEncoding.pass ? '✅' : '❌'} ${crossEncoding.reason}`);
  if (!crossEncoding.pass) failures++;

  const degradedNote = degraded ? `, ${degraded} degraded (third-party outage)` : '';
  console.log(`\n${contract.length + 2} check(s), ${failures} failure(s)${degradedNote}.`);
  if (failures) {
    console.error('\n❌ EDGE CONTRACT VIOLATED — an /api/ endpoint is not what the site expects it to be.');
    console.error('   These fail silently in the browser; see docs/deploy/nginx-artwork-proxy.md');
    console.error('   and docs/deploy/nginx-essays-proxy.md for the config each path needs.');
    process.exit(1);
  }
  if (degraded) {
    console.log('\n⚠️  Edge contract holds, with a third-party gateway down.');
    console.log('   Our config is correct; the upstream is not answering. Readers keep');
    console.log('   their Essays via the nginx stale cache and the wss relays (ADR 0008),');
    console.log('   so this does not block the deploy. Re-run once the upstream is back.');
    return;
  }
  console.log('\n✅ Edge contract holds.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
