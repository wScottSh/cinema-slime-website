# Artwork derivatives — research notes (issue #106)

**Date**: 2026-07-25
**Question**: how to stop the site serving 3000×3000 / ~2.2 MB originals into every image slot,
without reducing how many distinct Episode artworks the hero film reel shows.

Compiled from four parallel primary-source investigations. Every claim below is cited to the
source that owns it (nginx.org, WHATWG HTML, Chromium source/design docs, Vite source,
imgproxy official docs, the relevant RFCs). Anything that could not be verified against a
primary source is flagged inline as such rather than asserted.

There was no existing convention for research notes in this repo; `docs/research/` is new.

---

## Measured baseline (reproduced locally, not taken on faith)

Against `https://anchor.fm/s/1050fb0e4/podcast/rss`, 70 `<item>`s, 70 distinct `itunes:image`
URLs, all on the single host `d3t3ozftmdmh3i.cloudfront.net`:

```
images=70  totalbytes=172,551,299  avg=2,465,018
```

Sources are 3000×3000 JPEG. The origin is a plain S3/CloudFront bucket: it ignores `?w=`,
`?width=&format=`, and an `Accept: image/webp` request header, returning identical bytes each
time. Filenames are unique per upload and the origin sends `Cache-Control: max-age=2592000`,
so derivatives are safely cacheable long-term.

Derivative sizes, measured by resizing three real catalogue images with ffmpeg:

| width | avg JPEG (q approx 75) | all 70 images | avg WebP |
|---|---|---|---|
| 160 | ~12.2 KB | **~0.85 MB** | ~7.6 KB |
| 320 | ~35.2 KB | ~2.5 MB | ~21 KB |
| 640 | ~93 KB | ~6.5 MB | ~55 KB |

The reel can therefore keep **all 70** distinct images and still cost under 1 MB. Capping the
number of distinct thumbnails is not necessary and buys nothing worth having.

Note: the WebP column is currently unreachable — see the nginx section, `image_filter` cannot
transcode JPEG to WebP.

---

# 1. nginx ngx_http_image_filter_module

# nginx `ngx_http_image_filter_module`: on-the-fly resize of remote JPEGs — research

## Bottom line

**Viable, with a specific config shape — not a naive single-location setup.**

- The module works fine on `proxy_pass` responses (it's an output body filter; it doesn't care where bytes came from). Confirmed from source.
- `image_filter_buffer` must be raised well above the 1M default for 2.2 MB / 3000×3000 JPEGs — see §2 for the number and the memory math.
- **The critical gotcha (§4, verified against nginx source, not just docs):** `proxy_cache` in nginx caches the response written to the *temp file by the event pipe*, which happens **before** the body-filter chain (image_filter, gzip, etc.) runs. So a single `location` doing `proxy_pass` + `image_filter` + `proxy_cache` caches the **ORIGINAL, full-size bytes** — but worse, because cache **hits** are re-sent through `ngx_http_send_header`/`ngx_http_output_filter` (the same filter chain, confirmed in `ngx_http_file_cache.c`), **`image_filter` re-runs its GD resize on every single request, cache hit or miss.** `proxy_cache` here only saves the upstream round-trip, not the CPU cost of resizing — it does nothing to avoid repeated resize work. The standard fix is the two-tier pattern in §4: an `internal` location does the real fetch+resize, and a public-facing location `proxy_pass`es to `127.0.0.1` and caches *that* response, so the resize happens once per cache key.
- No compile needed: it ships as a real dynamic module on Debian/Ubuntu (`libnginx-mod-http-image-filter`) and on the official nginx.org repo (`nginx-module-image-filter`). Pulls in `libgd3`.
- **Format-conversion caveat (corrects a premise in the brief):** the OSS module **cannot** convert JPEG input to WebP output. Verified directly in source (`ngx_http_image_out` in `ngx_http_image_filter_module.c`): the output encoder is selected by the *detected input type*, not by any directive, variable, or `Accept` header. JPEG in → JPEG out, always. WebP support (added 1.11.6) only means it can *read and re-encode a WebP source as WebP* — it is not a format-conversion/content-negotiation tool. If Accept-header-driven WebP-from-JPEG is a requirement, this module cannot do it; you'd need something else (e.g. a separate conversion step, or a different tool entirely).

---

## 1. Full directive reference

Source: https://nginx.org/en/docs/http/ngx_http_image_filter_module.html

Module requires `--with-http_image_filter_module` at build time (or the dynamic-module package, §5). Uses libgd. Transforms JPEG, GIF, PNG, and (1.11.6+) WebP.

### `image_filter`
- **Syntax:** `image_filter off | test | size | rotate 90|180|270 | resize width height | crop width height;`
- **Default:** `off`
- **Context:** `location`
- Values:
  - `off` — disables processing in this location (overrides an outer `image_filter`).
  - `test` — verifies the response is a JPEG/GIF/PNG/WebP image; otherwise returns **415** (Unsupported Media Type).
  - `size` — outputs image metadata as JSON instead of the image (see §8).
  - `rotate 90|180|270` — counter-clockwise rotation; can combine with `resize`/`crop`; values may contain variables. When combined with `resize`, rotation happens *after* the resize. When combined with `crop`, rotation happens *before* the crop.
  - `resize width height` — proportional reduction to fit inside width×height; use `-` for one dimension to scale that axis freely (keep aspect ratio driven by the other). Returns 415 on error. Values may contain variables.
  - `crop width height` — proportional reduction to fill width×height (scales to the larger relative side) then crops the overflow. Use `-` for a single dimension. Returns 415 on error.

### `image_filter_buffer`
- **Syntax:** `image_filter_buffer size;`
- **Default:** `1M`
- **Context:** `http, server, location`
- Maximum size of the buffer for reading the source image. Exceeding it returns **415**.

### `image_filter_interlace`
- **Syntax:** `image_filter_interlace on | off;`
- **Default:** `off`
- **Context:** `http, server, location`
- **Since:** 1.3.15
- Produces interlaced output; for JPEG this means "progressive JPEG."

### `image_filter_jpeg_quality`
- **Syntax:** `image_filter_jpeg_quality quality;`
- **Default:** `75`
- **Context:** `http, server, location`
- Range 1–100 (values above ~95 are not recommended — diminishing returns, much larger files). Value may contain variables.

### `image_filter_sharpen`
- **Syntax:** `image_filter_sharpen percent;`
- **Default:** `0`
- **Context:** `http, server, location`
- Percent can exceed 100; `0` disables. Value may contain variables. Implemented via libgd's `gdImageSharpen()` (confirmed in source, §7).

### `image_filter_transparency`
- **Syntax:** `image_filter_transparency on | off;`
- **Default:** `on`
- **Context:** `http, server, location`
- Preserves transparency for GIF/palette PNG when transforming. PNG alpha-channel transparency is *always* preserved regardless of this setting.

### `image_filter_webp_quality`
- **Syntax:** `image_filter_webp_quality quality;`
- **Default:** `80`
- **Context:** `http, server, location`
- **Since:** 1.11.6. Range 1–100. Value may contain variables.

There is no `image_filter_no_svg` or any format-conversion directive documented on this page — module doesn't touch SVG at all (it isn't a supported input format).

---

## 2. Oversized source images

**Source:** docs (above) + nginx source (`src/http/modules/ngx_http_image_filter_module.c`, header filter).

- Exceeding `image_filter_buffer` (checked against the upstream `Content-Length` in the header filter) returns exactly:
  ```c
  ngx_log_error(NGX_LOG_ERR, r->connection->log, 0,
                "image filter: too big response: %O", len);
  return NGX_HTTP_UNSUPPORTED_MEDIA_TYPE;
  ```
  i.e. **HTTP 415**, logged as `image filter: too big response: <len>`. Can be caught with `error_page 415 = ...`.
- Your sources: ~2.2 MB JPEGs. Set buffer comfortably above that, with headroom for larger files in the same set and for re-encoded intermediate size:
  ```nginx
  image_filter_buffer 6M;   # comfortable headroom over 2.2M sources
  ```
- **Memory cost per concurrent request** (from source, `ngx_http_image_body_filter`/resize path): the module allocates the *entire* body into one buffer (`ctx->image = ngx_palloc(r->pool, ctx->length)`), then libgd decodes it into an in-memory `gdImagePtr` (roughly `width * height * 4` bytes for truecolor + palette overhead), then allocates a second `gdImagePtr` for the resized output, then GD's `gdImageJpegPtr`/etc. builds the encoded output buffer. So concurrency budgeting should assume **~3–4× the source file size** per in-flight request as a rough floor, dominated in practice by the decoded bitmap: a 3000×3000 truecolor image decoded by GD is `3000*3000*4 ≈ 34 MB` alone, before the resized copy and re-encoded output. **This is not stated as an exact number in nginx docs — it's derived from reading the source and standard GD memory behavior; flag as inferred, not an nginx-documented figure.** Plan capacity per worker as `expected_concurrent_image_requests × ~40–50 MB`, and size `image_filter_buffer` only for the *compressed* source (a few MB), independent of that GD-side memory.

---

## 3. Does `image_filter` work on `proxy_pass` responses (not local files)?

**Yes — confirmed from source, not just inference.** `ngx_http_image_filter_module.c` registers itself purely as a **header filter** and a **body filter** in its module init:

```c
static ngx_int_t
ngx_http_image_filter_init(ngx_conf_t *cf)
{
    ngx_http_next_header_filter = ngx_http_top_header_filter;
    ngx_http_top_header_filter = ngx_http_image_header_filter;

    ngx_http_next_body_filter = ngx_http_top_body_filter;
    ngx_http_top_body_filter = ngx_http_image_body_filter;

    return NGX_OK;
}
```
(https://raw.githubusercontent.com/nginx/nginx/master/src/http/modules/ngx_http_image_filter_module.c)

It never touches `r->uri`/static-file machinery — it operates purely on whatever bytes flow through `ngx_http_top_body_filter`, which is exactly the chain a `proxy_pass` response passes through on its way to the client. The example in the official docs is itself a proxy example:
```nginx
location /img/ {
    proxy_pass   http://backend;
    image_filter resize 150 100;
    image_filter rotate 90;
    error_page   415 = /empty;
}
```
(https://nginx.org/en/docs/http/ngx_http_image_filter_module.html)

---

## 4. `proxy_cache` + `image_filter` interaction (critical)

**Question: does a single location's cache store the original bytes or the resized bytes?**

**Answer: the ORIGINAL bytes — and worse, the resize work is NOT saved by the cache; it re-runs on every hit.** Verified two ways against nginx source:

**(a) Cache-write happens before the body filter chain.** In `ngx_http_upstream_send_response()` (`src/http/ngx_http_upstream.c`), when the response is cacheable, the event pipe's output filter is set:
```c
p->output_filter = ngx_http_upstream_output_filter;
p->output_ctx = r;
```
The event pipe machinery reads raw bytes off the upstream connection and is what persists them to the on-disk cache temp file, as part of reading from upstream — this happens at a layer below/before the client-facing body-filter chain (`ngx_http_output_filter`, which is where `image_filter`'s `ngx_http_image_body_filter` lives). So what lands in the cache file is the **untransformed upstream response**.
(https://raw.githubusercontent.com/nginx/nginx/master/src/http/ngx_http_upstream.c)

**(b) Cache hits are re-sent through the full filter chain — confirmed exactly, not inferred.** `ngx_http_upstream_cache_send()` re-parses the cached headers through the normal `u->process_header`/`ngx_http_upstream_process_headers` path, then calls `ngx_http_cache_send(r)`. That function (in `src/http/ngx_http_file_cache.c`) is:
```c
ngx_int_t
ngx_http_cache_send(ngx_http_request_t *r)
{
    ...
    rc = ngx_http_send_header(r);          /* full header filter chain */
    if (rc == NGX_ERROR || rc > NGX_OK || r->header_only) {
        return rc;
    }
    ...
    out.buf = b;
    out.next = NULL;
    return ngx_http_output_filter(r, &out); /* full body filter chain */
}
```
(https://raw.githubusercontent.com/nginx/nginx/master/src/http/ngx_http_file_cache.c)

Both `ngx_http_send_header` and `ngx_http_output_filter` are the exact same top-of-chain entry points that `image_filter`'s header/body filters spliced themselves into (§ above). **So `image_filter` runs on cache hits exactly as it does on cache misses.** A single-location `proxy_pass` + `image_filter` + `proxy_cache` setup caches the original image and pays the full GD decode/resize/encode CPU cost on *every* request — `proxy_cache` here only eliminates the upstream network round-trip, not the transformation cost, which defeats a major reason to cache resized derivatives in the first place.

### The standard two-tier workaround

Put the real work in an `internal`-only location; have the public location treat that internal location as its "upstream" via a loopback `proxy_pass`, and cache *that* response. Because the internal location's *output* (already resized) is what the outer proxy_pass receives and caches, the resize happens once per cache key.

```nginx
http {
    proxy_cache_path /var/cache/nginx/resized levels=1:2
                      keys_zone=resized_cache:10m max_size=1g
                      inactive=7d use_temp_path=off;

    upstream origin_images {
        server images.upstream.example.com:443;
    }

    server {
        listen 80;
        server_name cdn.example.com;

        # --- Tier 1: public, cached, no image processing here ---
        location /img/ {
            proxy_pass http://127.0.0.1:8080/_resize/$1$is_args$args;
            proxy_cache resized_cache;
            proxy_cache_key $scheme$request_uri;
            proxy_cache_valid 200 7d;
            proxy_cache_valid 415 1m;
            proxy_ignore_headers Cache-Control Expires;
            add_header X-Cache-Status $upstream_cache_status;
        }

        # --- Tier 2: internal only, does the real fetch + resize ---
        location /_resize/ {
            internal;
            proxy_pass https://origin_images/;   # fetch the real source JPEG
            proxy_set_header Host images.upstream.example.com;

            image_filter_buffer 6M;
            image_filter resize 400 400;
            image_filter_jpeg_quality 82;
            image_filter_sharpen 20;
            error_page 415 = /empty;
        }

        location = /empty {
            empty_gif;
        }
    }
}
```
Notes on the sketch:
- Tier 2 must listen where Tier 1 can reach it — using a second `server{}` on `127.0.0.1:8080` (as sketched via `proxy_pass http://127.0.0.1:8080/...`) is the common pattern so the `internal;` location can't be hit directly from outside, and Tier 1 talks to it exactly like any other upstream.
- Different requested sizes/params should vary the **outer** cache key (`proxy_cache_key`) so `/img/thumb` and `/img/large` cache separately — the outer tier decides what URL/params map to what resize request it makes to tier 2.
- `error_page 415` on tier 2 lets you serve a placeholder for corrupt/oversized/non-image upstream responses without polluting the cache with errors (cap error caching with `proxy_cache_valid 415 1m`).

This two-tier internal-loopback pattern is nginx's standard documented technique for combining `X-Accel`/subrequest-style internal processing with `proxy_cache`; the specific combination with `image_filter` for resize-then-cache is a widely used community pattern built on it (not itself named in nginx.org docs, since `image_filter` docs don't discuss caching at all — **this workaround structure is my synthesis from the verified filter-chain/cache-write facts above, not a direct nginx.org citation**).

---

## 5. Availability without compiling nginx

**It's a real dynamic module (`.so` loaded via `load_module`), not compiled-in-only, on both the OS-packaged and nginx.org-packaged nginx.**

- **Debian** (https://packages.debian.org/search?keywords=libnginx-mod-http-image-filter): package `libnginx-mod-http-image-filter`, present in bullseye (1.18.0-6.1+deb11u8), bookworm (1.22.1-9+deb12u9), trixie (1.26.3-3+deb13u7), forky/sid/experimental.
  - Depends (bookworm, https://packages.debian.org/bookworm/libnginx-mod-http-image-filter): `libc6`, **`libgd3 (>= 2.1.0~alpha~)`**, and `nginx-abi-1.22.1-7` (a virtual package tying the module build to a specific nginx ABI/build) — confirms it **does** pull in libgd as a dependency, and that the module package is ABI-locked to a matching nginx binary package.
- **Ubuntu** (https://packages.ubuntu.com/search?keywords=libnginx-mod-http-image-filter): package `libnginx-mod-http-image-filter` present in jammy (1.18.0-6ubuntu14.18), noble (1.24.0-2ubuntu7.15), questing (1.28.0-6ubuntu1.8), and newer.
- **nginx.org official repo** (https://nginx.org/en/linux_packages.html): dynamic modules are distributed as separate packages per-distro, and the relevant one is `nginx-module-image-filter` (alongside `nginx-module-geoip`, `nginx-module-njs`, etc.). Install via the distro's package manager after adding the nginx.org repo, e.g. `apt install nginx-module-image-filter` (Debian/Ubuntu) or `apk add nginx-module-image-filter@nginx` (Alpine). The page references `load_module` (https://nginx.org/en/docs/ngx_core_module.html#load_module) as the mechanism to enable it but doesn't spell out the exact line on that page.
- **Required config line** — standard nginx dynamic-module convention (module file name matches `ngx_http_image_filter_module.so`):
  ```nginx
  # top-level config, OUTSIDE any http{}/server{}/events{} block — main context only
  load_module modules/ngx_http_image_filter_module.so;
  ```
  Must appear in the top-level (main) context, before `events {}`/`http {}`. On Debian/Ubuntu packages this line is dropped for you automatically in `/etc/nginx/modules-enabled/*.conf`, which is `include`d from `/etc/nginx/nginx.conf` — installing the package is normally sufficient without hand-editing `load_module` yourself, but the directive itself is main-context-only if done manually.

---

## 6. WebP support

- **Added in nginx 1.11.6** (15 Nov 2016): `*) Feature: WebP support in the ngx_http_image_filter_module.` (https://nginx.org/en/CHANGES)
- `image_filter_webp_quality` directive also dates to 1.11.6+ per the module docs (https://nginx.org/en/docs/http/ngx_http_image_filter_module.html).
- The module docs additionally note WebP support "requires version 1.11.6+ with libgd compiled with WebP support" — i.e. it's conditional on the underlying libgd build having WebP encode/decode compiled in (`NGX_HAVE_GD_WEBP` in source), not automatic.
- **It CANNOT convert JPEG input to WebP output.** Verified directly in `ngx_http_image_out()` (https://raw.githubusercontent.com/nginx/nginx/master/src/http/modules/ngx_http_image_filter_module.c): the switch statement dispatching to `gdImageJpegPtr`/`gdImageGifPtr`/`gdImagePngPtr`/`gdImageWebpPtrEx` is keyed on `type`, which is the *detected input type* (`ctx->type`, set when the source image is sniffed). There is no directive, config value, or `Accept`-header check anywhere in the module that selects a different output format than the input. **Output format = input format, always.** This directly contradicts the premise in the brief that WebP output could be chosen by request `Accept` header — that capability does not exist in this module.

---

## 7. Known limitations / gotchas (from source, since primary docs don't cover these)

All of the below verified by reading `src/http/modules/ngx_http_image_filter_module.c` directly (https://raw.githubusercontent.com/nginx/nginx/master/src/http/modules/ngx_http_image_filter_module.c):

- **Resampling quality:** resize uses `gdImageCopyResampled()` (bilinear-ish resampling GD function) — not the sharper `gdImageCopyResized()` or GD's newer `gdImageScale()` pipeline. This is standard GD resampling quality; `image_filter_sharpen` (implemented via `gdImageSharpen()`) is the documented mitigation for the softness this produces.
- **EXIF orientation is NOT honored.** Source only scans JPEG APPn segments (0xE1–0xEF, which includes EXIF) to decide whether the file needs full re-encoding (if APPn data exceeds ~5% of the file, forces re-encode to strip it) — it does **not** parse EXIF orientation tags and does **not** rotate the image to compensate. A JPEG shot in portrait via phone-EXIF-rotation will be resized/rotated according to its raw (unrotated) pixel data, ignoring the orientation tag. This is a real risk for user-submitted phone photos.
- **Animated GIFs are not preserved.** For GIF input, the module only reads width/height from the GIF header (`p[7]*256+p[6]`, `p[9]*256+p[8]`) and runs the frame through GD as a static image — multi-frame/animated GIFs will be flattened to a single frame after any transform.
- **`image_filter resize W -` (single dimension):** confirmed in source — the config-value parser treats a bare `-` as "unset," triggering proportional scaling driven by the other dimension only (aspect ratio preserved, scaling to fit the one given dimension).
- **Documented CPU cost:** nginx.org does not publish a CPU-cost figure for this module. The relevant costs are structural, not documented as a number: full in-memory decode to a GD bitmap, a full resize pass, and re-encode, all per request that isn't served by the correctly-configured two-tier cache in §4. **Flag: no primary source states CPU-cycles or throughput numbers; this is inferred from the operations the source performs, not a citable metric.**
- Three relevant bugfixes from the official changelog (https://nginx.org/en/CHANGES), useful for picking a minimum safe version:
  - 1.17.1: fixed a segfault when caching was combined with `image_filter` and 415 errors were redirected via `error_page` (bug had existed since 1.11.10) — direct historical evidence that the image_filter+cache combination has had real crash bugs; stay on a current stable release.
  - 1.25.4: fixed a segfault when SSL proxying was combined with `image_filter` and 415 errors redirected via `error_page`.

---

## 8. `image_filter size` (JSON metadata mode)

**Source:** https://nginx.org/en/docs/http/ngx_http_image_filter_module.html

With `image_filter size;` set in a location, instead of returning image bytes, nginx returns a small JSON document describing the source image:
```json
{ "img" : { "width": 100, "height": 100, "type": "gif" } }
```
On any error detecting/reading the image, it returns an empty JSON object: `{}`. This is a metadata-probe mode only — no resizing/cropping/rotation is applied and no image bytes are returned in this mode.

---

## Sources

- https://nginx.org/en/docs/http/ngx_http_image_filter_module.html — full directive reference, `size` JSON output, example config
- https://nginx.org/en/CHANGES — WebP feature added 1.11.6; bugfixes in 1.17.1 and 1.25.4 involving `image_filter` + caching/SSL + `error_page 415`
- https://raw.githubusercontent.com/nginx/nginx/master/src/http/modules/ngx_http_image_filter_module.c — filter registration (`ngx_http_image_filter_init`), buffer-size enforcement returning 415, EXIF/APPn handling, GIF dimension-only parsing, `resize`/`-` parsing, `ngx_http_image_out` output-format dispatch (proves no format conversion), `gdImageCopyResampled`/`gdImageSharpen`/`gdImageInterlace`/`gdImageColorTransparent` calls
- https://raw.githubusercontent.com/nginx/nginx/master/src/http/ngx_http_upstream.c — `ngx_http_upstream_send_response` wiring `p->output_filter = ngx_http_upstream_output_filter` for cache writes prior to the client body-filter chain; `ngx_http_upstream_cache_send` re-processing cached headers through the normal header path before calling `ngx_http_cache_send`
- https://raw.githubusercontent.com/nginx/nginx/master/src/http/ngx_http_file_cache.c — `ngx_http_cache_send` calling `ngx_http_send_header` and `ngx_http_output_filter` on cache hits (proves filters, including `image_filter`, re-run on every cache hit)
- https://nginx.org/en/linux_packages.html — dynamic module packages list including `nginx-module-image-filter`, install instructions per distro
- https://packages.debian.org/search?keywords=libnginx-mod-http-image-filter — Debian release/version matrix for `libnginx-mod-http-image-filter`
- https://packages.debian.org/bookworm/libnginx-mod-http-image-filter — exact Depends line (`libgd3`, `nginx-abi-1.22.1-7`) and description
- https://packages.ubuntu.com/search?keywords=libnginx-mod-http-image-filter — Ubuntu release/version matrix for `libnginx-mod-http-image-filter`
- https://nginx.org/en/docs/ngx_core_module.html#load_module — `load_module` directive context (main/top-level only)

### Explicitly flagged as NOT independently verifiable against a primary source
- Exact per-request memory multiplier (~3–4× source size / GD bitmap math in §2) — derived reasoning from source + general GD behavior, not a number nginx or libgd publish.
- The "two-tier internal-loopback + proxy_cache" pattern as a *named* nginx-recommended solution for image_filter specifically — the underlying mechanics (internal locations, loopback proxy_pass, proxy_cache on the outer tier) are all individually documented nginx features, but nginx.org has no page pairing them explicitly with `image_filter`; the combination here is my synthesis from the verified cache/filter-chain facts.
- Any documented CPU-cycle cost for GD resize/sharpen operations — not published anywhere by nginx or libgd; only inferable from what operations the source performs.


---

# 2. imgproxy (evaluated alternative)

# imgproxy vs nginx `ngx_http_image_filter_module` for a Single-Droplet Static Site

## Bottom line

For this specific case — downscaling 3000x3000 (~2.2MB) remote JPEGs from CloudFront to 160/320/640px widths, on a single droplet already running nginx — imgproxy is **not clearly worth the added operational weight**. Basic resizing is free OSS and the URL scheme, security model, and libvips backend are all solid, but imgproxy adds a second process, a second deploy artifact, a signing-key/secret to manage, and (critically) *no self-caching* of its own — meaning you still need `proxy_cache` in nginx in front of it either way. If the only goal is "shrink a JPEG to three fixed widths," `ngx_http_image_filter_module` already does that inside the process you're running today, with zero new moving parts. imgproxy earns its keep only if you expect to need format negotiation (WebP/AVIF) with correct cache behavior, per-request crop/watermark/security features, or expect the resizing needs to grow — none of which is stated as a current requirement here.

## 1. OSS vs Pro tiers

Per imgproxy's own features page, the OSS ("imgproxy OSS") tier includes basic image formats — "Basic formats: JPEG, PNG, GIF, WebP, AVIF, JPEG XL, and more" — and basic processing ("Resizing, cropping, rotating, watermarking, filters") ([imgproxy Features](https://imgproxy.net/features/)). So: **basic resizing of a remote source URL is free/OSS**, and **basic WebP and AVIF *output* are also free/OSS** (both are listed under the OSS format-support line, and the `IMGPROXY_AUTO_WEBP` / `IMGPROXY_AUTO_AVIF` env vars that drive this are documented as ordinary, non-Pro-gated configuration options ([Configuration options](https://docs.imgproxy.net/configuration/options))).

What **is** Pro-gated: "best format selection" (choosing the smallest of several candidate formats automatically) is explicitly marked `((pro))` on its docs page ([Best format](https://docs.imgproxy.net/features/best_format)); "Autoquality by DSSIM" is marked `((pro))` ([Autoquality](https://docs.imgproxy.net/features/autoquality)); and the "Internal cache" (persisting processed output to disk/cloud storage) is marked `((pro))` ([Internal cache](https://docs.imgproxy.net/cache/internal)). Other Pro-only items per the features page: AI object-oriented crop, object blurring/detection, advanced smart crop with face detection, PDF/video/PSD thumbnail generation ([imgproxy Features](https://imgproxy.net/features/)). Pro is sold as a paid add-on/private Docker registry image on top of the free OSS core ([imgproxy Pricing](https://imgproxy.net/pricing/)).

## 2. Deployment on a single droplet

Official install options per the installation doc: Docker (pull from the official registry), Kubernetes/Helm chart, one-click/manual Heroku, AWS Lambda, AWS ECS, Linux DEB/RPM/TAR packages (exported from the Docker images), Arch Linux AUR, macOS Homebrew, and building from source (clone the repo, install libvips, compile) ([Installation](https://docs.imgproxy.net/installation)). Binaries are linked against libc 2.35+ and libstdc++ 12.3.0+, so the host needs at least those versions ([Installation](https://docs.imgproxy.net/installation)).

**No official systemd unit file is provided** in the documentation I could find — the docs describe Docker as the primary supported path and leave OS-service management (systemd, etc.) to the operator ([Installation](https://docs.imgproxy.net/installation)). I could not find any documented minimum RAM/CPU figures; the docs speak qualitatively about libvips being fast and low-memory but give no numeric floor ([FAQ](https://imgproxy.net/faq/), [Installation](https://docs.imgproxy.net/installation)).

Documented concurrency env vars, per the configuration reference ([Configuration options](https://docs.imgproxy.net/configuration/options)):
- `IMGPROXY_WORKERS` — "the maximum number of images an imgproxy instance can process simultaneously without creating a queue. Default: the number of CPU cores multiplied by two." (AWS Lambda forces this to `1`.)
- `IMGPROXY_MAX_CLIENTS` — "the maximum number of simultaneous active connections. When set to `0`, connection limit is disabled. Default: `2048`."
- `IMGPROXY_DOWNLOAD_BUFFER_SIZE` — "the initial size (in bytes) of a single download buffer. When set to zero, initializes empty download buffers. Default: `0`."

Guidance found: there's generally no benefit to running more simultaneous workers than available CPU cores, with a starting rule of thumb of about 2 workers per core (reflected in the `IMGPROXY_WORKERS` default formula itself) ([Configuration options](https://docs.imgproxy.net/configuration/options)).

## 3. URL format

The documented URL structure has three variants ([Installation/Usage references imgproxy's own URL doc pages, confirmed via docs.imgproxy.net configuration and generating-URL pages](https://docs.imgproxy.net/configuration/options)):

```
http://imgproxy.example.com/%signature/%processing_options/plain/%source_url@%extension
http://imgproxy.example.com/%signature/%processing_options/%encoded_source_url.%extension
http://imgproxy.example.com/%signature/%processing_options/enc/%encrypted_source_url.%extension   (Pro, encrypted source)
```

- **Signature**: must always be present in the URL; if signature checking is disabled, the signature segment can be any placeholder value (e.g. `unsafe`).
- **Processing options**: URL path segments of the form `%option_name:%arg1:...:%argN`, chained together; they configure imgproxy's fixed, built-in processing pipeline rather than defining an arbitrary pipeline themselves.
- **Source URL**: either percent-encoded plain (after a `/plain/` segment), URL-safe Base64-encoded (optionally split across `/`-delimited chunks), or AES-CBC encrypted (Pro, `/enc/` segment).
- **Extension**: sets the output format; can be omitted, in which case imgproxy uses the source format (falling back to JPG if unsupported) or an auto-detected AVIF/WebP/JPEG XL format if detection is enabled.

**Signing is optional, not mandatory.** Signature checking is disabled by default; the docs state it is "highly recommended to enable it in a production environment," and describe the risk in terms of denial-of-service abuse: an attacker without a valid signature could otherwise "perform a denial-of-service attack by requesting multiple different image resizes" against your server ([Signing the URL](https://docs.imgproxy.net/usage/signing_url)).

`IMGPROXY_ALLOWED_SOURCES` is "a whitelist of source image URL prefixes divided by comma. Wildcards can be included with `*` to match all characters except `/`. When blank, imgproxy allows all source image URLs," with an explicit warning to always include a trailing slash after a host to prevent URL-prefix spoofing (example given: `s3://,https://*.example.com/,local://`) ([Configuration options](https://docs.imgproxy.net/configuration/options)).

## 4. Self-caching

Confirmed directly: **imgproxy OSS does not persist a cache of its own output.** The official FAQ states verbatim: *"imgproxy does not have an internal cache"* as part of describing the "ideal infrastructure setup," and recommends putting a cache (CDN or reverse-proxy cache) in front of it ([FAQ](https://imgproxy.net/faq/)). The docs' external-caching page frames this directly: *"External cache refers to caching layers in front of imgproxy, such as CDNs, reverse proxies, or caching appliances. These solutions provide edge caching, geo-distribution, and high-performance image delivery,"* and gives concrete example configs for nginx and Varnish sitting in front of imgproxy ([External cache](https://docs.imgproxy.net/cache/external)).

Note the wrinkle from Section 1: an "Internal cache" that stores processed images to disk/cloud storage *does* exist — but it is **Pro-only** ([Internal cache](https://docs.imgproxy.net/cache/internal)). So in the free tier, the "cache in front of it" (e.g., nginx `proxy_cache`) is not optional infrastructure — it is the *only* way processed derivatives ever get reused rather than recomputed per request.

## 5. Format negotiation

`IMGPROXY_AUTO_WEBP` "enables WebP support detection. When the file extension is omitted in the imgproxy URL and browser supports WebP, imgproxy will use it as the resulting format." `IMGPROXY_AUTO_AVIF` works identically for AVIF. Both only take effect when the extension is omitted from the request URL ([Configuration options](https://docs.imgproxy.net/configuration/options)). The docs explicitly flag the Vary/caching problem for anyone putting a proxy or CDN in front: *"When AVIF/WebP/JPEG XL support detection is enabled, please take care to configure your CDN or caching proxy to take the `Accept` HTTP header into account while caching,"* adding the security caveat that *"headers cannot be signed. This means that an attacker can bypass your CDN cache by changing the `Accept` HTTP headers"* ([Configuration options](https://docs.imgproxy.net/configuration/options)).

Beyond the docs' prose, I verified directly in the current GitHub source that **imgproxy does set the `Vary` header itself** when format-detection or client-hints features are enabled. `clientfeatures/detector.go` builds a `vary` string containing `Accept` when any of `AutoWebp`/`EnforceWebp`/`AutoAvif`/`EnforceAvif`/`AutoJxl`/`EnforceJxl` is set, plus `Sec-CH-DPR, DPR, Sec-CH-Width, Width` when client hints are enabled, and a `SetVary(header http.Header)` method does `header.Set(httpheaders.Vary, d.vary)`; this is invoked from the request handler in `handlers/processing/request_methods.go` ([detector.go, imgproxy/imgproxy@master](https://raw.githubusercontent.com/imgproxy/imgproxy/master/clientfeatures/detector.go)). This is corroborated by the project's own CHANGELOG, which records a v3.30.0 (2025-09-17) fix: *"Fix the `Vary` header value when `IMGPROXY_AUTO_JXL` or `IMGPROXY_ENFORCE_JXL` configs are set to `true`"* — confirming the Vary-header mechanism is a real, maintained feature, not just aspirational prose ([CHANGELOG.md, imgproxy/imgproxy](https://github.com/imgproxy/imgproxy/blob/master/CHANGELOG.md)). So: imgproxy handles the mechanics of setting `Vary: Accept` correctly on its own responses; the operator's residual job (per the docs' own warning) is making sure any cache/CDN in front actually respects that header rather than serving a WebP response to a client that only asked for JPEG, or vice versa.

## 6. Image processing library / quality

imgproxy is built on **libvips**. Official statement (FAQ / marketing site, echoed verbatim in the README): *"imgproxy relies on `libvips`, a very fast, low-level image processing library that uses minimal memory"* and *"imgproxy takes advantage of probably the most efficient image processing library out there – libvips. It's scary fast and comes with a very low memory footprint"* ([FAQ](https://imgproxy.net/faq/); [README.md, imgproxy/imgproxy](https://github.com/imgproxy/imgproxy/blob/master/README.md)).

**I could not find any imgproxy primary source (docs, README, wiki, CHANGELOG) that names or compares against GD** (the library backing nginx's `ngx_http_image_filter_module`). imgproxy's FAQ frames its performance claims relative to "other self-hosted solutions" in general terms, not against GD specifically. I'm flagging this explicitly rather than inferring a quality/performance delta — libvips is broadly known in the imaging-library ecosystem to support better interpolation kernels (e.g. Lanczos) and more format support than GD, but that comparison is not something imgproxy's own sources state, so it should not be cited as an imgproxy claim.

## 7. Alternatives

**Thumbor** — Python-based, official repo at `thumbor/thumbor` on GitHub, official docs at `thumbor.readthedocs.io`. Installable via `pip install thumbor` (with optional `[opencv]`/`[all]` extras for smart-cropping/face-detection features) or via an official Docker image (`ghcr.io/thumbor/thumbor`) ([Thumbor GitHub](https://github.com/thumbor/thumbor); [Thumbor docs — Getting Started](https://thumbor.readthedocs.io/en/latest/getting_started.html); [Thumbor docs — Hosting](https://thumbor.readthedocs.io/en/latest/hosting.html)). Operational cost: a Python runtime and its dependency chain (optionally OpenCV, which is heavy), a WSGI/Tornado-based service to run and monitor, and its own config/env surface — a comparable or larger operational footprint than imgproxy for this workload.

**Imaginary** — Go microservice, official repo `h2non/imaginary` on GitHub. README states it is "backed by bimg and libvips," is "almost dependency-free" at the Go level (bimg is a cgo binding to libvips), ships with first-class Docker support, and is typically several times faster than ImageMagick/GraphicsMagick-based approaches per its own benchmarking claims ([Imaginary README](https://github.com/h2non/imaginary/blob/master/README.md)). Operationally it's the same shape as imgproxy: a compiled Go binary (or Docker image) requiring libvips on the host, a new process/deploy — so it carries essentially the same "new moving part" cost as imgproxy without imgproxy's built-in URL-signing/allowed-sources security model being as fully documented.

**nginx + Lua (OpenResty)** — OpenResty is "a full-fledged web application server by bundling the standard nginx core, lots of 3rd-party nginx modules, as well as most of their external dependencies" ([OpenResty Docker Hub / official description](https://hub.docker.com/r/openresty/openresty/)). Doing image resizing this way (e.g. via `lua-resty-imagick`, distributed through the OpenResty Package Manager) means replacing stock nginx with an OpenResty-based build (or compiling nginx with `ngx_lua` yourself) plus an ImageMagick or libvips Lua binding ([lua-resty-imagick, OPM](https://opm.openresty.org/package/tom2nonames/lua-resty-imagick/)). Operational cost: it's not a drop-in module for existing nginx — it requires swapping the nginx binary/build itself, which is arguably a *heavier* change to the existing single droplet than adding a sidecar imgproxy process, since it touches the web server you already depend on for everything else.

## Sources

- [imgproxy Pricing](https://imgproxy.net/pricing/) — official pricing page describing OSS vs Pro packaging.
- [imgproxy Features](https://imgproxy.net/features/) — official feature list distinguishing OSS vs Pro capabilities.
- [imgproxy FAQ](https://imgproxy.net/faq/) — official FAQ; source for "no internal cache" and libvips statements.
- [imgproxy homepage](https://imgproxy.net/) — official marketing/landing page.
- [Installation — imgproxy docs](https://docs.imgproxy.net/installation) — official install methods (Docker, Helm, Heroku, Lambda, ECS, DEB/RPM/TAR, AUR, Homebrew, source).
- [Configuration options — imgproxy docs](https://docs.imgproxy.net/configuration/options) — official env-var reference (`IMGPROXY_WORKERS`, `IMGPROXY_MAX_CLIENTS`, `IMGPROXY_DOWNLOAD_BUFFER_SIZE`, `IMGPROXY_KEY`, `IMGPROXY_SALT`, `IMGPROXY_ALLOWED_SOURCES`, `IMGPROXY_AUTO_WEBP`, `IMGPROXY_AUTO_AVIF`, Vary/Accept caveat).
- [Signing the URL — imgproxy docs](https://docs.imgproxy.net/usage/signing_url) — official doc on signature enforcement being optional-but-recommended and the DoS risk of running unsigned.
- [Best format — imgproxy docs](https://docs.imgproxy.net/features/best_format) — confirms "best format selection" is a Pro (`((pro))`) feature.
- [Autoquality — imgproxy docs](https://docs.imgproxy.net/features/autoquality) — confirms DSSIM-based autoquality is Pro-only.
- [Internal cache — imgproxy docs](https://docs.imgproxy.net/cache/internal) — confirms the persistent internal cache is Pro-only.
- [External cache — imgproxy docs](https://docs.imgproxy.net/cache/external) — official guidance on putting a CDN/reverse proxy cache in front of imgproxy.
- [README.md, imgproxy/imgproxy (GitHub)](https://github.com/imgproxy/imgproxy/blob/master/README.md) — official README; libvips statement, feature summary.
- [CHANGELOG.md, imgproxy/imgproxy (GitHub)](https://github.com/imgproxy/imgproxy/blob/master/CHANGELOG.md) — official changelog; v3.30.0 Vary-header fix entry.
- [clientfeatures/detector.go, imgproxy/imgproxy@master (GitHub raw source)](https://raw.githubusercontent.com/imgproxy/imgproxy/master/clientfeatures/detector.go) — source proof that imgproxy sets the `Vary` header itself.
- [Thumbor GitHub repository](https://github.com/thumbor/thumbor) — official Thumbor source/README.
- [Thumbor docs — Getting Started](https://thumbor.readthedocs.io/en/latest/getting_started.html) — official Thumbor install instructions (pip, extras).
- [Thumbor docs — Hosting](https://thumbor.readthedocs.io/en/latest/hosting.html) — official Thumbor Docker/hosting instructions.
- [Imaginary GitHub repository / README](https://github.com/h2non/imaginary/blob/master/README.md) — official Imaginary README (libvips/bimg backing, Docker support, benchmarks).
- [OpenResty Docker Hub page](https://hub.docker.com/r/openresty/openresty/) — official OpenResty image description.
- [lua-resty-imagick, OpenResty Package Manager](https://opm.openresty.org/package/tom2nonames/lua-resty-imagick/) — official OPM package page for Lua/ImageMagick image resizing under OpenResty.

## Could not verify

- **Minimum RAM/CPU footprint**: I could not find any imgproxy primary source (docs, README, FAQ) that states a numeric minimum RAM or CPU requirement. Only qualitative claims ("very low memory footprint," "scary fast") appear ([FAQ](https://imgproxy.net/faq/), [Installation](https://docs.imgproxy.net/installation)).
- **Official systemd unit file**: I could not find one shipped or documented anywhere in imgproxy's official docs or GitHub repo; Docker appears to be the documented primary deployment path, with OS-level service management left to the operator.
- **libvips vs GD comparison**: imgproxy's own sources do not name or compare against GD (the library behind nginx's `ngx_http_image_filter_module`) anywhere I could find. Any such comparison would be inference, not a documented imgproxy claim, so it is explicitly not asserted above.
- **Exact canonical URL for imgproxy's "Generating the URL" doc page**: the current docs.imgproxy.net site structure appears to have reorganized this content under `/usage/processing`, `/usage/signing_url`, and `/usage/encrypting_source_url` rather than a single `generating_the_url` page (older GitHub-hosted `docs/generating_the_url.md` versions exist at pinned commit SHAs but may not reflect the current live docs site). The URL-structure claims in Section 3 are cross-confirmed across the configuration-options page and multiple pinned doc snapshots, but I could not resolve one single current canonical page URL for this in the time available.


---

# 3. Browser image loading, decode and compositing

# Browser image loading attributes and the real cost of a 240-image blurred 3D background

Research date: 2026-07-25. Primary sources only (WHATWG/W3C specs, MDN, developer.chrome.com / web.dev, Chromium source at chromium.googlesource.com).

---

## Bottom line

**Worth adding:**

- **`decoding="async"`** — cheap, safe, correct for decorative images. It is a *hint* that the UA may decode off the critical presentation path so the decode does not delay presenting other content ([HTML: image decoding hint](https://html.spec.whatwg.org/multipage/images.html#image-decoding-hint)). It does **not** reduce total decode CPU; it only relocates/reschedules it. In Chromium the decode already happens on raster/worker threads via `cc`'s image decode caches ([how_cc_works.md](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/how_cc_works.md)), so the practical win on desktop Chrome is small — but it is free.
- **`fetchpriority="low"`** — mildly worth it. Spec-defined ([HTML fetch priority attribute](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fetch-priority-attribute)), shipped in Chrome 101/102+, Firefox 132+, Safari 17.2+ ([BCD](https://raw.githubusercontent.com/mdn/browser-compat-data/main/html/elements/img.json)). But note: images already default to Blink priority **Low**, and `low` "may not lower below Low" ([web.dev fetch-priority](https://web.dev/articles/fetch-priority)). The *real* value here is defensive: it stops these ~70 images from being **boosted to High** by Chrome's in-viewport boost at layout time, and stops any of them being picked as one of the "first 5 large images → Medium". With 70 distinct URLs in a decorative layer, that boost is exactly the failure mode you want to suppress.

**Probably NOT worth adding:**

- **`loading="lazy"`** — actively risky and likely useless here. Chrome's near-viewport threshold on 4G is **1250 px** ([settings.json5 `lazyLoadingImageMarginPx4G`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/frame/settings.json5)), and intersection is computed on the **post-transform, mapped-to-viewport visual rect** ([IntersectionObserver spec](https://w3c.github.io/IntersectionObserver/), [intersection_geometry.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/intersection_observer/intersection_geometry.cc)). Because your tracks are oversized and rotated *into* the viewport, most of these images' transformed rects **do** intersect or sit within 1250 px of the viewport, so they will load anyway — just one frame later and off the load event. For any image that genuinely never intersects, `loading="lazy"` would mean it never loads, which is a visual-correctness risk on an animated layer whose transformed bounds move.

**Dominant remaining cost after shrinking the JPEGs to ~160 px:**

Not network. 70 × ~160 px JPEG ≈ tens of KB total — negligible.

Not decode CPU either, in steady state: a 160×160 RGBA bitmap is ~102 KB (`4 * width * height`, per [`software_image_decode_cache_utils.h`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/software_image_decode_cache_utils.h)), so 70 distinct decodes ≈ **~7 MB** of decoded bitmaps — versus **~2.5 GB** if 70 distinct 3000×3000 images were ever held decoded at full resolution simultaneously (3000×3000×4 = 36 MB each). **So yes — shrinking the source files is a genuine, large decoded-memory win**, and it is the single biggest fix. Chromium's caches do decode/upload at reduced mip levels when the raster scale is small ([`gpu_image_decode_cache.h`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/gpu_image_decode_cache.h): "images which are going to be scaled may be uploaded at lower than original resolution"), but Blink's *decoder* only downsamples when `max_decoded_bytes_` forces it ([`jpeg_image_decoder.cc`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/image-decoders/jpeg/jpeg_image_decoder.cc)), which on desktop is effectively unbounded — so Chrome was **not** already saving you here at the first-decode step.

**The second bottleneck that resizing does not fix: GPU/compositing memory and per-frame render passes.**

- `filter: blur()` on an element forces the element **and all its descendants** to be rendered as an isolated group into an intermediate buffer before the blur is applied ([Filter Effects 1](https://www.w3.org/TR/filter-effects-1/)). In Chromium that is a **render pass / intermediate GPU texture** ([RenderingNG data structures](https://developer.chrome.com/docs/chromium/renderingng-data-structures): "Some visual effects, such as many filters or advanced blend modes, require that two or more quads are drawn to an intermediate texture").
- `will-change: transform` is a **direct compositing reason** (`kWillChangeTransform` in [`compositing_reasons.h`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h)), so each of your ~15 tracks gets its own `cc::Layer` — with its own tiles, its own GPU textures, and (if blurred) its own render-pass texture, sized to the **oversized, beyond-viewport track**, not to the viewport.
- So the expected remaining cost is: **~15 composited layers whose backing store is proportional to the oversized track area, ×(tiles + one blur render-pass texture each), re-composited every animation frame.** Since the tracks are "oversized well beyond the viewport", the texture area — not the image bytes — is what dominates. If you want a second win after the resize, shrink the *rendered area* of the blurred/promoted elements (or move the blur to a cheaper place, e.g. pre-blur the source images so no CSS filter is needed at all), not the image count.

---

## 1. `fetchpriority` on `<img>`

### Spec text

The HTML Living Standard defines `fetchpriority` on `img` as: "The `fetchpriority` attribute is a fetch priority attribute. Its purpose is to set the priority used when fetching the image." ([HTML §the img element](https://html.spec.whatwg.org/multipage/embedded-content.html#attr-img-fetchpriority))

A **fetch priority attribute** is "an enumerated attribute with the following keywords and states: `high` (High), `low` (Low), `auto` (Auto)", with both the missing-value and invalid-value defaults mapping to Auto. The states are defined as ([HTML §fetch priority attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fetch-priority-attribute)):

- **High** — "Signals a high-priority fetch relative to other resources with the same destination."
- **Low** — "Signals a low-priority fetch relative to other resources with the same destination."
- **Auto** — "Signals automatic determination of fetch priority relative to other resources with the same destination."

Note the scoping: **relative to other resources with the same destination** — i.e. images are ranked against images, not against scripts or CSS.

In Fetch, "A request has an associated priority, which is `high`, `low`, or `auto`. Unless stated otherwise it is `auto`", plus "an associated internal priority (null or an implementation-defined object)" ([Fetch §requests](https://fetch.spec.whatwg.org/#request-priority)). **The Fetch Standard contains no normative text describing how a UA must translate priority into scheduling** — it is explicitly implementation-defined. I could not find any normative mapping to HTTP/2 dependency-tree weights or HTTP/3 priority headers in the specs; that is entirely UA policy. *(Flagged: verified absent, not merely unfound.)*

MDN states the values as: `high` = "Fetch the image at a high priority relative to other images"; `low` = "Fetch the image at a low priority relative to other images"; `auto` = "Don't set a preference for the fetch priority. This is the default." ([MDN `<img>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img#fetchpriority))

### Is it honored?

Yes, in all three engines today. From MDN's browser-compat-data source (`html/elements/img.json`, the data behind the MDN compat table) ([raw BCD](https://raw.githubusercontent.com/mdn/browser-compat-data/main/html/elements/img.json)):

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| `fetchpriority` | 101 | 101 | 132 | 17.2 |
| `loading` | 77 | 77 | 75 | 15.4 |
| `decoding` | 65 | 65 | 63 | 11.1 |

web.dev (first-party Chrome documentation) states support as "Chrome 102+, Edge 102+, Firefox 132+, and Safari 17.2+" ([web.dev fetch-priority](https://web.dev/articles/fetch-priority)) — a one-version discrepancy with BCD for Chrome, immaterial here.

### What it concretely changes in Chrome

From [web.dev/articles/fetch-priority](https://web.dev/articles/fetch-priority) (first-party for Chrome behavior):

- Images **default to "Low" priority**; "At layout time, images within the viewport are boosted to 'High'."
- "As of Chrome 117, the first 5 large images are set to 'Medium' to speed this up, and two of them can be fetched in parallel."
- `fetchpriority` is applied **relatively**: `high` bumps the resource up a tier, `low` bumps it down a tier where possible — and **cannot go below "Low"**.
- "priorities are applied both internally within the browser and with protocols that support prioritization (HTTP/2 and HTTP/3)."
- Caveat from the same page: CDNs "don't implement HTTP/2 prioritization uniformly", so the wire-level effect is unreliable; the **in-browser connection/request scheduling effect is the reliable one**.

The WICG explainer confirms the hint is deliberately weak: browsers should "make an effort to respect the developer's preference" but may apply their own heuristics; explicit non-goals include signalling script execution order or blocking behavior. It also names exactly your use case — "marking carousel images with `fetchpriority=low`" — and states the feature "complement[s] existing browser loading primitives such as preload." ([WICG priority-hints EXPLAINER](https://raw.githubusercontent.com/WICG/priority-hints/main/EXPLAINER.md))

**Practical read for this page:** since images are already Low by default and `low` cannot go below Low, `fetchpriority="low"` on these ~240 `<img>`s buys you mainly *immunity from the in-viewport boost to High* and from the "first 5 large images → Medium" heuristic. Given your images are (post-transform) largely in/near the viewport, that boost is a real risk and the attribute is a cheap way to suppress it.

---

## 2. `loading="lazy"`

### Spec-defined criteria

"A **lazy loading attribute** is an enumerated attribute with the following keywords and states: `lazy` (Used to defer fetching a resource until some conditions are met) and `eager` (the default state)." ([HTML §lazy loading attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attribute))

The **will lazy load element steps** return true iff scripting is enabled for the element's node document **and** the element's lazy loading attribute is in the Lazy state — otherwise false. (Same section.) So `loading="lazy"` is a no-op with scripting disabled.

Each `img`/`audio`/`video`/`iframe` has **lazy load resumption steps**, "initially null", invoked when intersection conditions are met or when the attribute is switched to eager.

In "update the image data", the relevant steps are ([HTML §updating the image data](https://html.spec.whatwg.org/multipage/images.html#updating-the-image-data)):

> "If the will lazy load element steps given the `img` element return true" → "Set the `img`'s lazy load resumption steps to the rest of this algorithm starting with the step labeled *fetch the image*." → "Start intersection-observing a lazy loading element for the `img` element."

The **start intersection-observing a lazy loading element** algorithm creates an `IntersectionObserver` whose callback invokes the element's lazy load resumption steps when `entry.isIntersecting` is true. The observer's scroll/root margin is **"an implementation-defined value"**, with the spec suggesting the margin be generous enough for typical devices and possibly sensitive to network quality, and explicitly noting the margin should be **imprecise to avoid a fingerprinting vector**. ([HTML §lazy loading attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attribute))

### How "intersecting the viewport" is computed inside a 3D transform

This is the crux for your layout. The mechanism is IntersectionObserver, and **IntersectionObserver works on transformed (visual) geometry, not pre-transform layout boxes.**

From the [IntersectionObserver spec](https://w3c.github.io/IntersectionObserver/): `boundingClientRect` is "A `DOMRectReadOnly` obtained by getting the bounding box for `target`" — i.e. the same rect `getBoundingClientRect()` returns, which is the **post-transform** rect. The intersection algorithm explicitly maps geometry through the ancestor chain: "Map `intersectionRect` to the coordinate space of container", "Map `intersectionRect` to the coordinate space of root", and finally "Map `intersectionRect` to the coordinate space of the viewport of the document containing `target`."

Blink implements exactly this. In [`intersection_geometry.cc`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/intersection_observer/intersection_geometry.cc), the target rect starts in the target's local coordinate system (`InitializeTargetRect()` / `GetBoxBounds()`), root/target margins are applied via `ApplyMargin()`, and the rect is then pushed through the containing-block chain by `MapToVisualRectInAncestorSpace()`. Transforms are resolved via `ObjectToViewTransform()` using `GeometryMapper::SourceToDestinationProjection(...)`, which computes the full transform chain from object to view coordinates including 3D transforms and perspective.

**Consequence:** for an `<img>` inside `perspective(1150px) rotateX(48deg)`, "intersecting" is judged on the **projected on-screen quad's bounding box**, expanded by the implementation-defined lazy-load margin — not on where the element would have been laid out without the transform. Since your tracks are rotated into view and oversized, most images' projected rects will land in or near the viewport.

One nuance worth flagging: the IntersectionObserver spec's **`isVisible` / visibility computation** (the `trackVisibility` feature, *not* `isIntersecting`) explicitly bails out when a target "has an effective transformation matrix other than a 2D translation or proportional 2D upscaling", returning false. That affects `isVisible` only. Blink's lazy loading keys off `isIntersecting`, per the HTML algorithm above, so a `rotateX` does **not** disqualify the element from loading. *(I confirmed the spec text for the `isVisible` restriction; I could not find any Chromium source or design doc applying a similar transform restriction to lazy loading itself — flagging that as unverified-but-no-evidence-for.)*

### Far-outside-viewport elements and the distance thresholds

Chrome does not wait for actual intersection with the 0-margin viewport; it inflates the root by a **load-in distance**. The constants live in Blink's settings ([`third_party/blink/renderer/core/frame/settings.json5`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/frame/settings.json5)):

| Effective connection type | `lazyLoadingImageMarginPx*` | `lazyLoadingFrameMarginPx*` |
|---|---|---|
| Unknown | 3000 | 4000 |
| Offline | 8000 | 8000 |
| Slow2G | 8000 | 8000 |
| 2G | 6000 | 6000 |
| 3G | 2500 | 3500 |
| 4G | **1250** | 2500 |

Also in that file: `lazyLoadEnabled: true`.

Chrome's own documentation corroborates the values and their history: Chrome "reduced Chrome's distance-from-viewport thresholds from `3000px` to `1250px`" for fast connections and "changed the threshold from `4000px` to `2500px`" for slow connections (3G or lower), and states these thresholds are hardcoded and not customizable by developers ([web.dev browser-level-image-lazy-loading](https://web.dev/articles/browser-level-image-lazy-loading)). So yes — the threshold **does** vary by effective connection type (NetInfo ECT).

So: an image whose transformed bounds are, say, 5000 px below the viewport on a 4G connection will **not** load until scrolling/animation brings its projected rect within 1250 px. If the decorative layer never scrolls it in, it never loads. On an animated 3D layer this is a correctness hazard, since the transformed rect moves per frame and the IntersectionObserver update is asynchronous.

*(Flagged: the current Blink file that wires these settings into the observer is [`lazy_image_helper.cc`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/loader/lazy_image_helper.cc) — it defines `ShouldDeferImageLoad`, `StartMonitoring`, `StopMonitoring`, and `LoadAllImagesAndBlockLoadEvent`, and delegates to `EnsureLazyLoadMediaObserver().StartMonitoringNearViewport(document, element)`. The older, widely-cited `lazy_load_image_observer.cc` with `GetLazyImageLoadingViewportDistanceThresholdPx` no longer exists at that path in `main`; I could not fetch the current `LazyLoadMediaObserver` implementation file directly to quote the exact line that reads `lazyLoadingImageMarginPx4G`. The settings values and the web.dev numbers agree, so I'm confident in the numbers, but I'm flagging that I did not read the exact call site.)*

### Does `loading="lazy"` change anything for an image already intersecting on initial layout?

Yes — subtly, and in ways that matter:

1. **The fetch is deferred by at least one IntersectionObserver delivery.** The spec routes the load through the observer callback rather than starting it during "update the image data" ([HTML §updating the image data](https://html.spec.whatwg.org/multipage/images.html#updating-the-image-data)). So even a fully in-viewport lazy image starts its fetch later than an eager one — after layout and an IO delivery, rather than at parse time. It also means the fetch cannot be started by the **preload scanner**.
2. **Load-event interaction.** The spec's rule is that fetching the image delays the load event "when delay load event is true"; deferring the fetch behind the observer defers/removes that blocking for the deferred period, and Blink has an explicit `LoadAllImagesAndBlockLoadEvent(Document&)` escape hatch (e.g. for printing) in [`lazy_image_helper.cc`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/loader/lazy_image_helper.cc).
3. **Chrome documents this as a real regression risk**: "Don't lazy-load images that are likely to be in-viewport when the page loads, especially LCP images" ([web.dev browser-level-image-lazy-loading](https://web.dev/articles/browser-level-image-lazy-loading)). Images already visible without scrolling "load normally" *only if you leave them eager*.
4. **No-op if scripting is disabled** (will lazy load element steps).

**Verdict for your case:** the images are mostly near/in the projected viewport, so `loading="lazy"` mostly just delays the same fetches by a frame, adds a per-image IntersectionObserver target (240 of them, re-evaluated as the 3D transform animates), and risks never loading the far ones. Skip it, or apply it only to tracks you can prove are far off-screen and static.

---

## 3. `decoding="async"` vs `"sync"` vs `"auto"`

### Spec

The `decoding` attribute is an **image decoding hint**, an enumerated attribute with three states ([HTML §the img element / image decoding hint](https://html.spec.whatwg.org/multipage/images.html#image-decoding-hint)):

- **Sync** — "Indicates a preference to decode this image synchronously for atomic presentation with other content."
- **Async** — "Indicates a preference to decode this image asynchronously to avoid delaying presentation of other content."
- **Auto** — "Indicates no preference in decoding mode (the default)."

Normative UA behavior: "When decoding an image, the user agent should **respect the preference** indicated by the decoding attribute's state. If the state indicated is Auto, then the user agent is **free to choose any decoding behavior**."

Note the word "preference" and "should" — this is a hint, not a guarantee, in all three states.

### Does it affect main-thread blocking?

Indirectly and only as a hint. The spec frames the distinction purely in terms of **presentation atomicity vs. not delaying presentation of other content** — not in terms of which thread does the work. `sync` asks the UA to hold presentation until this image is decoded so it appears atomically with surrounding content; `async` releases that constraint so the frame can be presented without waiting. Nothing in the spec promises the decode moves off the main thread; it promises the *presentation* is not gated on it.

In Chromium specifically, image decoding for composited raster is already handled by `cc`'s TileManager on raster worker threads: "image decoding receives a lot of special care in the TileManager, as they are the most expensive part of raster" ([how_cc_works.md](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/how_cc_works.md)). So on Chrome the marginal main-thread saving from `decoding="async"` is generally small; the risk it removes is the sync-decode-during-paint path.

### Versus `img.decode()`

The HTML Standard is explicit that these are different mechanisms: "It is also possible to control the decoding behavior using the `decode()` method", and "the `decode()` method performs decoding independently from the process responsible for presenting content to screen, [so] it is **unaffected by the decoding attribute**." ([HTML §image decoding hint](https://html.spec.whatwg.org/multipage/images.html#image-decoding-hint))

MDN adds the practical framing ([MDN HTMLImageElement.decoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decoding)): `decode()` is "a better solution" for the swap-in case because "It provides a way to asynchronously decode an image, delaying inserting it into the DOM until it is fully downloaded and decoded", and MDN warns that for the download-flash problem "Setting `decoding` won't prevent that." `decode()` gives you a promise you can await; `decoding` gives you a scheduling hint you cannot observe.

### Does `decoding="async"` reduce total decode CPU?

**No.** Nothing in the HTML spec, MDN, or Chromium's decode-cache documentation describes the hint as changing the decode algorithm, the output format, or the number of pixels decoded. It changes **when** and **relative to what** the decode happens. Total decode CPU is a function of pixel count and codec — which is precisely why the 3000×3000 → ~160 px source change is the intervention that actually reduces CPU (by ~350×in pixel count per image).

---

## 4. Decoded-bitmap memory

### Sizing model: 4 bytes per pixel, RGBA

Confirmed directly in Chromium source. `cc`'s software image decode cache computes the locked memory of a cached decode as a straight RGBA product — the `locked_bytes()` helper is documented as "Helper to figure out how much memory the locked image represented by this key would take", and the calculation assumes RGBA format, multiplying 4 bytes by width and height, returning `std::numeric_limits<size_t>::max()` on overflow ([`cc/tiles/software_image_decode_cache_utils.h`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/software_image_decode_cache_utils.h)).

The GPU path uses Skia's own sizing: `SkImageInfo::computeMinByteSize()` with `ByteSizeOverflowed` checks ([`cc/tiles/gpu_image_decode_cache.cc`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/gpu_image_decode_cache.cc)), which accounts for stride and pixel format.

**No mipmap chain is included in that per-decode accounting** — Chromium picks *one* mip level to upload rather than storing a full pyramid (see below). *(Flagged: I did not find a primary statement about whether the GPU driver/Skia additionally allocates mips for these textures; I could not confirm that either way, so treat "4 × w × h per cached decode" as the floor, not a guaranteed ceiling.)*

Worked numbers for your case:
- 3000 × 3000 × 4 = **36 MB** per distinct decoded image. × 70 distinct URLs = **~2.5 GB** if all were held full-res simultaneously.
- 160 × 160 × 4 = **~102 KB**. × 70 = **~7 MB**.

### Does the browser hold the FULL-resolution bitmap when the image is displayed small?

**It depends on which stage you mean, and the answer is "at first decode, essentially yes on desktop; for raster/upload, no."**

**(a) Blink's image decoder.** The decoder has a `max_decoded_bytes_` budget, documented as "The maximum amount of memory a decoded image should require. Ideally, image decoders should downsample large images to fit under this limit (and then return the downsampled size from `DecodedSize()`). Ignoring this limit can cause excessive memory use or even crashes on low-memory devices." The `Create()` factories take a `platform_max_decoded_bytes` parameter, "indicating this value is set based on platform-specific constraints rather than a universal default", and the class defines `kNoDecodedImageByteLimit` ([`image_decoder.h`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/image-decoders/image_decoder.h)).

The JPEG decoder acts on this budget and **only on this budget**: it downsamples "according to the maximum decoded size" when `original_bytes > max_decoded_bytes`. `DesiredScaleNumerator()` returns the full denominator (8 — "JPEG only supports a denominator of 8") when the decoded size already fits, and reduces the numerator proportionally otherwise; the values are set into `info_.scale_num` / `info_.scale_denom` before `jpeg_calc_output_dimensions()`, so libjpeg-turbo decompresses at the reduced resolution rather than downsampling afterwards. The decoder also refuses to scale down JPEGs with a non-whole number of MCUs in either dimension (artifact avoidance) *unless* the memory limit forces it. ([`jpeg_image_decoder.cc`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/image-decoders/jpeg/jpeg_image_decoder.cc))

**Critically: the trigger is the byte budget, not the CSS display size.** The decoder has no knowledge that you are painting the image into a small box. So on a desktop configuration with a large/unbounded `platform_max_decoded_bytes`, a 3000×3000 JPEG decodes to a full 3000×3000 buffer. *(Flagged: I confirmed the mechanism and the trigger condition from source, but I could not locate the concrete per-platform value assigned to `platform_max_decoded_bytes` on desktop Windows — I am not going to guess it. The mechanism's dependence on bytes-not-display-size is the load-bearing finding and that is confirmed.)*

**(b) `cc`'s raster/upload path — this one IS display-size aware.** `GpuImageDecodeCache` "handles the decode and upload of images that will be used by Skia's GPU raster path" and explicitly states that "images which are going to be scaled may be uploaded at lower than original resolution" ([`cc/tiles/gpu_image_decode_cache.h`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/gpu_image_decode_cache.h)). The mechanism is `CalculateUploadScaleMipLevel` — "Calculates the scale factor which can be used to scale an image to a given mip level" — paired with `CalculateSizeForMipLevel` — "Calculates the size of a given mip level" — chosen from the `DrawImage`'s target scale, using ceiling-based sizing "to guarantee the uploaded mip is sufficiently large for the target scale". Clipped images are special-cased because "Images which are being clipped will have color-bleeding if scaled." ([`cc/tiles/gpu_image_decode_cache.cc`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/gpu_image_decode_cache.cc))

The software path has the equivalent: `CacheKey` processing types `kOriginal` ("use the original decode without any subrecting or scaling"), `kSubrectOriginal` ("extract a subrect from the original decode but do not scale it"), and `kSubrectAndScale` ("extract a subrect (if needed) from the original decode and scale it") ([`software_image_decode_cache_utils.h`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/software_image_decode_cache_utils.h)).

### So: does shrinking the JPEGs actually help?

**Yes, materially.** Chrome's decode-to-scale machinery is in the *raster/upload* layer and is driven by the raster scale of the target, and its cheaper `kSubrectAndScale` path still scales *from the original decode*. The initial full-resolution decode still happens (unless the platform byte budget forces downsampling), and it is that decode which costs 36 MB per image and the corresponding CPU. Handing Chrome a ~160 px source removes that cost at the root.

An extra wrinkle specific to your page: the raster scale Chromium picks for a layer under `perspective(1150px) rotateX(48deg)` is not simply "the CSS box size" — the projection is non-uniform across the layer. I could not find a primary source specifying how `cc` picks a single raster/upload scale for a layer under a non-affine (perspective) transform, so **do not assume Chrome was already picking a conservatively small mip for these.** *(Flagged: unverified.)*

---

## 5. GPU / compositing layers

### What promotes an element to its own composited layer

Blink enumerates these as `CompositingReason` values in [`third_party/blink/renderer/platform/graphics/compositing_reasons.h`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h), generated from a `FOR_EACH_COMPOSITING_REASON` macro list. Relevant entries include `k3DTransform`, `k3DScale`, `kTrivial3DTransform`, `kActiveTransformAnimation`, `kActiveFilterAnimation`, `kBackdropFilter`, and the will-change group `kWillChangeTransform`, `kWillChangeFilter`, `kWillChangeOther`. The file groups them by comment into "Intrinsic reasons that can be known right away by the layer", "Reasons that depend on ancestor properties", and "Subtree reasons that require knowing what the status of your subtree is", and defines aggregate constants `kDirectReasonsForTransformProperty`, `kDirectReasonsForEffectProperty`, `kDirectReasonsForFilterProperty` that group the triggers for creating paint property nodes.

Note there is **no standalone `kFilter` reason** — a plain static `filter: blur()` is *not* by itself in the will-change/animation direct-reason set (`kWillChangeFilter` and `kActiveFilterAnimation` are). A static blur creates a stacking context and a render pass, but not necessarily a promoted `cc::Layer`. Your `will-change: transform` on the tracks **is** a direct reason (`kWillChangeTransform`) and will force layers.

Blink's paint README describes the pipeline: paint "segments the display item list into `PaintChunk`s which are sequential display items that share a common property tree state", and `PaintArtifactCompositor` then performs layerization, where "property nodes that will be composited are converted into cc property nodes, while non-composited property nodes are converted into meta display items" ([`core/paint/README.md`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/paint/README.md)).

### The layerization model — 15 layers or 240?

**~15, not ~240** — assuming, as you describe, that `will-change: transform` and the 3D transform live on the track elements and the `<img>` children have no direct compositing reason of their own.

Reasoning from primary sources:

- `cc`'s own documentation is blunt: **"Layers are not per-element."** A layer is "a 2d rectangle of content with integer bounds" with "transform, clip, and effects on it that describe how it should look on screen", and compositing decisions originate from Blink's paint and property trees, not from the DOM ([how_cc_works.md](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/how_cc_works.md)). Because property trees exist, "there is also no longer a need for a tree of layers, and instead an ordered list of layers can be used."
- The layerization heuristic is stated in Chrome's RenderingNG docs: "A good general approach is to **merge chunks by default**, and not merge paint chunks that have property tree states that are expected to change on the compositor thread, such as with compositor-thread scrolling or compositor-thread transform animations." ([RenderingNG data structures](https://developer.chrome.com/docs/chromium/renderingng-data-structures))

Your 240 `<img>` elements paint into display items that share their track's property tree state, so they become paint chunks that **merge into the track's layer**. Each track, however, has a distinct animating transform node and is therefore exactly the case the heuristic refuses to merge — giving you one `cc::Layer` per track.

### Memory cost model

This is where the cost actually lives. Two independent allocations per promoted, blurred track:

1. **Tiles / raster textures for the layer.** "The viewport is divided into tiles. A separate GPU texture tile backs each tile with the rasterized pixels for part of the viewport" ([RenderingNG data structures](https://developer.chrome.com/docs/chromium/renderingng-data-structures)). `cc` sizes tiles as "for software raster tiles are roughly 256x256 px and for gpu raster tiles are roughly viewport width x one quarter viewport height", and each tile "represents potential content" staged for rasterization ([how_cc_works.md](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/how_cc_works.md)). Tile memory tracks *near-viewport* content, which is the mitigating factor — but your tracks are "oversized well beyond the viewport", so the near-viewport region of each is large.
2. **A render-pass / intermediate texture for the blur** — see §6.

Chrome's own performance guidance is explicit about the cost: "every layer you create requires memory and management, and that's not free"; "every layer's textures needs to be uploaded to the GPU, so there are further constraints in terms of bandwidth between CPU and GPU, and memory available for textures on the GPU"; and the flat instruction **"Do not promote elements unnecessarily."** ([web.dev: stick to compositor-only properties and manage layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count))

MDN's `will-change` page states the same in stronger terms: "**Excessive use of `will-change` will result in excessive memory use and will cause more complex rendering to occur as the browser attempts to prepare for the possible change.** This will lead to worse performance", and notes that putting `will-change` directly in a stylesheet "implies that the targeted elements are always a few moments away from changing and the browser will keep the optimizations for a much longer time than it would have otherwise" — i.e. your 15 tracks hold their layer allocations **permanently**, not just during animation ([MDN `will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change)).

*(Flagged: I could not find a primary Chromium document giving a concrete formula or default budget for total tile/GPU memory — `cc`'s `ManagedMemoryPolicy` / working-set limits appear as `max_working_set_bytes_` and `max_working_set_items_` in [`gpu_image_decode_cache.h`](https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/gpu_image_decode_cache.h) but those govern the *image decode cache*, not layer tile memory. I am not going to quote a number for the tile memory budget.)*

**15 layers is not inherently a lot.** The problem is 15 layers × oversized area × a blur render pass each, recomposited every frame.

---

## 6. CSS `filter: blur()` and child rasterization

### Does blur force rendering the subtree into an intermediate buffer? Yes.

The Filter Effects spec is explicit ([Filter Effects Module Level 1](https://www.w3.org/TR/filter-effects-1/)):

> "rendering an element via CSS or SVG can conceptually be described as if the element, including its children, are drawn into a buffer (such as a raster image) and then that buffer is composited into the element's parent. Filters apply an effect before the compositing stage."

and, on the `filter` property:

> a computed value other than `none` "results in the creation of a stacking context", and "All the element's descendants are rendered together as a group with the filter effect applied to the group as a whole."

So the blurred track's 16 child `<img>`s are **not** blurred individually — they are painted into one isolated group buffer, and the blur runs once over that buffer. That is architecturally good (one blur pass, not 16), and bad for memory (one buffer sized to the whole oversized track).

`blur()` itself: "Applies a Gaussian blur to the input image. The passed parameter defines the value of the standard deviation to the Gaussian function." (same spec).

The spec also notes the filter region is padded because "the filter effect might impact bits slightly outside the tight-fitting bounding box" — so the intermediate buffer is somewhat *larger* than the element.

*(Flagged: I looked for, and could not retrieve, the Filter Effects text describing the three-successive-box-blur approximation and the `d = floor(s * 3 * sqrt(2π)/4 + 0.5)` kernel-width formula from the fetched version of the spec. I am therefore **not** asserting the exact approximation algorithm as spec-backed here.)*

### Chromium's cost model

In Chromium the isolated-group buffer is a compositor **render pass / intermediate texture**. From Chrome's first-party rendering docs ([RenderingNG data structures](https://developer.chrome.com/docs/chromium/renderingng-data-structures)):

> "Some visual effects, such as many filters or advanced blend modes, require that two or more quads are drawn to an intermediate texture. Then the intermediate texture is drawn into a destination buffer on the GPU (or possibly another intermediate texture), applying the visual effect at the same time."

`cc`'s effect tree carries these effects, and "a clip, or an effect (e.g. a blur filter, or a mask, or an opacity)" applies "recursively to its children" ([how_cc_works.md](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/how_cc_works.md)).

Implementation-wise, Chromium's design docs record that CSS shorthand filters are implemented as an "SkImageFilter chain" on the compositor/impl thread (Skia), and that SVG-in-CSS filters work by rendering "an HTML element to a buffer, then appl[ying] an SVG filter DAG to it" ([Chromium: Filter Effects design doc](https://www.chromium.org/developers/design-documents/image-filters/)).

**What this means for you:** the per-frame GPU cost of the blur is proportional to the **area of the blurred surface** (the oversized track), not to the number of images inside it, and it is paid on **every animated frame** because the track's transform is animating and the render pass must be re-composited. Shrinking the source JPEGs does not touch this cost at all.

*(Flagged: I could not find a primary Chromium/Skia document stating a quantitative cost model relating blur radius to per-pixel cost — e.g. whether Skia's GPU blur is separable-two-pass, box-blur-approximated, or downscale-then-blur, and how that scales with sigma. The Chromium Filter Effects design doc does not address it. Treat "cost ∝ surface area, roughly independent of sigma above small radii" as an unverified assumption, and measure it instead.)*

---

## 7. Beyond `fetchpriority` — other decorative/low-value hints

### Priority Hints history

`fetchpriority` **is** the shipped form of the WICG Priority Hints proposal. The explainer now uses `fetchpriority` as the attribute/property name throughout with no discussion of earlier naming; it describes the feature as "an upgrade/downgrade mechanism" with three states (`high`, `low`, `auto`), states that browsers should "make an effort to respect the developer's preference" — deliberately weak language permitting UA heuristics to override — and lists non-goals: it signals nothing about script execution order or image blocking behavior beyond initial fetch priority. It explicitly cites deprioritizing carousel/non-critical imagery as a target use case. ([WICG priority-hints EXPLAINER](https://raw.githubusercontent.com/WICG/priority-hints/main/EXPLAINER.md))

*(Flagged: I could not retrieve, from a primary WICG source, explicit text documenting the historical `importance` attribute name and its rename to `fetchpriority`. The current explainer no longer mentions `importance`. I am not going to cite a blog for it — treat the rename as folklore unless you find the commit.)*

### Resource hints

Priority Hints "complement existing browser loading primitives such as preload"; preload mandates that a resource be fetched, while priority hints refine the relative ordering, and the two can be combined ([WICG priority-hints EXPLAINER](https://raw.githubusercontent.com/WICG/priority-hints/main/EXPLAINER.md)).

**For your case this is a trap, not an opportunity.** `<link rel=preload as=image>` would make these decorative images load *more* eagerly and *earlier* — the opposite of what you want. There is no "de-preload". The correct tool here is `fetchpriority="low"` and nothing else from the resource-hints family. `preconnect` is irrelevant if the images are same-origin; if they're on a separate asset host, one `preconnect` to that host is the only resource hint with a plausible positive effect, and it helps regardless of priority.

### `content-visibility` — genuinely relevant, and you didn't ask

Worth flagging as the strongest adjacent lever for exactly the cost identified in §5–§6.

`content-visibility: auto` "enable[s] the user agent to skip an element's layout and painting **entirely** when not needed", applying **layout containment, style containment, and paint containment**, while keeping skipped contents "available to user-agent features" like find-in-page and tab order ([CSS Containment Level 2](https://drafts.csswg.org/css-contain-2/); [MDN `content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility)). `content-visibility: hidden` skips contents entirely and makes them inaccessible to those UA features. MDN reports it as Baseline since September 2024 (works across the latest devices and browser versions).

Two caveats before you reach for it:

1. **Skipping is driven by relevance to the user, which is viewport-based** — the same class of problem as §2. Inside an animating 3D transform, whether your tracks are ever "skipped" is not something I can predict from spec text.
2. **Paint containment on a blurred/composited subtree may fight your design**: containment creates a containing block and clips, which can change how the oversized tracks render. *(Flagged: I could not confirm from a primary source whether images inside a `content-visibility: auto` skipped subtree are still fetched — MDN does not state it and the CSS Containment spec section I retrieved does not address resource loading. Do not assume it defers image loads.)*

Use `contain-intrinsic-size` alongside it to avoid layout shift when content enters/leaves the skipped state ([MDN `content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility)).

### The lever that isn't an attribute

Given §4 and §6, the highest-leverage changes are not HTML attributes at all:

1. Shrink the source JPEGs (already planned) — kills ~2.5 GB of potential decoded bitmap and the corresponding decode CPU.
2. **Pre-blur the source images** so the CSS `filter: blur()` can be dropped from the tracks entirely — removes 15 per-frame render passes and their intermediate textures ([Filter Effects](https://www.w3.org/TR/filter-effects-1/), [RenderingNG data structures](https://developer.chrome.com/docs/chromium/renderingng-data-structures)).
3. Reduce the *rendered area* of the promoted tracks — layer/tile/render-pass memory scales with area, not image count ([how_cc_works.md](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/how_cc_works.md), [web.dev layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)).
4. Reduce duplication: 240 elements over 70 URLs means the decode cache is shared, but each of the 240 is still a paint op, a layout box, and an IntersectionObserver target if you add `loading="lazy"`.

---

## Explicitly unverified (summary of in-line flags)

- No normative spec text maps `fetchpriority` to HTTP/2 dependency weights or HTTP/3 priority — Fetch leaves it implementation-defined. (Verified absent.)
- Could not read the current Blink call site that reads `lazyLoadingImageMarginPx4G` (the old `lazy_load_image_observer.cc` path is gone in `main`); the values themselves are confirmed from `settings.json5` and web.dev.
- No Chromium source found applying IntersectionObserver's `isVisible` transform restriction to lazy loading (lazy loading uses `isIntersecting`, so it should not apply).
- Concrete desktop-Windows value of `platform_max_decoded_bytes` not located.
- How `cc` picks a single raster/upload scale for a layer under a *perspective* (non-affine) transform: not found.
- Whether Skia/driver allocates a mip chain beyond the single uploaded mip: not confirmed.
- Concrete tile/GPU memory budget numbers for compositing: not found in primary docs.
- Filter Effects' three-box-blur approximation text and kernel formula: not retrieved from the fetched spec version.
- Quantitative Skia/Chromium blur cost model (sigma vs. per-pixel cost): not found.
- Whether `content-visibility: auto` skipped subtrees still fetch their images: not found.
- Primary-source documentation of the `importance` → `fetchpriority` rename: not found in the current WICG explainer.

---

## Sources

- https://html.spec.whatwg.org/multipage/embedded-content.html#attr-img-fetchpriority
- https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fetch-priority-attribute
- https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attribute
- https://html.spec.whatwg.org/multipage/images.html#updating-the-image-data
- https://html.spec.whatwg.org/multipage/images.html#image-decoding-hint
- https://fetch.spec.whatwg.org/#request-priority
- https://w3c.github.io/IntersectionObserver/
- https://www.w3.org/TR/filter-effects-1/
- https://drafts.csswg.org/css-contain-2/
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img#fetchpriority
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decoding
- https://developer.mozilla.org/en-US/docs/Web/CSS/will-change
- https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/html/elements/img.json
- https://web.dev/articles/fetch-priority
- https://web.dev/articles/browser-level-image-lazy-loading
- https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- https://developer.chrome.com/docs/chromium/renderingng-data-structures
- https://www.chromium.org/developers/design-documents/image-filters/
- https://chromium.googlesource.com/chromium/src/+/lkgr/docs/how_cc_works.md
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/frame/settings.json5
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/loader/lazy_image_helper.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/intersection_observer/intersection_geometry.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/paint/README.md
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/image-decoders/image_decoder.h
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/image-decoders/jpeg/jpeg_image_decoder.cc
- https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/gpu_image_decode_cache.h
- https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/gpu_image_decode_cache.cc
- https://chromium.googlesource.com/chromium/src/+/main/cc/tiles/software_image_decode_cache_utils.h
- https://raw.githubusercontent.com/WICG/priority-hints/main/EXPLAINER.md


---

# 4. Vite dev proxy and nginx plumbing

# Vite `server.proxy` + nginx `proxy_cache` plumbing for `/api/art/{width}/{path}`

Research date: 2026-07-25. Repo targets **Vite 8** (confirmed: `packages/vite/package.json` at tag `v8.2.0-beta.0` depends on `"http-proxy-3": "^1.23.3"`, not classic `http-proxy`). All claims below are cited to primary sources: vite.dev docs, the actual Vite/http-proxy-3 source on GitHub, nginx.org module docs, and RFC/MDN specs.

## Bottom line

- `rewrite(path)` receives the **full current `req.url`** — leading slash, full path, and **query string included** — and whatever string it returns becomes the new `req.url` before proxying. It is called once per request, straight from `req.url`, no decoding/normalization by Vite. Source: `packages/vite/src/node/server/middlewares/proxy.ts` lines 220–221 (HTTP) and 177–178 (WS) at Vite tag `v8.2.0-beta.0`.
- A regex like `path.replace(/^\/api\/art\/\d+/, '')` on that string works fine and leaves a multi-segment remainder (e.g. `/covers/season-1/ep-3.jpg`) intact — Vite does nothing to the remainder, it's a plain string.
- Proxy key matching is **prefix (`startsWith`) by default, or `RegExp` if the key's first character is `^`**. `/api/art/` as a plain string key is a prefix match — exactly right for `/api/art/{width}/{path}`.
- `changeOrigin` rewrites the outgoing `Host` header to the target's host[:port]; `secure` controls TLS cert verification (`rejectUnauthorized`) only when the target is `https:`. Both are implemented in `http-proxy-3`'s `common.ts` (not in Vite itself — Vite just forwards the option object).
- nginx: **`proxy_pass` with a URI part (a path after the host) is disallowed in a regex `location`.** You must either give `proxy_pass` no URI (bare `scheme://host`, no trailing path) or reach the proxy_pass line via `rewrite ... break` / a separate location. For our variable-width/variable-path case, the working pattern is a regex location with `proxy_pass` **without** a URI, using `$1`/`$2` captured variables to build the final URL manually via `proxy_pass $target_scheme://...$2;` (no path suffix) is actually NOT valid either if you literally append `$2` — appending captured variables to a bare-host `proxy_pass` **is** allowed because nginx's "no URI" restriction is specifically about a *literal* URI-path segment in the directive, not about variables. This is detailed in Q5 below with a concrete working sketch.
- `immutable` in `Cache-Control` is **not** defined in RFC 9111 — it's defined in **RFC 8246** ("HTTP Immutable Responses"), a separate extension spec.
- nginx's own doc statement: "**One megabyte zone can store about 8 thousand keys**" for `proxy_cache_path`'s `keys_zone`.
- Default `proxy_cache_key` is `$scheme$proxy_host$request_uri` — for our case it must be overridden to include the width, e.g. `$scheme$proxy_host$uri$is_args$args` won't include width unless width stays in `$uri`; easiest is to key on the *incoming* request URI (which already contains width + path) rather than trying to reconstruct just the backend path.

---

## 1. Vite `server.proxy`: full option set, and the exact `rewrite` signature/semantics

Config docs page: https://vite.dev/config/server-options.html#server-proxy

The docs page for `server.proxy` states it is a `Record<string, string | ProxyOptions>`, and:

> "Extends [`http-proxy-3`](https://github.com/sagemathinc/http-proxy-3#options). Additional options are [here](https://github.com/vitejs/vite/blob/main/packages/vite/src/node/server/middlewares/proxy.ts#L13)."

and shows the canonical example:

```js
rewrite: (path) => path.replace(/^\/api/, '')
```

The docs themselves don't spell out whether the query string is included, so the ground truth is the source. I fetched `packages/vite/src/node/server/middlewares/proxy.ts` at tag `v8.2.0-beta.0` (pinned commit `34af7b76301fa5d297883fa5053e806c6f8e5f3b`):
https://github.com/vitejs/vite/blob/v8.2.0-beta.0/packages/vite/src/node/server/middlewares/proxy.ts

Relevant declaration (line ~13-16):

```ts
export interface ProxyOptions extends httpProxy.ServerOptions {
  /**
   * rewrite path
   */
  rewrite?: (path: string) => string
  ...
```

Relevant call sites:

- HTTP request path (lines 220–221):
  ```ts
  if (opts.rewrite) {
    req.url = opts.rewrite(req.url!)
  }
  ```
- WebSocket upgrade path (lines 177–178):
  ```ts
  if (opts.rewrite) {
    req.url = opts.rewrite(url)
  }
  ```
  where `url` a few lines up is simply `const url = req.url!`.

So: `rewrite` is handed **exactly `req.url`** (Node's raw `http.IncomingMessage.url`), which per Node's HTTP semantics is the full request-target as sent by the client on the request line — includes the leading `/`, the full matched-and-unmatched path, and the `?query=string` if present, and is **not** stripped of the matched prefix key. Vite does not split off the matched context string before calling `rewrite` — you always get the whole original URL and must do your own regex/replace. `rewrite`'s return value becomes the new `req.url` verbatim (assigned directly, no validation).

## 2. Does `rewrite` see the matched path such that a numeric-width prefix regex strips cleanly, leaving a multi-segment remainder intact? Encoded-slash pitfalls?

Yes. Since `rewrite` receives the raw `req.url` string (§1) and only does `.replace()`/similar, a pattern such as:

```js
rewrite: (path) => path.replace(/^\/api\/art\/\d+/, '')
```

applied to `/api/art/320/covers/season-1/ep-3.jpg` yields `/covers/season-1/ep-3.jpg` — a string with multiple `/`-separated segments, completely intact, because nothing downstream treats it as anything but an opaque path string until http-proxy-3 builds the outgoing request.

Confirmed downstream handling: `http-proxy-3`'s `common.ts` (https://github.com/sagemathinc/http-proxy-3/blob/main/lib/http-proxy/common.ts) builds the final outgoing path with:

```ts
let outgoingPath = options.toProxy ? req.url : getPath(req.url);
...
outgoing.path = urlJoin(targetPath, outgoingPath ?? "");
```

where `getPath` (line ~329) does:

```ts
function getPath(url?: string): string {
  if (url === "" || url?.startsWith("?")) {
    return url;
  }
  const u = toURL(url);
  return `${u.pathname ?? ""}${u.search ?? ""}`;
}
```

`toURL` parses the string with the WHATWG `URL` constructor. This matters for encoded slashes: the WHATWG URL parser does **not** decode `%2F` inside `pathname` — percent-encoded octets in the path are preserved as-is in `.pathname` (this is documented WHATWG URL Standard behavior; Node's `url.parse`/`URL` follows it — see Node's URL docs: https://nodejs.org/api/url.html#url-strings-and-url-objects, which states the `URL` object implements the WHATWG URL Standard and stores `pathname` percent-encoded). So a client-sent `%2F` inside the `{path/to/image.jpg}` segment survives Vite's rewrite and http-proxy-3's `getPath`/`urlJoin` unchanged (it isn't decoded to a literal `/`, and it isn't re-encoded either) and is forwarded to the upstream by that byte sequence. `urlJoin` (same file, line ~222) does only string concatenation/query merging, no decode/encode.

Practical consequence for our feature: since our `{path/to/image.jpg}` segments are plain, unencoded slashes (not `%2F`), this is a non-issue for the happy path. If a client legitimately percent-encodes a `/` inside a filename segment, it will pass through as literal `%2F` text to the CloudFront origin unchanged by Vite/http-proxy-3 — CloudFront's own decoding behavior is outside primary sources available here (flagged below as unverified against a source we hold).

`encodeURIComponent` itself (MDN: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent) encodes `/` to `%2F` by design — relevant if the client-side code that builds these image URLs encodes each path segment individually vs. the whole path; encoding the whole path breaks our `{width}/{path}` scheme because `/path/to/image.jpg`'s internal slashes would become `%2F` and no longer be split-able as directory segments by nginx's regex `location`. This is a build-time discipline note, not a Vite/nginx bug.

**Verified**: Vite source (pinned tag), `http-proxy-3` source (main branch — no version tags found in the repo, see caveat in Sources), MDN, Node docs.
**Not independently verifiable here**: exact CloudFront-side `%2F` handling (would need AWS docs primary source, not fetched — flagged, not asserted).

## 3. Proxy key matching: prefix, substring, or RegExp?

Vite source, same file, function `doesProxyContextMatchUrl` (line 231 at `v8.2.0-beta.0`):

```ts
function doesProxyContextMatchUrl(context: string, url: string): boolean {
  return (
    (context[0] === '^' && new RegExp(context).test(url)) ||
    url.startsWith(context)
  )
}
```

So matching is:
- If the config key's **first character is `^`**, the whole key string is compiled as a `RegExp` and tested with `.test(url)` (a *match-anywhere* test, since no `^`/`$` anchoring is imposed beyond what's in the pattern itself — but by convention the key starts with `^` so it's effectively anchored at the start).
- Otherwise, plain **`url.startsWith(context)`** — i.e. prefix matching, not substring, not exact-match.

This matches the docs page's description quoted under Q1 ("Additional options are here") plus the general server.proxy example table on https://vite.dev/config/server-options.html#server-proxy showing `'/foo': 'http://localhost:4567'`-style keys as prefixes.

**Recommendation for our feature**: use the plain string key `'/api/art/'` (prefix match via `startsWith`). Any request path starting with `/api/art/` — e.g. `/api/art/320/covers/x.jpg` — matches. This is exactly the pattern the existing three entries already use (`/api/rss`, `/api/essays/curation`, `/api/essays/events`), all plain-string prefix keys, no `^` needed.

## 4. `changeOrigin`, `secure`, Host header handling (http-proxy-3, since Vite 8 depends on it, not classic `http-proxy`)

Vite 8's `package.json` (tag `v8.2.0-beta.0`) pins:
```
"http-proxy-3": "^1.23.3"
```
— confirmed by direct fetch of `packages/vite/package.json` at that tag. (Vite ≤6 used classic `http-proxy@^1.18.1`; Vite 8 switched to the `http-proxy-3` fork, per the same package.json diff and per the vite.dev docs' explicit "Extends http-proxy-3" line cited in Q1.)

`http-proxy-3` source, `lib/http-proxy/common.ts` (https://github.com/sagemathinc/http-proxy-3/blob/main/lib/http-proxy/common.ts), function that builds the outgoing request options:

```ts
if (target.protocol !== undefined && isSSL.test(target.protocol)) {
  outgoing.rejectUnauthorized =
    typeof options.secure === "undefined" ? true : options.secure;
}
...
if (options.changeOrigin) {
  outgoing.headers.host =
    target.protocol !== undefined &&
      required(outgoing.port, target.protocol) &&
      !hasPort(outgoing.host)
      ? outgoing.host + ":" + outgoing.port
      : outgoing.host;
}
```

So, precisely:
- **`secure`**: only takes effect when the target URL's protocol is TLS (`isSSL.test(target.protocol)`, i.e. `https:`/`wss:`). It sets Node's outgoing HTTPS request option `rejectUnauthorized`. Default (`undefined`) behaves as `true` (verify certs) — i.e. `secure: true` is effectively also the default-safe behavior; the option exists so you can set `secure: false` to skip cert validation (e.g. self-signed upstream certs). This matches the `http-proxy` README wording quoted from a mirrored copy: "secure: true/false, if you want to verify the SSL Certs. Set this to false if you're proxying another server that has a self-signed cert." (Original `http-proxy` README: https://github.com/http-party/node-http-proxy#options — content mirrors what `http-proxy-3` inherited; `http-proxy-3`'s own repo is https://github.com/sagemathinc/http-proxy-3.)
- **`changeOrigin`**: rewrites the **outgoing request's `Host` header** to the target's host (plus port, if the target's protocol+port combo isn't the implicit default port and the host string doesn't already carry a port) — i.e. makes the upstream see its own hostname in `Host`, not the original client-facing hostname. It does **not** touch anything about TLS/SNI directly — TLS SNI is a transport-layer concern of Node's own `https` client (`node:tls`), which uses the *connection target hostname* (the URL you connect to) for SNI regardless of `changeOrigin` — `changeOrigin` only affects the HTTP `Host` header inside the already-established connection.

For proxying dev-mode traffic to a CloudFront distribution (`https://d3t3ozftmdmh3i.cloudfront.net`): since the `target` is the CloudFront hostname itself, Node's HTTPS client will naturally SNI on `d3t3ozftmdmh3i.cloudfront.net` (correct — this is the literal connection target, unrelated to `changeOrigin`), and `secure: true` (default) will validate CloudFront's real ACM/AWS cert normally — no special flags should be needed, matching the existing repo pattern for the nostr.band and anchor.fm proxy entries (`changeOrigin: true, secure: true`). Whether CloudFront additionally requires a specific `Host` header value to route correctly (some CloudFront distributions key behavior off `Host`) is a CloudFront-side routing question I could **not** verify against an AWS primary-source doc in this pass (not fetched) — flagged as unverified. Given the target host equals the CloudFront domain itself (not a custom origin-behind-CloudFront alias), `changeOrigin: true` should produce `Host: d3t3ozftmdmh3i.cloudfront.net`, which is the distribution's own default domain, so this is very likely fine, but flagging per instructions since I have no AWS-doc citation.

## 5. nginx: capturing `{width}`/`{path}`, allowlisting width, and the `proxy_pass` regex-location restriction

Primary source: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass

Quoted verbatim from the nginx docs:

> "In some cases, the part of a request URI to be replaced cannot be determined:
> - When location is specified using a regular expression, and also inside named locations.
>   In these cases, `proxy_pass` should be specified without a URI.
> - When the URI is changed inside a proxied location using the `rewrite` directive, and this same configuration will be used to process a request (`break`):
>   ```
>   location /name/ {
>       rewrite    /name/([^/]+) /users?name=$1 break;
>       proxy_pass http://127.0.0.1;
>   }
>   ```
>   In this case, the URI specified in the directive is ignored and the full changed request URI is passed to the server."

So the rule is precisely: **`proxy_pass` must be given without a URI part (i.e., no path after the host:port) whenever the enclosing `location` is a regex location** (`~` or `~*`) — because nginx has no well-defined notion of "the matched prefix to strip and replace" for a regex location (there's no literal prefix, only a pattern match). The same "no-URI" rule also applies inside named locations.

Also relevant, from the same doc page (proxy_pass general semantics section), on what "without a URI" vs "with a URI" means for prefix stripping:

> "If proxy_pass is specified without a URI, the request URI is passed to the server in the same form as sent by the client ... If proxy_pass is specified with a URI, then when a request is passed to the server, part of a normalized request URI matching the location is replaced by a URI specified in the directive."

**Working config sketch** — for a regex location we cannot use a URI-bearing `proxy_pass`, so we build the full upstream request in one of two nginx-legal ways:

**Option A — regex location, `proxy_pass` with no URI, and let the *variables* carry the whole target (this is legal — the "no URI" restriction is about a literal path segment written after the host in the directive, not about interpolated variables composing the connection target only; to also select the backend path you must route the incoming URI unmodified, since "no URI" means nginx forwards `$request_uri`/current normalized URI verbatim, not that you can graft your own path via variables onto a no-URI proxy_pass). Concretely, that means Option A can only work if the origin also serves `/api/art/{width}/{path}`-shaped requests directly (it doesn't — CloudFront wants a bare `/{path}`). So Option A does not fit; use Option B.**

**Option B — named/rewritten location reached via `rewrite ... last`, avoiding the regex-location restriction entirely, since `proxy_pass` with a URI is allowed once the *serving* location is a prefix (`/`) or exact-match location, not the regex one:**

```nginx
map $arg_w $art_width_ok {
    default   "";
    160       160;
    320       320;
    640       640;
}

server {
    ...

    # Public regex location: only extracts variables and validates width,
    # then hands off via rewrite ... last to a plain prefix location
    # so proxy_pass may legally carry a URI.
    location ~ ^/api/art/(?<art_width>\d+)/(?<art_path>.+)$ {
        if ($art_width !~ ^(160|320|640)$) {
            return 400;
        }
        rewrite ^ /_art_internal/$art_path last;
    }

    # Internal named/prefix location: proxy_pass WITH a URI is allowed here
    # because this location is NOT defined with a regex.
    location /_art_internal/ {
        internal;
        proxy_cache art_cache;
        proxy_cache_key "$scheme$proxy_host$art_width$request_uri";
        proxy_cache_valid 200 30d;

        proxy_hide_header Cache-Control;
        proxy_ignore_headers Cache-Control Expires;
        add_header Cache-Control "public, max-age=31536000, immutable" always;

        proxy_pass https://d3t3ozftmdmh3i.cloudfront.net/;
    }
}
```

Notes on why this satisfies nginx's rule: the *outer* location (`~ ^/api/art/...`) never calls `proxy_pass` itself — it only does `rewrite ... last`, which is nginx's documented mechanism for re-dispatching a request to a different location entirely (a fresh location search), landing in `/_art_internal/`, a plain-prefix location. `proxy_pass https://.../` there **has** a trailing-slash URI, which is legal because that location is not regex-defined — nginx will strip the matched `/_art_internal/` prefix and forward whatever follows (`$art_path`, e.g. `covers/season-1/ep-3.jpg`) to CloudFront root. Width itself isn't part of the CloudFront request in this design (dev/no-resize concept extends to prod meaning: nginx's `image_filter`/resizing step — not detailed in the prompt's prod side beyond "nginx resizes to {width}" — would sit in this same internal location, e.g. via `image_filter resize $art_width -;` from `ngx_http_image_filter_module`, https://nginx.org/en/docs/http/ngx_http_image_filter_module.html — flagged: the prompt didn't ask me to verify the image_filter module itself in depth, only the proxy_pass/cache mechanics, so I did not deep-dive that module beyond confirming it exists as nginx's own resizing module).

## 6. Browser `Cache-Control` vs nginx's own `proxy_cache_valid`, and what `immutable` actually means

- `expires` directive (sets both `Expires` and a matching `Cache-Control: max-age=N`): https://nginx.org/en/docs/http/ngx_http_headers_module.html#expires — quoted:
  > "Enables or disables adding or modifying the "Expires" and "Cache-Control" response header fields... time is positive or zero — "Cache-Control: max-age=t"..."
- `add_header` directive (arbitrary header, doesn't compute max-age itself, but can literally set `Cache-Control: public, max-age=31536000, immutable`): https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header — quoted:
  > "Syntax: add_header name value [always]; ... If the always parameter is specified (1.7.5), the header field will be added regardless of the response code."
  The `always` flag matters because, per the same doc, `add_header` by default only fires on 200/201/204/206/301/302/303/304/307/308 responses — `always` forces it onto error responses (e.g. 4xx/5xx) too, which is the recommended usage for a header you want unconditionally.
- `proxy_cache_valid` (nginx's OWN cache TTL, independent of what header the browser sees): https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_valid — quoted:
  > "Sets caching time for different response codes... `proxy_cache_valid 200 302 10m;` ... If only caching time is specified... then only 200, 301, and 302 responses are cached."
  This is nginx's internal disk-cache freshness window, completely separate from the `Cache-Control`/`Expires` headers nginx sends to the browser — they can (and in our case should) differ: e.g. `proxy_cache_valid 200 30d;` (nginx keeps the resized image on disk for 30 days) while `add_header Cache-Control "public, max-age=31536000, immutable" always;` tells the *browser* to never revalidate for a year, since the URL itself (`/api/art/{width}/{path}`) is immutable content (any real content change gets a new path/filename upstream).
- `proxy_hide_header` / `proxy_ignore_headers`: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_hide_header and `#proxy_ignore_headers` — quoted:
  > `proxy_hide_header`: "By default, nginx does not pass the header fields "Date", "Server", "X-Pad", and "X-Accel-..." from the response of a proxied server to a client. The `proxy_hide_header` directive sets additional fields that will not be passed."
  > `proxy_ignore_headers`: "Disables processing of certain response header fields from the proxied server. The following fields can be ignored: ... "Expires", "Cache-Control", "Set-Cookie" ..., and "Vary" ..."
  These are two different mechanisms and you likely want both for this feature: `proxy_ignore_headers Cache-Control Expires;` stops CloudFront's own `Cache-Control`/`Expires` from being used by **nginx's cache-validity logic** (so `proxy_cache_valid` alone governs nginx's disk TTL, not CloudFront's header), and `proxy_hide_header Cache-Control;` (plus not re-emitting `Expires`) stops CloudFront's header value from being **forwarded to the browser** at all, so your `add_header ... always;` line is the only `Cache-Control` the browser ever sees.
- `immutable`: **NOT defined in RFC 9111.** I searched RFC 9111 (https://www.rfc-editor.org/rfc/rfc9111.html) and confirmed (via search results and cross-reference) that `immutable` is a separate extension, defined in **RFC 8246, "HTTP Immutable Responses"**: https://www.rfc-editor.org/rfc/rfc8246.html — its abstract: the `immutable` response directive "allows servers to identify resources that will not be updated during the freshness lifetime of the response, thus allowing clients to avoid revalidation." MDN's Cache-Control reference (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) documents `immutable` and attributes it to RFC 8246 as well, consistent with this. RFC 9111 itself (the general HTTP Caching spec, obsoleting RFC 7234) governs `max-age`, `no-cache`, `no-store`, `public`/`private`, `must-revalidate`, etc., but has no `immutable` keyword of its own.

## 7. `proxy_cache_key`: documented default, and what ours should be

Default, quoted verbatim from https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_key:

> Default: `proxy_cache_key $scheme$proxy_host$request_uri;`

(I hit one inconsistent auto-summary claiming a second "close to" form using `$uri$is_args$args`; that appears to be summarizer noise/conflation with a different directive's phrasing, not the actual nginx.org text — the value independently corroborated across the direct nginx.org fetch and a corroborating secondary search is `$scheme$proxy_host$request_uri`, so treat that as the verified default.)

For our feature the cache identity must be (upstream path + width), since two different widths of the same image are genuinely different cached objects. Two viable approaches:
1. **Key on the original incoming request** (simplest, and what the sketch in Q5 does): `proxy_cache_key "$scheme$proxy_host$art_width$request_uri";` — here `$request_uri` on the *internal* location is the rewritten `/ _art_internal/covers/season-1/ep-3.jpg` (unique per path) and `$art_width` (captured from the outer regex location, available because named captures persist through `rewrite ... last` into the new location as long as they were set via the `(?<name>...)` syntax) disambiguates the width dimension explicitly, guarding against any accidental collisions if `$request_uri` alone ever repeated across widths.
2. Alternatively, since the outer regex location already captured `$1`(width)/`$2`(path) before the `rewrite`, you can carry those into the internal location's own key without relying on `$request_uri` reconstruction at all — functionally equivalent to (1).

Either way, the point is: **do not use the bare default** (`$scheme$proxy_host$request_uri` on the *outer* URL) unmodified without ensuring width is actually embedded in whatever `$request_uri`/`$uri` you key on at the location where `proxy_cache` is active — in our sketch it naturally is, since width is part of the request path before the rewrite and can be explicitly appended.

## 8. `proxy_cache_path`: `max_size`, `inactive`, `levels`, `keys_zone`, and the keys-per-MB estimate

Source: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_path

Quoted:
> Syntax: `proxy_cache_path path [levels=levels] [use_temp_path=on|off] keys_zone=name:size [inactive=time] [max_size=size] [min_free=size] ...;`
> "Cache data are stored in files. The file name in a cache is a result of applying the MD5 function to the cache key. The `levels` parameter defines hierarchy levels of a cache: from 1 to 3, each level accepts values 1 or 2."
> `keys_zone=name:size`: "All active keys and information about data are stored in a shared memory zone, whose name and size are configured by the `keys_zone` parameter. **One megabyte zone can store about 8 thousand keys.**" (A parenthetical in the same doc adds that with the commercial-subscription build, the zone also stores extended cache info, so a 1MB zone there holds only "about 4 thousand keys" — that halved figure is specific to nginx Plus/commercial, not OSS nginx.)
> `inactive=time`: "Cached data that are not accessed during the time specified by the `inactive` parameter get removed from the cache regardless of their freshness. By default, `inactive` is set to 10 minutes."
> `max_size=size`: "The special "cache manager" process monitors the maximum cache size set by the `max_size` parameter. When the size is exceeded, it removes the least recently used data."

So: **~8,000 keys per 1MB of `keys_zone`** is indeed nginx's own documented estimate (confirmed, not misremembered) for open-source nginx; commercial nginx Plus halves that to ~4,000/MB due to extra metadata. `levels` controls the on-disk directory fan-out (1–3 levels, each 1 or 2 hex chars from the MD5-derived filename) purely for filesystem performance on large caches, unrelated to the `keys_zone` RAM sizing. `inactive` (default 10m) is the "evict if unused for N," separate from `proxy_cache_valid`'s "consider fresh for N" — a response can be evicted by `inactive` even before its `proxy_cache_valid` freshness window elapses if nobody requests it, and conversely a still-"active" (recently requested) but stale-by-`proxy_cache_valid` entry gets revalidated/refetched rather than evicted.

Example sizing directive for this feature:
```nginx
proxy_cache_path /var/cache/nginx/art levels=1:2 keys_zone=art_cache:10m max_size=2g inactive=7d use_temp_path=off;
```
(10m keys_zone ≈ 80,000 cached-object keys headroom — generous for width×path combinations at 3 allowed widths.)

---

## Vite `vite.config.js` addition (dev-mode proxy)

```js
'/api/art/': {
  target: 'https://d3t3ozftmdmh3i.cloudfront.net',
  changeOrigin: true,
  secure: true,
  rewrite: (path) => path.replace(/^\/api\/art\/\d+/, ''),
},
```

- Key `/api/art/` matches via `startsWith` (§3) against any request beginning `/api/art/160/...`, `/api/art/320/...`, etc.
- `rewrite` receives the whole `req.url` (§1), e.g. `/api/art/320/covers/season-1/ep-3.jpg`, strips the `/api/art/{digits}` prefix only, leaving `/covers/season-1/ep-3.jpg` — a full, multi-segment, slash-containing remainder (§2) — which becomes the new `req.url` that `http-proxy-3` joins onto the CloudFront target root (§2, `urlJoin`/`getPath` in `http-proxy-3`'s `common.ts`), yielding `https://d3t3ozftmdmh3i.cloudfront.net/covers/season-1/ep-3.jpg` at full size, matching "dev: strip `/api/art/{width}` and proxy the remainder at full size, no resize."
- `changeOrigin: true` + `secure: true` mirrors the existing three entries and is safe for a same-name TLS target like CloudFront's own default domain (§4).

## nginx production config sketch (full)

```nginx
proxy_cache_path /var/cache/nginx/art levels=1:2 keys_zone=art_cache:10m max_size=2g inactive=7d use_temp_path=off;

server {
    ...

    # Public-facing regex location: capture + validate only, then dispatch.
    location ~ ^/api/art/(?<art_width>\d+)/(?<art_path>.+)$ {
        if ($art_width !~ ^(160|320|640)$) {
            return 400;
        }
        rewrite ^ /_art_internal/$art_path last;
    }

    # Internal, non-regex location: proxy_pass WITH a URI is legal here (§5).
    location /_art_internal/ {
        internal;

        proxy_cache art_cache;
        proxy_cache_key "$scheme$proxy_host$art_width$request_uri";  # width + remainder path (§7)
        proxy_cache_valid 200 30d;    # nginx's OWN disk-cache TTL (§6)

        # Don't let CloudFront's own Cache-Control/Expires drive nginx's cache logic,
        # and don't let it leak to the browser either:
        proxy_ignore_headers Cache-Control Expires;
        proxy_hide_header Cache-Control;

        # Browser-facing header, set unconditionally (incl. on error responses):
        add_header Cache-Control "public, max-age=31536000, immutable" always;

        # TODO (out of scope for this research pass): image_filter resize $art_width - ;
        # from ngx_http_image_filter_module — see note in §5, not deep-verified here.

        proxy_pass https://d3t3ozftmdmh3i.cloudfront.net/;
    }
}
```

---

## Sources (deduplicated)

- Vite server.proxy config docs — https://vite.dev/config/server-options.html#server-proxy
- Vite proxy middleware source (pinned tag v8.2.0-beta.0, commit 34af7b76301fa5d297883fa5053e806c6f8e5f3b) — https://github.com/vitejs/vite/blob/v8.2.0-beta.0/packages/vite/src/node/server/middlewares/proxy.ts
- Vite `packages/vite/package.json` at same tag (confirms `http-proxy-3` dependency) — https://raw.githubusercontent.com/vitejs/vite/v8.2.0-beta.0/packages/vite/package.json
- http-proxy-3 repository (Vite 8's proxy dependency) — https://github.com/sagemathinc/http-proxy-3
- http-proxy-3 `common.ts` source (changeOrigin/secure/getPath/urlJoin) — https://github.com/sagemathinc/http-proxy-3/blob/main/lib/http-proxy/common.ts
- node-http-proxy (classic) README, options table (`changeOrigin`, `secure` wording origin) — https://github.com/http-party/node-http-proxy#options
- Node.js `url` module docs (WHATWG URL, percent-encoding behavior) — https://nodejs.org/api/url.html#url-strings-and-url-objects
- MDN `encodeURIComponent` — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
- nginx `ngx_http_proxy_module` docs (proxy_pass, proxy_cache_valid, proxy_cache_key, proxy_cache_path, proxy_hide_header, proxy_ignore_headers) — https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- nginx `ngx_http_headers_module` docs (expires, add_header) — https://nginx.org/en/docs/http/ngx_http_headers_module.html
- nginx `ngx_http_image_filter_module` (referenced, not deep-verified) — https://nginx.org/en/docs/http/ngx_http_image_filter_module.html
- RFC 9111, HTTP Caching — https://www.rfc-editor.org/rfc/rfc9111.html
- RFC 8246, HTTP Immutable Responses — https://www.rfc-editor.org/rfc/rfc8246.html
- MDN Cache-Control header reference — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- (repo-internal, for style reference only, not a claim source) docs/deploy/nginx-rss-proxy.md

## Explicitly flagged unverifiable-against-primary-source claims

1. **CloudFront's exact behavior on `%2F`-encoded slashes inside a path segment, and whether CloudFront cares about the `Host` header for routing when the target is the distribution's own default domain.** I did not fetch AWS's own CloudFront documentation in this pass; I noted the mechanics of what Vite/http-proxy-3 do (pass the bytes through unchanged) but the *upstream's* interpretation is outside the primary sources I gathered. Treat as unverified; if this matters for the feature, fetch `docs.aws.amazon.com` CloudFront developer guide directly before relying on it.
2. **`ngx_http_image_filter_module` specifics** (exact `image_filter resize` syntax/behavior, error handling for non-image upstream responses, `image_filter_buffer` sizing) — I confirmed the module exists and is nginx's own resizing mechanism via its docs URL, but did not deep-read its directive semantics, since the prompt's core questions were about proxy_pass/cache mechanics, not resizing itself. Flagging so it isn't silently assumed correct.
3. One WebFetch summarization pass returned a second, different-looking "close to" default for `proxy_cache_key` (`$scheme$proxy_host$uri$is_args$args`) alongside the correct one; I re-verified directly against nginx.org and via an independent secondary corroboration and am confident the correct documented default is `$scheme$proxy_host$request_uri` — flagging the discrepancy here for transparency rather than silently dropping the conflicting text.
4. `http-proxy-3`'s GitHub repo does not appear to publish version-pinned git tags accessible the way Vite's repo does (I could not confirm a `v1.23.3`-tagged ref existed to fetch from; I read `main` branch content instead, matching the version range `^1.23.3` in Vite's package.json but not byte-pinned to that exact release). Flagging since my citation for `common.ts` is to `main`, not a pinned tag, unlike the Vite citation.
