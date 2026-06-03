import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// In production, /api/rss is served by the nginx reverse-proxy/cache on the
// droplet (see docs/deploy/nginx-rss-proxy.md). Locally there is no nginx, so
// the dev server proxies the same path straight to the Anchor feed — keeping
// the browser code identical (same-origin fetch) in dev and prod.
const ANCHOR_RSS_PATH = '/s/1050fb0e4/podcast/rss';

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
    },
  },
});
