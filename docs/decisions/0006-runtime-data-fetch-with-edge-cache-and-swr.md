# Runtime data fetch with an nginx edge cache and browser stale-while-revalidate

**Date**: 2026-06-03
**Status**: accepted
**Context**: The site felt slow and unreliable. The root cause was diagnosed as *how* external data is fetched, not *that* it is fetched live. This ADR records the decision to keep all data fetching at runtime (no build-time snapshotting) while making the site feel instant, by moving the RSS fetch behind a caching reverse-proxy on the nginx we already run and adding browser-side stale-while-revalidate. It supersedes the implicit "race public CORS proxies on the critical path" approach from the Episode Pages era.

---

## Context / problem

Two external data sources feed the site, both fetched in the browser on every page load:

- **Episodes** — the Anchor RSS feed, fetched by *racing a direct request against three public CORS proxies* (`corsproxy.io`, `allorigins.win`, `codetabs.com`). This `await fetchRSS()` **blocked the entire initial render** behind a full-page loader.
- **Essays / curation / social proof** — four Nostr relays via `nostr-tools` `SimplePool`, already loaded in the background without blocking Episodes (ADR 0002, decision #8).

The Episode path was the problem: the slowest, least reliable dependency on the page (three public proxies we neither control nor pay for, which rate-limit and frequently go down) sat on the critical render path and gated the whole site.

The owner holds two values that appear to conflict:

1. **No backend.** A frontend with external data sources. Concretely (resolved during grilling): no application server, no database, no per-request app logic, no state we own. Configuring the nginx droplet we *already operate* (`/var/www/cinemaslime/html`) is fair game; standing up an app process or DB is not.
2. **No rebuild on content change.** The deployed artifact must be a pure function of the code. New episodes and essays appear with **zero deploy**. Builds happen only when *functionality* changes; content flows through the built site at runtime.

The tension is only apparent. "Live data" was never what made the site slow — fetching it the slow way, on the critical path, through third parties was. Acceptable staleness was confirmed at **5–10 minutes for all three sources**, which licenses aggressive caching at every layer.

---

## Decisions

### 1. Keep all data fetching at runtime — no build-time snapshotting

Build-time SSG (fetch RSS/Nostr during CI, bake into the bundle, rebuild on a schedule) was the obvious snappiness fix and is **rejected**: it violates value #2. A scheduled rebuild couples content freshness to the deploy pipeline and makes the artifact a function of *content*, not just code. The artifact stays `f(code)`; content is fetched live.

### 2. Episodes fetched same-origin via an nginx caching reverse-proxy

Delete the three public CORS proxies. The browser fetches the RSS from our own origin; nginx `proxy_pass`es to Anchor, adds the CORS header, and caches the response (`proxy_cache`, ~5–10 min TTL) with `proxy_cache_use_stale` so a flaky or down upstream still serves the last good copy.

This is ~10 lines of nginx config on a box we already run — no application code, no database, no per-request logic. It removes the worst dependency from the critical path while keeping the fetch live and rebuild-free.

### 3. First paint never blocks on data

Render the static shell (nav, hero branding, section headers, skeleton cards) from the bundle immediately, then fill Episodes in when the fetch resolves — the same non-blocking background pattern Essays already use. The full-page `await fetchRSS()` gate is removed.

### 4. Browser-side stale-while-revalidate via `localStorage`

Cache last-known Episodes / Essays / curation in `localStorage`. On load, render the cached copy on the first frame (instant real content for returning visitors), then revalidate in the background and update if changed. Far-future `Cache-Control` on the hashed bundle sits underneath; short TTL on the proxied feed.

A **cache-version key tied to the build** guards against a future data-shape change making an old blob crash the render (stale-shaped cache is discarded, not parsed).

A **Service Worker + Cache API** was considered for transparent network-layer SWR and offline support, and **rejected**: real update-lifecycle footguns (users stranded on a stale worker — especially bad on a site that rebuilds rarely), and it cannot intercept Nostr's WebSocket traffic anyway, so `localStorage` SWR would still be needed for Essays. Offline reading is not a goal for a podcast site that needs the network to stream audio.

### 5. Revalidation is guarded against jank

When fresh data arrives, re-render only if (a) the data actually changed *and* (b) the user is not actively interacting (no live search text, not scrolled into the grid). Otherwise hold the fresh data and apply it on the next idle/navigation. Because content changes rarely (monthly episodes, infrequent essays), the "diff first, touch the DOM only on a real change" guard alone eliminates almost all churn; the interaction guard handles the rare real update without yanking scroll, search, or re-firing scroll animations.

### 6. Nostr stays client-side

Relays are `wss` — nginx cannot cache them, and a caching relay would be the stateful backend we are refusing. Nostr fetching remains client-side, background, non-blocking, and graceful-on-failure (ADR 0002 #8), and is SWR-cached like Episodes (decision #4). Stale-on-error already half-exists via graceful `null`.

---

## Consequences

- The deploy gains an nginx config dependency: the reverse-proxy/cache block (and CORS header) must exist on the droplet for Episodes to load. This is configuration, not an application — but it is now part of the contract, not just static file serving.
- The critical render path no longer depends on third parties we don't control. Worst case (Anchor down), nginx serves stale and the browser falls back to `localStorage`.
- Returning visitors get real content on the first frame; first-time visitors get shell + skeletons, then content.
- Up to 5–10 min of content staleness is accepted by design at every layer.
- `localStorage` becomes part of the data path; its shape is versioned to the build to stay forward-safe.
- No new domain language: everything here is implementation (proxy, cache, SWR). CONTEXT.md is unchanged.
- Build-time snapshotting and Service Workers are documented as rejected, with reasons, so the choice isn't relitigated by default.
