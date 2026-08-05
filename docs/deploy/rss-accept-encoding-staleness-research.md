# RSS `Accept-Encoding` / `Vary` staleness — primary-source research

**Date**: 2026-08-05
**Status**: research only — no config changed
**Bug (given, not re-diagnosed)**: `/api/rss` staleness (up to ~3.8 days) is
caused by Fastly (fronting `anchor.fm`) storing a separate cached variant per
`Vary`-nominated request header — including `Accept-Encoding` — under a
~7-day `s-maxage`, and not purging every variant on publish. Our nginx
forwards the client's `Accept-Encoding` upstream and honors upstream `Vary`,
so it fragments its own cache per-encoding and pins a browser to whichever
stale Fastly variant that encoding string maps to.

This file exists because the investigation needed to trace every claim to
nginx.org, Fastly's docs, and RFC 9110/9111 rather than folklore. Saved under
`docs/deploy/` to sit alongside the existing `nginx-rss-proxy.md`,
`nginx-essays-proxy.md`, and `nginx-artwork-proxy.md` — the repo has no
separate `docs/research/` location, and this is an edge/nginx investigation
like its siblings.

---

## 1. How nginx's `proxy_cache` treats upstream `Vary`

**Source**: nginx.org, `ngx_http_proxy_module`, `proxy_ignore_headers` and
`proxy_cache_valid`.

- `proxy_ignore_headers` (http/server/location context) can disable
  processing of, among others, `"Vary" (1.7.7)`. Its doc states plainly what
  processing does when *not* disabled: `"Expires", "Cache-Control",
  "Set-Cookie", and "Vary" set the parameters of response caching."`
  (https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ignore_headers)
- `proxy_cache_valid` documents the exact `Vary` behavior: *"If the header
  includes the 'Vary' field with the special value '\*', such a response will
  not be cached (1.7.7). If the header includes the 'Vary' field with another
  value, such a response will be cached taking into account the
  corresponding request header fields (1.7.7)."*
  (https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_valid)

**Conclusion**: nginx does exactly what RFC 9111 requires of a conformant
cache (see §4 below) — for a response carrying `Vary: Accept-Encoding`, it
caches a distinct entry per distinct value of the client's `Accept-Encoding`
header. Our own cache (`rss_cache`, `proxy_cache_key` default
`$scheme$proxy_host$request_uri`) does **not** currently incorporate
`Accept-Encoding` into the key explicitly, but because upstream sends `Vary:
Accept-Encoding` and it is not in our `proxy_ignore_headers` list, nginx
layers the client's `Accept-Encoding` onto the cache key internally per the
above. This is the direct mechanism by which our 5-minute TTL cache still
ends up serving whatever variant a given browser's `Accept-Encoding` string
last resolved to upstream — each distinct `Accept-Encoding` string is its own
cache lineage, independently warmed against Fastly's already-fragmented,
already-stale variant set.

**`proxy_ignore_headers Vary` would change this**: it disables nginx's own
Vary-driven fragmentation, collapsing all `Accept-Encoding` variants into one
cache entry keyed only by `proxy_cache_key`. But it does *not* touch what
Fastly does upstream — the request nginx sends upstream still carries
whatever `Accept-Encoding` the client sent (or whatever we override it to,
see §2), so it only fixes fragmentation on **our** side of the wire, not
Fastly's. Because Fastly is where the actual stale/fresh split lives (per the
bug's empirical repro — hitting anchor.fm directly reproduces the same
arbitrary split), `proxy_ignore_headers Vary` alone does not fix the bug; it
would just make our own cache consistently pick up *one* of Fastly's two
variants (whichever answers the specific `Accept-Encoding` string nginx
happens to send upstream) instead of splitting across both.

---

## 2. Normalizing `Accept-Encoding` upstream

**Source**: nginx.org, `ngx_http_proxy_module` (`proxy_set_header`),
`ngx_http_gzip_module`, `ngx_http_gunzip_module`.

- `proxy_set_header` documents exactly this pattern in its own example list:
  `proxy_set_header Accept-Encoding "";` — *"Removing a header field (empty
  string)."*
  (https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)
  Setting it to `""` (or to a fixed value like `"gzip"` or `"identity"`)
  means nginx sends the **same** `Accept-Encoding` string to Anchor/Fastly on
  every request, regardless of what the browser sent. Fastly then only ever
  sees one variant-selecting value from us, so it can only cache/serve one
  `Accept-Encoding`-keyed variant to us — collapsing the split at the source.
- Interaction with nginx's own gzip machinery: `gzip_proxied` (http gzip
  module) controls whether nginx **compresses its own response** to the
  proxied request based on response headers (`expired`, `no-cache`,
  `no-store`, `private`, `auth`, etc.) and is unrelated to what we request
  from upstream — a separate axis.
- `ngx_http_gunzip_module`: *"a filter that decompresses responses with
  'Content-Encoding: gzip' for clients that do not support 'gzip' encoding
  method... useful when it is desirable to store data compressed to save
  space and reduce I/O costs."* `gunzip on;` (`http`/`server`/`location`,
  default `off`; requires `--with-http_gunzip_module`).
  (https://nginx.org/en/docs/http/ngx_http_gunzip_module.html)

**What this means for our case, precisely**:

- If we force `proxy_set_header Accept-Encoding "";` we ask Anchor/Fastly for
  an **uncompressed** response (no `Content-Encoding`). That is the
  documented "removing a header field" pattern and it sidesteps compression
  entirely — nginx caches and re-serves a single plain-text variant to every
  client, and can gzip it back out to browsers itself via nginx's own
  standard `gzip` module (compression to the *client* is nginx's own concern,
  independent of what it received from upstream).
- If instead we forced `proxy_set_header Accept-Encoding "gzip";`, Anchor
  would send a gzip-compressed body. nginx would then be caching a
  gzip-encoded body (`Content-Encoding: gzip` from upstream, passed through).
  Per HTTP semantics, serving that gzip body unmodified to a client that did
  **not** send `Accept-Encoding: gzip` (rare among real browsers, but true of
  `curl` in the bug's own repro when the header is omitted) would be
  non-compliant: the client cannot decode it. The nginx-documented fix for
  exactly this scenario is `gunzip on;` — cache the compressed representation
  for storage efficiency, and let the gunzip filter transparently
  decompress it for any client that doesn't advertise gzip support,
  consulting `gzip_http_version`, `gzip_proxied`, and `gzip_disable` to
  decide who needs decompression. `gzip_vary` (default `off`) additionally
  controls whether nginx re-asserts `Vary: Accept-Encoding` on its own
  gzip/gunzip'd output — worth turning on if we want downstream caches
  (browsers) to remain compliant themselves.
- The empty-string form (`Accept-Encoding ""`) is the simpler and more
  direct fix for *this* bug: it removes compression variance entirely rather
  than caching one compressed variant and decompressing on the way out, so
  `gunzip` isn't even needed. It is nginx's own documented example for
  exactly this use case.

---

## 3. Can a client force Fastly to revalidate?

**Sources**: Fastly docs (`fastly.com/documentation`), RFC 9111 §5.2.1 /
§5.2.1.4.

- Fastly, "HTTP caching semantics" page, is explicit and directly on point:
  *"Request-side cache controls, such as the `Cache-Control` request header
  do not affect whether the readthrough cache will store the response."*
  (https://www.fastly.com/documentation/guides/concepts/edge-state/cache/cache-freshness/)
  There is no standard, VCL-free mechanism for a client to force
  revalidation of a Fastly-cached object. Fastly's "Temporarily disabling
  caching" guide confirms the *server-side* levers that do exist (per-URL
  cache settings, response headers configured in the Fastly control panel,
  a `vcl_recv` `return(pass);` snippet) — none of them are things our nginx,
  as an ordinary HTTP client of anchor.fm, can invoke.
  (https://www.fastly.com/documentation/guides/full-site-delivery/caching/temporarily-disabling-caching/)
- Fastly's "About cache-control headers" page additionally documents that on
  the **response** side (i.e., what Anchor's origin sends), `no-cache`,
  `no-store`, and `must-revalidate` are *"ignored and will not influence
  Fastly's caching, but will be passed through to the browser."* So even if
  Anchor's own origin wanted to defeat Fastly caching by sending those
  directives, Fastly's readthrough cache would ignore them; only
  `Surrogate-Control`, `Cache-Control: s-maxage`, `Cache-Control: max-age`,
  then `Expires`, in that priority order, govern Fastly's TTL.
  (https://www.fastly.com/documentation/guides/full-site-delivery/caching/about-cache-control-headers/)
- RFC 9111 confirms this is not Fastly being non-compliant: §5.2.1's
  introduction states *"This section defines cache request directives. They
  are advisory; caches MAY implement them, but are not required to."*
  §5.2.1.4 defines `no-cache` (request) as only an indication of client
  *preference* — *"the client prefers a stored response not be used to
  satisfy the request without successful validation on the origin
  server"* — not a mandate. A shared cache is fully spec-compliant in
  ignoring it.
  (https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.1,
  https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.1.4)

**Conclusion**: there is **no client-controllable, spec-blessed mechanism
that a CDN is obligated to honor** to defeat a shared cache's stored
response. RFC 9111 makes request `Cache-Control: no-cache` advisory, and
Fastly's own docs confirm their readthrough cache does not act on it. Any
"cache-buster" approach that relies on request headers reaching Anchor and
influencing Fastly is building on a mechanism neither the spec nor Fastly's
docs promise will work, and Fastly's docs affirmatively say it won't (for
their default service configuration, which we do not control or configure —
Anchor/Spotify does).

---

## 4. RFC 9110/9111 — the robust way to avoid `Vary: Accept-Encoding`
   fragmentation

**Sources**: RFC 9110 §12.5.5 (Vary), RFC 9111 §4 / §4.1, nginx.org gzip/gunzip
docs (cross-referenced above).

- RFC 9110 §12.5.5: *"the Vary field value indicates the set of request
  header fields that have a bearing on the generation of the response
  representation"* — i.e., `Vary: Accept-Encoding` is the origin/CDN telling
  every downstream cache "store me separately per distinct Accept-Encoding
  you saw." This is doing exactly what the spec says it should.
  (https://www.rfc-editor.org/rfc/rfc9110.html#name-vary)
- RFC 9111 §4 requires a cache to match "request header fields nominated by
  the stored response" before reuse — this is the general mechanism (not
  Accept-Encoding-specific) that makes any `Vary`-fragmented cache correct
  but also brittle to *how many distinct values* of the varied header
  actually show up on the wire. A client population sending highly varied
  `Accept-Encoding` strings (as real browsers do — `gzip`, `gzip, deflate`,
  `gzip, deflate, br`, `gzip, deflate, br, zstd`, per browser/version) turns
  one logical resource into many cache lineages, each independently
  freshness-tracked, exactly the failure mode observed here.
  (https://www.rfc-editor.org/rfc/rfc9111.html#section-4)
- Normalizing `Accept-Encoding` before the request reaches the
  Vary-respecting cache is the standard, documented pattern for exactly this
  pitfall — it's why nginx ships `proxy_set_header Accept-Encoding ""` as a
  worked example and ships `gunzip`/`gzip_vary` as the compliant fallback
  when normalizing to a *non-empty* fixed encoding instead. The pitfall
  documented on the nginx side is real but narrow: if you normalize to a
  non-identity encoding (e.g., force `gzip`) you must either re-decompress
  for non-gzip clients (`gunzip on;`) or accept you're now serving an
  encoding some clients can't read — normalizing to identity (`""`) sidesteps
  this pitfall entirely, at the cost of losing upstream compression (which we
  can restore ourselves to the client via nginx's own `gzip on;`, an
  independent, well-understood axis).

**Conclusion**: normalizing the outbound `Accept-Encoding` is the
RFC-consistent, nginx-documented pattern. It does not violate any MUST in
RFC 9110/9111 — Vary-based fragmentation is itself correct behavior for a
cache that receives varying `Accept-Encoding` values; the fix is to stop
presenting varying values, not to defeat `Vary` handling.

---

## 5. Cache-buster query string on the upstream URL

**Sources**: RFC 9111 §4.2.2 (URI-based caching / query strings), Fastly
docs on cache key composition.

- RFC 9111 §4.2.2 notes an earlier HTTP version *"prohibited caching for URIs
  with query components... In practice, this has not been widely
  implemented. Therefore, origin servers are encouraged to send explicit
  directives (e.g., either Cache-Control: no-cache or Cache-Control:
  max-age=0) if they wish to preclude caching."* — i.e., the spec does not
  exempt query strings from caching by default; a query string is just part
  of the URI/cache key unless the origin says otherwise.
- Fastly documents its default cache key explicitly: the readthrough cache's
  default hash includes `req.url` (path **and** query string) plus the
  `Host` header — *"differences in hostname and query string cause Fastly to
  treat these as separate objects."* Fastly separately documents
  `querystring.sort` and "Making query strings agnostic" as the supported
  way to *normalize away* query-string variance when you *don't* want cache
  fragmentation by query string.
  (https://www.fastly.com/documentation/reference/vcl/subroutines/hash/,
  https://docs.fastly.com/en/guides/making-query-strings-agnostic)

**Conclusion**: appending a rotating/random query parameter to the
**upstream** URL (e.g. `?_=<timestamp>`) is exactly the documented behavior
of a Fastly cache key — a distinct query string is a distinct cache object,
so each such request would be a guaranteed cache MISS at Fastly and force a
fetch from Anchor's true origin. This is not an "anti-pattern" per se
(cache-busting query strings are a long-standing, widely-understood technique
precisely because default cache keys include the query string, per both RFC
9111 and Fastly's own docs) but it is also not something either primary
source frames as an *endorsed* pattern for legitimate traffic — Fastly's own
documented tooling in this area (`querystring.sort`, "making query strings
agnostic") is about **collapsing** query-string cache fragmentation, not
manufacturing it. Cache-busting works by deliberately defeating the shared
cache, which has a direct cost: **every** request from our nginx to Anchor
would MISS Fastly's cache and hit Anchor's true origin, on every poll of our
own 5-minute TTL — i.e., we would be doing to Anchor/Fastly exactly the kind
of uncached-origin hammering CDNs exist to prevent. Anchor/Spotify does not
publish a rate limit or ToS position on this in anything we have access to;
it is a real, if diffuse, risk of being throttled or blocked, not something
either RFC 9111 or Fastly's docs can bound for us.

---

## 6. Which fix is architecturally clean and permanent, per ADR 0006 / 0014

**Constraints restated**: nginx-config-only (no app server/DB/per-request
logic — ADR 0006), staleness budget 5–10 min at every layer (ADR 0006),
Anchor upstream must never be load-bearing at nginx boot — already satisfied
by the variable `proxy_pass` + `resolver` pattern in
`cinemaslime-rss-location.conf`, and any fix must preserve that (ADR 0014).

### Option A — Normalize `Accept-Encoding` upstream: `proxy_set_header Accept-Encoding "";`

- **Mechanism**: nginx.org's own documented pattern (§2 above). One line,
  inside the existing `location = /api/rss` block. No new directive classes,
  no boot dependency change — `resolver`/variable `proxy_pass` untouched.
- **Guarantee**: nginx will send Anchor/Fastly a single, constant
  `Accept-Encoding` value on every request we make, for as long as our
  process makes the request — this is a direct, spec-grounded consequence of
  `proxy_set_header` semantics (nginx.org), not inference. That collapses
  our *own* cache to one `Accept-Encoding`-keyed lineage and, more
  importantly, means Fastly only ever sees one `Accept-Encoding` value *from
  us*, so it can only serve *us* one of its variants consistently — the
  reversed/arbitrary flip the bug describes between two different
  `Accept-Encoding` strings goes away for our traffic specifically.
- **What it does NOT guarantee**: it does not guarantee that *the one*
  Fastly variant we now consistently land on is fresh within 5–10 minutes.
  Fastly's own `s-maxage` (~7 days, set by Anchor's origin, outside our
  control) and Anchor's incomplete purge-on-publish behavior (empirically
  observed, not documented anywhere we can cite) are still in play for
  *that* variant. If the variant we consistently hit happens to be a stale
  one, we consistently get staleness — just consistent staleness instead of
  the current coin-flip. This is a **best-effort, not-guaranteed** fix for
  the staleness *budget*; it is a **guaranteed** fix for the *inconsistency/
  variant-fragmentation* mechanism, which is the mechanism the bug report
  actually diagnosed.
- Combine with `gzip on;` locally (nginx compresses to the browser itself)
  to avoid losing the bandwidth benefit of compression — an orthogonal,
  well-documented nginx capability, not coupled to the upstream fix.

### Option B — `proxy_ignore_headers Vary` on our side only

- **Mechanism**: nginx.org, `proxy_ignore_headers` (§1 above).
- **Guarantee**: stops our *own* nginx cache from fragmenting per
  `Accept-Encoding`. Does nothing about Fastly's fragmentation upstream,
  since it doesn't change what `Accept-Encoding` we send to Anchor. We'd
  still be pinned to whichever Fastly variant our (still browser-driven,
  still-forwarded) request happens to land on if this is applied alone.
- **Verdict**: strictly weaker than Option A for this bug; only useful in
  combination with Option A (once we're only ever sending one
  `Accept-Encoding` upstream, ignoring `Vary` on our side is redundant but
  harmless — the cache key collapses either way).

### Option C — Cache-buster query string on the upstream Anchor URL

- **Mechanism**: RFC 9111 §4.2.2 + Fastly's documented default cache key
  (query string included) — §5 above.
- **Guarantee**: each of our own polls (bounded by our 5-minute
  `proxy_cache_valid`) would MISS Fastly and hit Anchor's true origin,
  which — assuming Anchor's true origin itself is not similarly stale/lagged
  — would make our 5-minute TTL a genuine, spec-traceable upper bound on
  staleness, closing the gap Option A cannot close.
- **Failure mode**: guarantees nothing about Anchor's own origin freshness
  (undocumented, outside our visibility) or about Anchor/Spotify's tolerance
  for a client that defeats their CDN on every request — no rate-limit
  policy is published anywhere we could find, so this risk is real but
  unbounded/unquantifiable from primary sources. It also increases load on
  Anchor's true origin proportionally to our own polling cadence (bounded
  today by our 5-minute cache, so bounded but nonzero).

### Ranked recommendation

1. **Option A (normalize `Accept-Encoding` upstream to `""`) is the
   architecturally clean, permanent, ADR-compliant fix for the diagnosed
   bug.** It is a single nginx directive, matches ADR 0006's "nginx-config
   only" constraint exactly, does not touch the variable-`proxy_pass`/
   resolver machinery ADR 0014 requires, and its mechanism is directly
   documented by nginx.org rather than inferred. It resolves the
   *fragmentation/inconsistency* mechanism the bug report empirically
   diagnosed with a spec-grounded guarantee (§2). Pair it with `gzip on;` to
   keep compression to the browser.
2. Consider Option C (cache-busting query string) **only if**, after
   shipping Option A, the single Fastly variant we consistently land on is
   still found to be stale beyond the 5–10 min budget — i.e., treat it as an
   escalation, not a first move, because its guarantee is real (documented
   cache-key behavior) but its cost (defeating Anchor's CDN on every poll,
   with no published rate-limit ceiling) is unbounded and outside anything
   RFC 9111 or Fastly's docs can promise is safe.
3. Option B has no standalone value here; fold it in only as an accompanying
   no-op safety net if Option A is applied.

### Honest guarantee ledger

**Guaranteed by primary sources**:
- nginx will send one constant `Accept-Encoding` upstream after Option A
  (nginx.org `proxy_set_header` semantics).
- That collapses our own cache to one lineage and removes the
  reversed/arbitrary per-encoding split from our traffic (direct consequence
  of the above plus nginx.org's documented `Vary` handling in
  `proxy_cache_valid`).
- A cache-busting query string (Option C) is a documented MISS-forcing
  mechanism at Fastly (Fastly's own cache-key docs) and is not prohibited by
  RFC 9111.

**NOT guaranteed — best-effort, dependent on parties we don't control**:
- That the single Fastly variant we land on (Option A) is fresh within 5–10
  minutes. This depends entirely on Anchor's purge-on-publish behavior,
  which is undocumented and empirically observed to be incomplete. No
  primary source promises this.
- That Anchor's true origin (behind Fastly, reached only via Option C) is
  itself fresh within 5–10 minutes, or that hammering it with cache-busted
  requests is tolerated long-term. No published Anchor/Spotify rate-limit or
  ToS statement was found to cite either way.
- Neither option can make the 5–10 min budget a hard guarantee, because the
  budget's true dependency is Anchor's publish→purge latency, which sits
  entirely outside nginx, Fastly's documented client-facing controls, and
  the RFCs governing them.

---

## 7. Flagged follow-up: does `/api/essays/*` share this staleness class?

Not deep-dived, per instructions, but worth flagging: `/api/essays/curation`
and `/api/essays/events` (ADR 0008, `docs/deploy/nginx-essays-proxy.md`)
proxy to `api.nostr.band` with `proxy_ignore_headers Cache-Control Expires`
(note: **not** `Vary`) and a 5-minute `proxy_cache_valid`. If
`api.nostr.band` sends a `Vary` header naming any header that varies across
real clients (e.g. `Accept-Encoding`, `Accept`, or an auth-adjacent header),
the same fragmentation mechanism diagnosed here for `/api/rss` would apply:
our cache would fragment per that header, and if nostr.band's own edge/CDN
(if any) has a similarly long `s-maxage` with imperfect purge, the essays
snapshot could exhibit the same class of stale-per-variant symptom. This
was not verified empirically (no live header capture was taken for
`/api/essays/*` in this investigation) and is flagged as a candidate for the
same empirical repro (`curl` with varying `Accept-Encoding`) rather than
assumed.
