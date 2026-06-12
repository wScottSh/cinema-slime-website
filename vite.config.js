import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// In production, /api/rss is served by the nginx reverse-proxy/cache on the
// droplet (see docs/deploy/nginx-rss-proxy.md). Locally there is no nginx, so
// the dev server proxies the same path straight to the Anchor feed — keeping
// the browser code identical (same-origin fetch) in dev and prod.
const ANCHOR_RSS_PATH = '/s/1050fb0e4/podcast/rss';

// In production, /api/essays/* are served by the nginx reverse-proxy/cache (ADR 0008).
// Locally the dev server proxies them to the upstream api.nostr.band gateway so the
// snapshot parser sees the same same-origin URLs in dev and prod.
const NOSTR_BAND_CURATION_PATH = '/v0/search/events?q=kind%3A30001+author%3A3fe7d91eb4133567db1ad7abab7ae308ebd9ae2d109601a7257e995035651365+%23d%3Acinema-slime-essays&limit=1';
const NOSTR_BAND_EVENTS_PATH = '/v0/search/events?q=kind%3A30023+author%3A36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0+author%3A2cfce0fc7e8f5e8e29a42427ed5903b9cd846e33ace7a7ab79f03ce28e3584e6&limit=100';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    // Injected at build time so a schema version bump (via package.json) automatically
    // invalidates cached blobs from an older shape. See ADR 0006 decision #4.
    __BUILD_VERSION__: JSON.stringify(version),
  },
  server: {
    proxy: {
      '/api/rss': {
        target: 'https://anchor.fm',
        changeOrigin: true,
        secure: true,
        rewrite: () => ANCHOR_RSS_PATH,
      },
      '/api/essays/curation': {
        target: 'https://api.nostr.band',
        changeOrigin: true,
        secure: true,
        rewrite: () => NOSTR_BAND_CURATION_PATH,
      },
      '/api/essays/events': {
        target: 'https://api.nostr.band',
        changeOrigin: true,
        secure: true,
        rewrite: () => NOSTR_BAND_EVENTS_PATH,
      },
    },
  },
});
