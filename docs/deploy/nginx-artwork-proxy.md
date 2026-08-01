# nginx Episode-artwork resize + cache

How Episode artwork is served. Every image slot on the site asks for a
**same-origin** path, `/api/art/{width}/{cloudfront-path}`, instead of the
original upload. nginx on the droplet we already run fetches the original from
CloudFront once, downscales it with the GD-backed `image_filter` module, caches
the **resized** result, and serves that to everyone thereafter.

The originals are 3000×3000 JPEGs averaging ~2.4 MB. Nothing on the site displays
them anywhere near that size — the hero film reel's frames are 270 px, blurred to
~2.2 px and dimmed to ~32 %. Serving the whole 70-Episode catalogue to the reel
cost ~172 MB on a cold load; at the 160 px rung it costs under 1 MB.

This implements ADR 0013 (see
`docs/decisions/0013-artwork-derivatives-via-nginx.md`). It is configuration on
an nginx box we already operate, plus one distro package — no application server,
no new process to supervise.

- **Upstream origin:** `https://d3t3ozftmdmh3i.cloudfront.net` (hardcoded in the
  config, never taken from the request)
- **Same-origin path:** `/api/art/{width}/{path}` (built by `src/artwork-url.js`)
- **Width ladder:** `160`, `320`, `640` — anything else is a 404
- **Droplet:** `root@161.35.188.75`, site root `/var/www/cinemaslime/html`
- **Browser freshness:** one year, `immutable` (origin filenames are unique per
  upload and never change in place)

Locally there is no nginx and nothing resizes; `vite.config.js` proxies
`/api/art/` to CloudFront with the `{width}` segment stripped, so the browser
code is identical in dev and prod and only the byte count differs.

## Which slot uses which rung

| Slot | Display size | Rung | Where |
| --- | --- | --- | --- |
| Hero film-reel frame | 270 px, blurred + dimmed | 160 | `src/hero-reel.js` |
| Sticky player thumbnail | 56 px | 160 | `src/main.js` |
| Episode grid card | 220 px | 320 | `src/episode-card.js` |
| Latest-Episode card | largest slot on the page | 640 | `src/hero-marquee.js` |

`src/artwork-url.js` is the single seam all four go through. Essay Cover Images
live on arbitrary Nostr hosts and pass through it unchanged, by design.

## Config (committed, CI-installed)

- `deploy/nginx/cinemaslime-art-cache.conf` — the `proxy_cache_path` zone **and**
  the loopback resize `server{}`. Both belong in the `http{}` context; CI
  installs it into `/etc/nginx/conf.d/`.
- `deploy/nginx/cinemaslime-art-location.conf` — the three `location` blocks. CI
  installs it into `/etc/nginx/snippets/` and `include`s it from the managed
  marker block inside the HTTPS `server{}` for cinemaslime.com.

The repo is the single source of truth for both; see
[`edge-config.md`](edge-config.md).

### Why three tiers and not one location

This is the one non-obvious thing about the config, and getting it wrong is
silent rather than loud:

1. nginx writes a proxied response to its cache store **before** the body-filter
   chain runs. `image_filter` is a body filter. So a location doing
   `proxy_pass` + `image_filter` + `proxy_cache` caches the **original**
   full-size bytes.
2. Worse, a cache **hit** is re-sent through that same filter chain — so the GD
   resize re-runs on every single request, hit or miss. `proxy_cache` would save
   only the upstream round-trip, not the resize.

So: the resize happens on a loopback-only server (`127.0.0.1:8081`), and the
cache sits in front of *that*. What gets stored is the already-resized output,
and the resize runs at most once per `(width, path)`.

The public tier is split in two for a separate nginx rule: `proxy_pass` may not
carry a location-relative URI suffix inside a regex location. So the regex
location only captures and validates `{width}`, then `rewrite … last` hands off
to a plain prefix location that does the proxying. The tier-3 server repeats the
same split for the same reason.

### Why these directives

- `proxy_pass https://$art_upstream/$origin_path` (a **variable** upstream) with
  `resolver 127.0.0.53` — not cosmetic. nginx resolves the host in a *literal*
  `proxy_pass` at config-load time, so one failed DNS lookup for CloudFront at
  boot/reload makes nginx `[emerg]` and refuse to start, taking **every** site on
  the box down. That is the 2026-07-29 outage — a transient blip left nginx dead
  for three days. A variable upstream defers the lookup to request time, so an
  unreachable CloudFront fails only the individual art request (which degrades to
  a dark placeholder). ADR 0014 applied to the artwork upstream. The path is
  captured (`^/_art_origin/(?<origin_path>.+)$`) and re-appended because a
  variable `proxy_pass` no longer strips the location prefix the way a literal
  one did.
- `image_filter_buffer 16M` — the 1 MB default rejects our sources outright with
  415. **Size this against the largest source, not the average.** Measured over
  the 70-Episode catalogue (2026-07): mean 2.35 MB but max 7.43 MB. An earlier
  `6M` was set from the mean and silently 415'd the two largest artworks — the
  client just showed its dark placeholder, so nothing surfaced until
  `npm run warm:artwork` failed the deploy. Re-check the tail when the catalogue
  grows:

  ```sh
  curl -s https://cinemaslime.com/api/rss \
    | grep -oE 'https://d3t3ozftmdmh3i\.cloudfront\.net/[^"<> ]+\.jpg' \
    | sort -u \
    | while read -r u; do curl -sI "$u" | tr -d '\r' \
        | awk -F': ' -v u="$u" 'tolower($1)=="content-length"{print $2, u}'; done \
    | sort -rn | head -5
  ```

  Raising it is cheap: the buffer holds the *compressed* source, while the real
  memory cost is the decode — a 3000×3000 truecolor bitmap is ~34 MB per
  in-flight resize regardless. Budget concurrency against that; the cache is what
  keeps concurrency near zero in practice.
- `image_filter resize $rz_width -` — proportional downscale driven by width;
  `-` lets height follow the aspect ratio.
- `image_filter_sharpen 20` — GD resamples with `gdImageCopyResampled`, which is
  soft; this is the documented mitigation.
- `inactive=365d` on the cache zone — deliberately long. A short window would
  evict a rarely-visited older Episode's artwork just for going quiet, which is
  precisely the long-tail asset this feature exists to keep cheap. With a
  year-long window, eviction only happens under genuine `max_size` pressure
  (LRU) — and that is also why no scheduled re-warm job is needed.
- `proxy_cache_key "cinemaslime-art|$art_width|$art_path"` — keyed on exactly
  (width, path), deliberately not `$request_uri`, so a query string cannot mint
  unlimited distinct cache entries for the same image.
- `proxy_ignore_headers Cache-Control Expires` + `proxy_hide_header
  Cache-Control` — CloudFront's own headers govern neither our cache freshness
  nor what the browser sees.
- `add_header Cache-Control "public, max-age=31536000, immutable" always` — safe
  because a given `{width}/{path}` can never legitimately change content.
- **No `error_page 415` fallback to the original.** A resize failure fails
  loudly. Redirecting it back to the full-size image would silently reintroduce
  the exact defect this config exists to fix; the client already degrades to its
  dark placeholder.
- `add_header X-Cache-Status $upstream_cache_status` — lets the smoke test see
  `MISS` → `HIT`.

## Apply to the droplet

**Nothing to do by hand.** The droplet's nginx config is installed by CI —
`deploy/nginx/install-edge-config.sh`, run from `deploy-live.yml` on every push
to `live`. See [`edge-config.md`](edge-config.md) for how that works and how to
review a change with `--dry-run` before it ships.

The installer handles all of what used to be a manual playbook here: the
`libnginx-mod-http-image-filter` package, `/var/cache/nginx/art`, copying
`cinemaslime-art-cache.conf` into `/etc/nginx/conf.d/`, and `include`ing
`cinemaslime-art-location.conf` from a managed marker block placed immediately
before `location / {` — which is the ordering the section above says is
load-bearing, and which is exactly what a human forgot.

The rollout-order rule from ADR 0013 decision 10 is now enforced rather than
documented: the workflow installs the nginx config, then runs `npm run
verify:edge` as a **gate**, and only cuts over `dist/` if the server already
honours the contract. A client shipped ahead of its server can no longer happen.

> **This config was missing from the box entirely until 2026-07-25.** Every
> `/api/art/` request 404'd site-wide and nothing surfaced it, because the client
> degrades to a dark placeholder. That is the failure the CI installer and
> `verify:edge` exist to make impossible.

### Break glass

Emergency-only manual steps (CI down, site down) live in
[`edge-config.md`](edge-config.md#break-glass-emergency-only), including how to
roll back to a timestamped backup. Anything done by hand is overwritten by the
next deploy — by design. To confirm the module actually loaded:

```sh
ssh -i "$KEY" root@161.35.188.75 'nginx -V 2>&1 | tr " " "\n" | grep -i image; ls /etc/nginx/modules-enabled/'
```

## Verify

Pick any real Episode artwork path from the feed, then:

```sh
P=staging/podcast_uploaded_nologo/43698817/43698817-1757516582372-2a574ca9eaf8e.jpg

# First request resizes: expect 200, image/jpeg, X-Cache-Status: MISS
curl -sI "https://cinemaslime.com/api/art/160/$P" | grep -iE 'http/|content-type|content-length|cache-control|x-cache-status'

# Second request is served from disk: expect X-Cache-Status: HIT
curl -sI "https://cinemaslime.com/api/art/160/$P" | grep -i x-cache-status

# And it must actually be smaller than the original (~2.4 MB vs ~12 KB).
curl -sI "https://d3t3ozftmdmh3i.cloudfront.net/$P" | grep -i content-length
```

Expected: `content-type: image/jpeg`, `cache-control: public, max-age=31536000,
immutable`, `X-Cache-Status: MISS` then `HIT`, and a `content-length` in the tens
of kilobytes rather than the millions.

### The width allowlist is the security boundary

```sh
curl -so /dev/null -w '%{http_code}\n' "https://cinemaslime.com/api/art/3000/$P"  # -> 404
curl -so /dev/null -w '%{http_code}\n' "https://cinemaslime.com/api/art/161/$P"   # -> 404
curl -so /dev/null -w '%{http_code}\n' "https://cinemaslime.com/api/art/abc/$P"   # -> 404
curl -so /dev/null -w '%{http_code}\n' "https://cinemaslime.com/api/art/160/"     # -> 404
```

Each must be a 404 and must **not** produce a resize. There is no way to point
the endpoint at another host: the upstream is hardcoded in the config and never
read from the request.

### The resize tier is not reachable from outside

```sh
curl -so /dev/null -w '%{http_code}\n' "https://cinemaslime.com/_art/160/$P"       # -> 404 (internal)
curl -so /dev/null -w '%{http_code}\n' "https://cinemaslime.com/_art_resize/160/$P" # -> SPA/404, never an image
```

The resize server listens on `127.0.0.1:8081` only, so it is not addressable from
the internet at all.

## Warm the cache after every deploy

```sh
npm run warm:artwork
```

Requests every current Episode's artwork at all three rungs against the live
site, so real visitors essentially never pay a resize. It is a plain GET loop —
no SSH, no secrets, safe to re-run; a warm cache just reports `HIT`s. Takes a
target as an argument if you need to warm somewhere else:
`node scripts/warm-artwork-cache.mjs https://staging.example.com`.

When a new Episode is published between deploys, exactly one visitor pays one
resize of one image before it is cached for everyone else. Nothing scheduled is
required — `inactive=365d` means nothing is evicted for going idle.

## Verify the contract automatically

```sh
npm run verify:edge
```

Runs every check on this page — and the equivalents for `/api/rss` and
`/api/essays/*` — as an exit-code. It asserts the *kind* of thing each path
returns, not just the status: `image/*` under 25 % of the CloudFront original
(measured by HEAD per run), `X-Cache-Status` present, every off-ladder width a
404 that is never an image, and `image_filter_buffer` — parsed straight out of
`cinemaslime-art-cache.conf` — clearing the largest measured source with 40 %
headroom. Takes a target as an argument like `warm:artwork` does.

Run it after any nginx change and after any deploy. See
`docs/deploy/edge-contract.md`; the assertions live in `src/edge-contract.js`
and are unit-tested in `src/edge-contract.test.js`.

## Growth

Total reel bytes scale with catalogue size; this is deliberate, not a ceiling
that was forgotten. At 70 Episodes the reel transfers under 1 MB. At roughly 400
Episodes on a 2560×1200 viewport it would approach ~5 MB. Capping how much of the
catalogue appears was explicitly rejected — the reel showing the whole back
catalogue is the point.

Disk: ~210 cached derivatives today. `max_size=1g` bounds it; `keys_zone=1m`
holds ~8,000 keys, so the RAM side has years of headroom.
