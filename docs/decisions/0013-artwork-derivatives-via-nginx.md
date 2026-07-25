# Episode Artwork Derivatives Served from nginx

**Date**: 2026-07-25
**Status**: accepted
**Amends**: [ADR 0010](0010-hero-background-film-reel.md) decision 5 (the
"no changes to `vite.config.js`, the deploy workflow, or nginx" clause) and, by
inheritance, [ADR 0004](0004-hero-bg-tile-wrappers-and-enhancement.md) decision 5
and its constraint 1 ("100 % client-side presentation only"). Everything else in
both ADRs stands — in particular ADR 0010's visual design (decisions 1–4) is
untouched by this change.
**Context**: Issues [#106](https://github.com/wScottSh/cinema-slime-website/issues/106)
(the report and measurements) and [#108](https://github.com/wScottSh/cinema-slime-website/issues/108)
(the ticket). Primary-source backing in `docs/research/0106-artwork-derivatives.md`.

---

## Context / problem

Episode artwork is uploaded to CloudFront as 3000×3000 JPEGs. Measured on the
live catalogue: 70 distinct images, 172,551,299 bytes total, averaging 2,465,018
bytes each.

The site had no way to serve anything but that original upload, so every image
slot paid full resolution for a fraction of the pixels it displays:

| Slot | Displayed at | Was fetching |
| --- | --- | --- |
| Hero film-reel frame | 270 px, blurred to ~2.2 px, dimmed to ~32 % | ~2.4 MB |
| Sticky player thumbnail | 56 px | ~2.4 MB |
| Episode grid card | 220 px | ~2.4 MB |
| Latest-Episode card | the largest slot on the page | ~2.4 MB |

The hero reel is the acute case: a cold load pulls **every distinct artwork in
the catalogue** — ~172 MB from a single host — to paint a background nobody can
resolve. On a slow connection the reel sits on dark placeholders indefinitely.

A prior proposal to cap the reel to ~12–16 distinct images was **rejected**. It
treats the symptom (too many bytes) by cutting the wrong thing (how much of the
catalogue is visible). The reel showing the whole, growing back catalogue is the
design; and capping would have left the other three slots still serving 2.2 MB
originals, and every future Episode inheriting the same defect.

---

## Decisions

### 1. Break ADR 0010's "no infrastructure change" rule — deliberately

ADR 0004 constrained hero-background work to be "100 % client-side presentation
only", and ADR 0010 decision 5 carried that forward as "zero new dependencies; no
changes to `vite.config.js`, the deploy workflow, or nginx." That discipline was
right for both: those changes were *presentation* changes, and the rule kept them
small and reversible.

This change is not a presentation change. Nothing about what the reel looks like
moves. The defect is that the site can only ever serve the original upload, and
no amount of client-side work fixes that — the bytes have to be made smaller by
something, somewhere. That something is the nginx we already run.

This ADR is the record that the rule was broken knowingly, once, for a reason
that does not generalize. The presentation-only discipline still governs
*presentation* work on the hero.

### 2. Resize on the nginx we already operate, not a new service

`ngx_http_image_filter_module` (GD-backed) ships as a standard distro package
(`libnginx-mod-http-image-filter`) that drops its own `load_module` line into
`/etc/nginx/modules-enabled/`. It is a body filter, so it works on a proxied
response, not just local files.

imgproxy was evaluated and rejected: its OSS tier has no cache of its own
(persistent internal caching is Pro-gated), so it would still need nginx's
`proxy_cache` in front of it — a new process, a new deploy artifact, and
signing-key management on top of all the nginx work, removing none of it.

### 3. `/api/art/{width}/{path}`, with the origin hardcoded server-side

The upstream host lives in the nginx config and is never taken from the request.
That is what keeps the endpoint from being usable as an open image proxy.

The width ladder is **160, 320, 640**. A width off the ladder is a 404 and never
triggers a resize — validating width is the boundary that prevents unbounded
resize requests at arbitrary sizes, not an optimization. nginx's allowlist is the
real boundary; `src/artwork-url.js` carries a matching allowlist so the client
can never construct a URL the server would refuse.

Assignment: reel 160, sticky player 160, grid card 320, latest-Episode card 640.

### 4. Two-tier caching, because one location caches the wrong bytes

nginx writes a proxied response to its cache store **before** the body-filter
chain runs, and re-sends cache hits back **through** that chain. `image_filter`
is a body filter. So a single location doing `proxy_pass` + `image_filter` +
`proxy_cache` would cache the *original* full-size bytes and re-pay the GD resize
on every request, hit or miss.

So the resize runs on a loopback-only server (`127.0.0.1:8081`) and the cache
sits in front of that: what gets stored is the already-resized output, and the
resize runs at most once per `(width, path)`.

`inactive=365d` on the cache zone is the other deliberate choice. The usual short
window evicts idle entries; here that is backwards, because a rarely-requested
older Episode's artwork is exactly the long-tail asset this exists to keep cheap.
Eviction only under genuine `max_size` (1 GB) pressure — which is also why no
scheduled re-warm job is needed.

### 5. Fail loudly; never fall back to the original

No `error_page 415` redirect to the full-size image. That fallback would silently
reintroduce the exact defect this fixes. A failed artwork request fails, and the
existing dark-placeholder degradation is what the visitor sees.

### 6. One resolver module, four call sites

`src/artwork-url.js` is a pure module and the single seam: it maps a pinned-host
URL to a derivative path at an allowed width, and passes **everything else**
through unchanged — local assets, data URIs, and Essay Cover Images, which live
on arbitrary Nostr hosts and are explicitly out of scope.

This adds the first `import` to `src/hero-reel.js`, which ADR 0010 decision 5
described as import-free. The property that mattered — the builder is pure and
deterministic — is unchanged and still tested.

The reel's show-art exclusion keeps comparing **raw** URLs, before any mapping:
"which Episode is the generic show-art placeholder" and "what URL do we actually
request" are separate concerns and stay unentangled.

### 7. Reel frames: `fetchpriority="low"` + `decoding="async"`, and no `lazy`

Dropping `loading="lazy"` from reel frames is deliberate. The strips are tilted
and oversized, so most frames project into or near the viewport under the
browser's post-transform intersection geometry, and the lazy-load distance
threshold is on the order of a thousand pixels — lazy mostly delays fetches that
happen anyway, while risking that a frame whose transformed position never
crosses the threshold never loads at all. `loading="lazy"` stays on the Episode
grid card, where cards genuinely are below the fold.

### 8. Fisher-Yates, with an injectable random source

The reel's shuffle was `sort(() => Math.random() - 0.5)` — not a uniform shuffle;
it quietly favors the feed's original order. Invisible today only because the
catalogue (70) is smaller than the reel's frame count (up to ~400), so every
image appears regardless. As the catalogue grows past the frame count it would
start systematically favoring recent Episodes over the back catalogue —
undermining the very requirement this work exists to protect.

`shuffleEpisodes(list, random = Math.random)` takes its random source as a
parameter. This is a narrow, deliberate amendment to the project's general rule
against injecting values purely for testability: for four lines that are
otherwise testable only by statistical assertion on real randomness, injection
preserves the determinism guarantee that rule protects, far more cheaply than
inventing another module boundary.

### 9. Dev parity via the existing Vite proxy pattern

`vite.config.js` gains one `/api/art/` entry that strips the `{width}` segment
and forwards the CloudFront path. In dev the browser gets full-size originals
under the same same-origin URL shape; only the byte count differs, not the
contract. No new package dependency — dev is not expected to resize anything.

### 10. Rollout order and cache warming

nginx ships and is smoke-tested first; the client ships only after. Shipping the
client first would 404 every artwork request. `npm run warm:artwork` requests
every current Episode's artwork at all three rungs after a deploy, so visitors
essentially never pay a resize. Between deploys, a new Episode costs exactly one
visitor one resize of one image.

---

## Consequences

- The reel's cold-load artwork transfer drops from ~172 MB to under 1 MB at the
  current catalogue size (~202× less), with the **whole** catalogue still shown
  and zero design compromise. The other three slots shrink correspondingly.
- Total reel bytes still scale with catalogue size — this is accepted, not a bug.
  At ~400 Episodes on a 2560×1200 viewport the reel would approach ~5 MB.
  Acceptance is expressed per-image (<20 KB per reel artwork) plus a total at the
  current catalogue size, precisely so growth never "violates" it by design.
- **WebP is unreachable and that saving is left on the table.** `image_filter`'s
  output format is its detected *input* format — JPEG in, JPEG out, always; no
  directive or `Accept` header can change it. Reaching WebP (roughly another 2×)
  would mean adopting a different tool, rejected above for unrelated reasons.
- The droplet gains one distro package and one loopback `server{}`, and roughly
  210 cached files today, bounded at 1 GB.
- nginx and the Vite dev proxy get **no unit-test seam** — there is no practical
  way to exercise either inside `node --test`, and this repo does not pretend
  otherwise. Both are verified by the documented smoke test in
  `docs/deploy/nginx-artwork-proxy.md`, exactly as the RSS and Essays proxies are.
- Deliberately **not** addressed here: the per-`<img>` CSS blur's compositing
  cost (each reel frame is blurred into its own isolated render-pass buffer
  rather than the blur being applied once per animated track). Shrinking the
  sources does not touch it, no primary source gives a quantitative cost model
  for it, and it is a design-affecting change — it needs measuring first, as a
  separate issue.
- Also out of scope: Essay Cover Images (arbitrary hosts, passed through), and
  the separate concern that an un-timed-out snapshot fetch can block first paint.
