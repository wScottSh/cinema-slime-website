# nginx Essays reverse-proxy + cache

How the same-origin Essays snapshot is served. The browser fetches essay data
from two **same-origin** paths (`/api/essays/curation` and `/api/essays/events`)
instead of waiting for WebSocket relay connections on the cold paint path.
nginx on the droplet `proxy_pass`es each path to the nostr.band HTTP API,
caches the JSON response, and serves the last-good copy when the upstream is
slow or unreachable.

This implements ADR 0008, which amends ADR 0006 decision #6 ("Nostr stays
client-side") by adding a thin nginx caching layer in front of the relay path
for Essays. The relay path (`nostr-pool.js`) remains active as the background
revalidation channel.

- **Upstream gateway:** `https://api.nostr.band/v0/search/events`
- **Curation path:** `/api/essays/curation` (kind:30001, brand pubkey, d=cinema-slime-essays)
- **Events path:** `/api/essays/events` (kind:30023, curated essay authors)
- **Droplet:** `root@161.35.188.75`, site root `/var/www/cinemaslime/html`
- **Staleness budget:** 5–10 min (TTL is 5 min here)

Locally there is no nginx; `vite.config.js` should proxy `/api/essays/curation`
and `/api/essays/events` to the upstream gateway so browser code is identical in
dev and prod. Add these proxy entries when adding the client-side snapshot parser
(the slice that consumes these endpoints).

## Config (committed)

- `deploy/nginx/cinemaslime-essays-cache.conf` — the `proxy_cache_path`
  cache-zone directive. Belongs in the `http{}` context; install into
  `/etc/nginx/conf.d/`.
- `deploy/nginx/cinemaslime-essays-location.conf` — the two `location` blocks
  for `/api/essays/curation` and `/api/essays/events`. Paste inside the HTTPS
  `server{}` for cinemaslime.com.

### Why these directives

- `proxy_set_header Host api.nostr.band` + `proxy_ssl_server_name on` — ensures
  correct SNI and Host header for the TLS handshake with the upstream.
- `proxy_ignore_headers Cache-Control Expires` — nostr.band may advertise its
  own cache-control headers; we ignore them and use our own 5-minute TTL.
- `proxy_cache_use_stale error timeout updating http_5xx` (+ `proxy_cache_background_update`
  / `proxy_cache_lock`) — a flaky or down upstream still serves the last good
  JSON; revalidation happens in the background without a thundering herd.
- `proxy_hide_header Access-Control-Allow-Origin` then `add_header ... "*"` —
  keeps CORS open without emitting the header twice if the upstream already
  sends it.
- `add_header X-Cache-Status $upstream_cache_status` — lets the smoke test see
  `MISS` → `HIT` → `STALE`.
- `limit=1` on the curation query — the curation list is a single addressable
  event (kind:30001); fetching more than one is wasteful.
- `limit=100` on the events query — accommodates a generous future growth in
  the curated essay count without a config change; the upstream payload is small.

## Apply to the droplet

```sh
KEY=~/.ssh/id_ed25519_cinemaslime_droplet
SITE=/etc/nginx/sites-available/cinemaslime.com

# 1. Cache zone (http context) + cache dir
scp -i "$KEY" deploy/nginx/cinemaslime-essays-cache.conf \
    root@161.35.188.75:/etc/nginx/conf.d/cinemaslime-essays-cache.conf
ssh -i "$KEY" root@161.35.188.75 'mkdir -p /var/cache/nginx/essays'

# 2. Add the two location blocks inside the HTTPS server{} (just before `location /`).
#    Edit $SITE on the box and paste deploy/nginx/cinemaslime-essays-location.conf.

# 3. Validate + reload
ssh -i "$KEY" root@161.35.188.75 'nginx -t && systemctl reload nginx'
```

## Verify

```sh
# Both paths should return 200 + application/json + open CORS.
# Second call to each should be a cache HIT.
curl -sI https://cinemaslime.com/api/essays/curation \
  | grep -iE 'http/|content-type|access-control-allow-origin|x-cache-status'
curl -sI https://cinemaslime.com/api/essays/curation \
  | grep -i x-cache-status   # -> HIT

curl -sI https://cinemaslime.com/api/essays/events \
  | grep -i x-cache-status   # -> HIT

# Confirm the upstream query returns at least one event (smoke test the gateway).
curl -s https://cinemaslime.com/api/essays/curation | head -200
```

### Stale-on-error

After the cache is warm, temporarily break the upstream (comment out the
`proxy_pass` line and replace with `return 503`), reload, and request
`/api/essays/curation` again: it still returns the cached JSON with
`X-Cache-Status: STALE`. Restore the real `proxy_pass` afterwards.

## When a new essay author joins

Adding a new essay (by a new author) to the curation list requires updating
the nginx `/api/essays/events` block:

1. Add the new author's **hex pubkey** (from the `a` tag coordinate in
   `scripts/publish-curation.mjs`) to the `author:…` terms in the `proxy_pass`
   URL inside `deploy/nginx/cinemaslime-essays-location.conf`.
2. Deploy the updated config to the droplet: `scp` the file, edit it into the
   `server{}` block, then `nginx -t && systemctl reload nginx`.
3. The curation list itself is re-published separately via
   `npm run publish:curation` (see `docs/curation-workflow.md`).

Current essay authors encoded in the `/api/essays/events` query:
| Pubkey (hex) | Name |
|---|---|
| `36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0` | Scott |
| `2cfce0fc7e8f5e8e29a42427ed5903b9cd846e33ace7a7ab79f03ce28e3584e6` | Harrison |
