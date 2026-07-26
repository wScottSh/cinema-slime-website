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
  cache-zone directive. Belongs in the `http{}` context; CI installs it into
  `/etc/nginx/conf.d/`.
- `deploy/nginx/cinemaslime-essays-location.conf` — the two `location` blocks
  for `/api/essays/curation` and `/api/essays/events`. CI installs it into
  `/etc/nginx/snippets/` and `include`s it from the managed marker block inside
  the HTTPS `server{}` for cinemaslime.com.

Both are `location = …` **exact** matches, the highest-priority form in nginx's
location selection, so unlike the artwork blocks they need no `^~` and are immune
to the static-asset regex location (`location ~* \.(js|css|png|jpg|…)$`) further
down the vhost. The installer still places their include before `location / {`,
because the artwork snippet sharing that block genuinely depends on it.

### Why these directives

- `proxy_set_header Host api.nostr.band` + `proxy_ssl_server_name on` — ensures
  correct SNI and Host header for the TLS handshake with the upstream.
- `proxy_ignore_headers Cache-Control Expires` — nostr.band may advertise its
  own cache-control headers; we ignore them and use our own 5-minute TTL.
- `proxy_cache_use_stale error timeout updating http_5xx` (+ `proxy_cache_background_update`
  / `proxy_cache_lock`) — a flaky or down upstream still serves the last good
  JSON; revalidation happens in the background without a thundering herd.
- `inactive=30d` on the cache zone (in `cinemaslime-essays-cache.conf`) — this is
  the serve-stale **horizon**, not a TTL: freshness is `proxy_cache_valid 200 5m`,
  while `inactive` is how long nginx keeps an unhit entry before deleting it, and
  a deleted entry is one `proxy_cache_use_stale` can no longer serve. It was
  `60m`, which capped the "last good copy" guarantee at an hour; the 2026-07-25
  api.nostr.band outage outlasted it and both paths went to a hard 504 (ADR 0014).
- `proxy_connect_timeout 3s` / `proxy_send_timeout 5s` / `proxy_read_timeout 5s` —
  nginx defaults to 60s on each. During that same outage the upstream's TCP
  handshake never completed, so every request hung for a full minute before
  answering 504. Fail fast instead, and reach serve-stale while it still helps.
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

**Nothing to do by hand.** `deploy/nginx/install-edge-config.sh`, run from
`deploy-live.yml` on every push to `live`, creates `/var/cache/nginx/essays`,
copies `cinemaslime-essays-cache.conf` into `/etc/nginx/conf.d/`, and `include`s
`cinemaslime-essays-location.conf` from the managed marker block in the HTTPS
`server{}`. See [`edge-config.md`](edge-config.md).

> **This config was never applied to production.** It was committed here, and the
> manual playbook that used to occupy this section was never carried out, so
> `/api/essays/curation` and `/api/essays/events` returned `200 text/html` — the
> SPA shell — from the day the feature shipped until 2026-07-25. The ADR 0008
> edge-cached snapshot has therefore never actually worked in production; the
> site silently fell back to the slow relay path the whole time. Nothing was
> visibly broken, which is exactly why "a human will remember to scp it" is not
> a deployment mechanism.

`npm run verify:edge` now asserts that both paths return JSON rather than HTML,
as a pre-cutover gate in the deploy and on a 6-hourly cron
(`.github/workflows/verify-edge.yml`).

### Break glass

Emergency-only manual steps are in
[`edge-config.md`](edge-config.md#break-glass-emergency-only).

## Verify

`npm run verify:edge` asserts both paths automatically, and asserts the thing
that matters: **`application/json` plus a body that actually parses as JSON**.
Checking the status alone is what let these two drift — with no `location`
block installed, `try_files $uri $uri/ /index.html` answers both paths with a
200 and the SPA shell, and the Essays snapshot falls back to the `wss` relays
without a visible error. See `docs/deploy/edge-contract.md`.

By hand:

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
2. Merge to `live`. The deploy workflow reinstalls the snippet, validates with
   `nginx -t`, and reloads. There is no scp/paste/reload step any more.
3. The curation list itself is re-published separately via
   `npm run publish:curation` (see `docs/curation-workflow.md`).

Current essay authors encoded in the `/api/essays/events` query:
| Pubkey (hex) | Name |
|---|---|
| `36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0` | Scott |
| `2cfce0fc7e8f5e8e29a42427ed5903b9cd846e33ace7a7ab79f03ce28e3584e6` | Harrison |
