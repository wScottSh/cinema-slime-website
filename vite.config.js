import { defineConfig } from 'vite';

// In production, /api/rss is served by the nginx reverse-proxy/cache on the
// droplet (see docs/deploy/nginx-rss-proxy.md). Locally there is no nginx, so
// the dev server proxies the same path straight to the Anchor feed — keeping
// the browser code identical (same-origin fetch) in dev and prod.
const ANCHOR_RSS_PATH = '/s/1050fb0e4/podcast/rss';

export default defineConfig({
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
