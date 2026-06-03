# nginx RSS reverse-proxy + cache

How Episodes are served. The browser fetches the podcast feed from a
**same-origin** path, `/api/rss`, instead of racing three public CORS proxies
(`corsproxy.io`, `allorigins.win`, `codetabs.com`). nginx on the droplet we
already run `proxy_pass`es that path to the Anchor feed, caches the response,
and serves the last-good copy when Anchor is slow or unreachable.

This implements ADR 0006 decision #2 (see
`docs/decisions/0006-runtime-data-fetch-with-edge-cache-and-swr.md`). It is
configuration on an nginx box we already operate — no application server, no
database.

- **Upstream feed:** `https://anchor.fm/s/1050fb0e4/podcast/rss`
- **Same-origin path:** `/api/rss` (referenced as `RSS_FEED_PATH` in `src/main.js`)
- **Droplet:** `root@161.35.188.75`, site root `/var/www/cinemaslime/html`
- **Staleness budget:** 5–10 min (TTL is 5 min here)

Locally there is no nginx; `vite.config.js` proxies `/api/rss` to Anchor so the
browser code is identical in dev and prod.

## Config (committed)

- `deploy/nginx/cinemaslime-rss-cache.conf` — the `proxy_cache_path` cache-zone
  directive. Belongs in the `http{}` context; install into `/etc/nginx/conf.d/`.
- `deploy/nginx/cinemaslime-rss-location.conf` — the `location = /api/rss` block.
  Paste inside the HTTPS `server{}` for cinemaslime.com.

### Why these directives

- `proxy_set_header Host anchor.fm` + `proxy_ssl_server_name on` — Anchor is
  behind Fastly; without the right Host/SNI the TLS handshake or vhost routing
  fails.
- `proxy_ignore_headers Cache-Control Expires` — Anchor advertises
  `s-maxage=604834` (~7 days). Without ignoring it nginx would cache for a week;
  we want our own `proxy_cache_valid 200 5m`.
- `proxy_cache_use_stale error timeout updating http_500 http_502 http_503
  http_504` (+ `proxy_cache_background_update`/`proxy_cache_lock`) — a flaky or
  down Anchor still serves the last good copy; revalidation happens in the
  background without a thundering herd.
- `proxy_hide_header Access-Control-Allow-Origin` then `add_header ... "*"` —
  keep CORS open without emitting the header twice (Anchor already sends it).
- `add_header X-Cache-Status $upstream_cache_status` — lets the smoke test see
  `MISS` → `HIT` → `STALE`.

## Apply to the droplet

```sh
KEY=~/.ssh/id_ed25519_cinemaslime_droplet
SITE=/etc/nginx/sites-available/cinemaslime.com

# 1. Cache zone (http context) + cache dir
scp -i "$KEY" deploy/nginx/cinemaslime-rss-cache.conf \
    root@161.35.188.75:/etc/nginx/conf.d/cinemaslime-rss-cache.conf
ssh -i "$KEY" root@161.35.188.75 'mkdir -p /var/cache/nginx/rss'

# 2. Add the location block inside the HTTPS server{} (just before `location /`).
#    Edit $SITE on the box and paste deploy/nginx/cinemaslime-rss-location.conf.

# 3. Validate + reload
ssh -i "$KEY" root@161.35.188.75 'nginx -t && systemctl reload nginx'
```

## Verify

```sh
# 200 + rss content-type + open CORS; second call should be a cache HIT.
curl -sI https://cinemaslime.com/api/rss | grep -iE 'http/|content-type|access-control-allow-origin|x-cache-status'
curl -sI https://cinemaslime.com/api/rss | grep -i x-cache-status   # -> HIT
```

Then load https://cinemaslime.com and confirm Episodes populate from `/api/rss`
with no requests to the old public proxies.

### Stale-on-error

After the cache is warm, point `proxy_pass` at an unreachable host (or otherwise
break egress to Anchor), reload, and request `/api/rss` again: it still returns
the cached feed with `X-Cache-Status: STALE`. Restore the real `proxy_pass`
afterwards.
