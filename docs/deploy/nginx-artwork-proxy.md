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

## Config (committed)

- `deploy/nginx/cinemaslime-art-cache.conf` — the `proxy_cache_path` zone **and**
  the loopback resize `server{}`. Both belong in the `http{}` context; install
  into `/etc/nginx/conf.d/`.
- `deploy/nginx/cinemaslime-art-location.conf` — the three `location` blocks.
  Paste inside the HTTPS `server{}` for cinemaslime.com.

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

- `image_filter_buffer 6M` — the 1 MB default rejects our ~2.2 MB sources
  outright with 415. Note the GD-side memory this implies: a 3000×3000 truecolor
  decode is ~34 MB of bitmap per in-flight resize, before the resized copy and
  the re-encode. Budget concurrency accordingly; the cache is what keeps
  concurrency near zero in practice.
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

Ship this **before** the client code. A client deployed first would 404 every
artwork request, because the server would not yet understand the URL shape.

```sh
KEY=~/.ssh/id_ed25519_cinemaslime_droplet
SITE=/etc/nginx/sites-available/cinemaslime.com

# 1. The image-filter module (standard distro package; it installs its own
#    load_module line into /etc/nginx/modules-enabled/).
ssh -i "$KEY" root@161.35.188.75 'apt-get update && apt-get install -y libnginx-mod-http-image-filter'

# 2. Cache zone + loopback resize server (http context) + cache dir
scp -i "$KEY" deploy/nginx/cinemaslime-art-cache.conf \
    root@161.35.188.75:/etc/nginx/conf.d/cinemaslime-art-cache.conf
ssh -i "$KEY" root@161.35.188.75 'mkdir -p /var/cache/nginx/art'

# 3. Add the location blocks inside the HTTPS server{} (just before `location /`).
#    Edit $SITE on the box and paste deploy/nginx/cinemaslime-art-location.conf.

# 4. Validate + reload
ssh -i "$KEY" root@161.35.188.75 'nginx -t && systemctl reload nginx'
```

Confirm the module actually loaded:

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

## Growth

Total reel bytes scale with catalogue size; this is deliberate, not a ceiling
that was forgotten. At 70 Episodes the reel transfers under 1 MB. At roughly 400
Episodes on a 2560×1200 viewport it would approach ~5 MB. Capping how much of the
catalogue appears was explicitly rejected — the reel showing the whole back
catalogue is the point.

Disk: ~210 cached derivatives today. `max_size=1g` bounds it; `keys_zone=1m`
holds ~8,000 keys, so the RAM side has years of headroom.
