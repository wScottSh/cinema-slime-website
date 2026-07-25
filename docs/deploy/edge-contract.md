# The edge contract — `npm run verify:edge`

Every same-origin `/api/` path on the site is nginx configuration on the
droplet, not code in the deployed artifact:

| Path | Must be | Config |
| --- | --- | --- |
| `/api/rss` | XML, at least one `<item>` | `docs/deploy/nginx-rss-proxy.md` |
| `/api/essays/curation` | JSON (ADR 0008) | `docs/deploy/nginx-essays-proxy.md` |
| `/api/essays/events` | JSON (ADR 0008) | `docs/deploy/nginx-essays-proxy.md` |
| `/api/art/{160,320,640}/{path}` | `image/*`, far smaller than origin, cached (ADR 0013) | `docs/deploy/nginx-artwork-proxy.md` |
| `/api/art/{anything else}` | 404, and never an image | same |

Because none of it ships with the build, it can rot with nothing failing.

```sh
npm run verify:edge
# node scripts/verify-edge-contract.mjs https://staging.example.com
```

Plain GETs and HEADs against public URLs — no SSH, no secrets, no writes, safe
to re-run. Exits non-zero if any check fails.

## Why a status code is not enough

On 2026-07-25 both of these were live and neither surfaced anywhere:

- `/api/art/*` returned **404** for every request — the config had never been
  installed. The client shows its dark placeholder on a failed image, so the
  page looked merely dim.
- `/api/essays/*` returned **200 `text/html`** — the SPA shell. With no matching
  `location`, `location / { try_files $uri $uri/ /index.html; }` answers
  everything. The Essays snapshot silently fell back to the `wss` relays, so the
  only symptom was a slow cold load.

A 200 is exactly what a *missing* endpoint returns. So every check asserts the
kind of thing that came back — content type **and** a parse of the body — and
the negative checks assert what must **not** come back.

## What it checks

- **Content, not status.** `/api/rss` must parse to ≥ 1 `<item>`; the Essays
  endpoints must be `application/json` *and* parse as JSON.
- **Artwork is really downscaled.** Derivative paths are built by
  `src/artwork-url.js` — the same seam the browser uses — from artwork
  discovered in the live feed, and each must be under 25 % of its CloudFront
  original (measured by HEAD, per run) and carry `X-Cache-Status`.
- **The width allowlist holds.** `/api/art/3000/…`, `/161/…`, `/abc/…` and
  `/api/art/160/` must each 404 and must never return an image. This is a
  security boundary (ADR 0013 decision 3), not a tidy-up.
- **`image_filter_buffer` clears the largest source, with headroom.** Parsed out
  of `deploy/nginx/cinemaslime-art-cache.conf` so the assertion cannot drift
  from the committed config, and compared against the measured maximum across
  the whole catalogue. Requires max < 60 % of the buffer, so growth trips the
  check while the site still works. (The 6M-buffer bug 415'd the two largest
  artworks invisibly; see the artwork playbook.)

## Where the logic lives

`src/edge-contract.js` is pure — the contract list and every verdict function,
unit-tested in `src/edge-contract.test.js` without a network. Those tests are
the regression lock for the outage above: an SPA shell answering a JSON
endpoint, a 404 artwork path, a near-origin-size "derivative", an off-ladder
width returning an image, and an undersized buffer must each keep failing.

`scripts/verify-edge-contract.mjs` is the IO shell: it discovers artwork from
the live feed (the same way `warm-artwork-cache.mjs` does), fetches at a fixed
concurrency of 4, and reports.

## When to run it

After any nginx change on the droplet, and after any deploy — alongside
`npm run warm:artwork`. The two are complementary: warming proves every
artwork resizes, this proves every `/api/` path is still the *kind* of thing the
site expects.
