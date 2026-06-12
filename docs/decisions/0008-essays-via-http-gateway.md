# Same-origin edge-cached Essays endpoint — amending ADR 0006 decision #6

**Date**: 2026-06-12
**Status**: accepted
**Amends**: ADR 0006, decision #6 ("Nostr stays client-side")
**Context**: ADR 0006 kept all Nostr fetching client-side because "relays are `wss` — nginx cannot cache them." That was the right call for the initial Episodes/Essays architecture. This ADR records the decision to add a thin nginx caching layer in front of the Nostr relay path for Essays — the same move ADR 0006 decision #2 already made for Episodes and the RSS feed. It does not replace client-side relay fetching; it adds a faster same-origin snapshot ahead of it.

---

## Context / problem

ADR 0007 reduced the cold-load spinner from 14–19 s to ~5 s by settling relay queries on the first quiet moment rather than waiting for every relay's EOSE. That is a meaningful improvement but still leaves a multi-second spinner on every cold deep-link (no `localStorage` cache) and on every first visit after a deploy (the Essays cache is keyed to a data-shape version that survives deploys, but a brand-new browser still has an empty cache).

ADR 0006 decision #2 already proved the pattern for Episodes: an nginx `proxy_cache` block in front of the Anchor RSS feed made cold Episode loads instant with zero application code. Essays do not have a comparable same-origin HTTP source — Nostr is WebSocket-only at the relay layer — but there are third-party Nostr HTTP gateways that bridge between HTTP and the Nostr relay network. The same nginx-only proxy approach applies.

The owner constraints from ADR 0006 remain binding:

1. **No application server.** nginx configuration on the droplet we already operate is fair game; standing up an application process, database, or self-operated caching relay is not.
2. **No rebuild on content change.** The deployed artifact stays a pure function of code; content flows live through the built site at runtime.

---

## Decision

### Add two same-origin nginx-cached endpoints under `/api/essays`

Two nginx `location` blocks (see `deploy/nginx/cinemaslime-essays-location.conf`) proxy to a third-party Nostr HTTP gateway and cache the JSON response using a new `essays_cache` zone (see `deploy/nginx/cinemaslime-essays-cache.conf`):

- **`/api/essays/curation`** — fetches the brand's kind:30001 curation list event (one event; coordinates never change; the URL is deterministic from brand pubkey + d-tag).
- **`/api/essays/events`** — fetches kind:30023 long-form essay events from the curated essay authors (currently two pubkeys; updated when new essay authors are added to the curation list).

Both blocks share a single `proxy_cache_path` zone (`/var/cache/nginx/essays`), a 5-minute `proxy_cache_valid 200` TTL, and `proxy_cache_use_stale error timeout updating http_5xx` so a flaky or down upstream still serves the last good copy. `proxy_cache_background_update on` keeps the cache warm without blocking in-flight requests.

The browser then fetches these same-origin paths instead of racing the four WebSocket relay connections on the cold paint path. The existing Nostr `wss` fetchers revalidate in the background and apply changes under the existing revalidation guards (ADR 0006 decision #5, `revalidation-policy.js`).

### Gateway selection: api.nostr.band

**nostr.band** (`api.nostr.band`) is selected as the upstream Nostr HTTP gateway.

**Why nostr.band:**
- nostr.band indexes virtually all Nostr events and already serves the Cinema Slime brand's events reliably — the same operator runs `relay.nostr.band`, one of the four relays in the app's `DEFAULT_RELAYS` set. ADR 0007 confirmed that this relay serves the curation list and essay events (unlike relay.damus.io, which returns zero events for kind:30001).
- The `api.nostr.band` HTTP endpoint provides a REST search interface for querying indexed events: `GET /v0/search/events?q=<filter-terms>&limit=<n>`. The query syntax supports `kind:<n>`, `author:<hex>`, and `#d:<value>` filters in a URL-safe form — exactly what both endpoints need.
- nostr.band is a commercial Nostr data infrastructure product with multi-year uptime history; it is not an ephemeral hobbyist service.
- serve-stale is the primary reliability guarantee regardless of gateway; we accept up to one cache-miss interval of gateway-dependent latency.

**Alternatives considered:**
- *nostr.wine search API* — excludes kind:30001 from its public event stream. A hard blocker for the curation endpoint.
- *njump.me* — renders Nostr content as HTML; no documented JSON/raw-event API.
- *nostrhttp.com* — an HTTP-to-relay bridge with the right GET-based interface, but the service was unreachable during evaluation (ECONNREFUSED). Rejected on reliability grounds; serve-stale would help but an unreachable service cannot warm the initial cache.
- *Self-operated relay with HTTP query support* — would require running an application process, violating owner constraint #1.
- *Build-time snapshot* — violates owner constraint #2 (rejected by ADR 0006 decision #1).

**Known operational requirement:** When a new essay author is added to the curation list (via `npm run publish:curation`), their hex pubkey must also be added to the `author:…` terms in the `/api/essays/events` proxy_pass URL and nginx reloaded. This is a one-line config update alongside the curation publish — a deliberate operational coupling that keeps the nginx config authoritative about which authors are in scope, rather than making it dynamically dependent on the curation event itself.

---

## Consequences

- **Cold deep-links become instant.** A browser with an empty localStorage cache fetches both `/api/essays/curation` and `/api/essays/events` same-origin (fast) on the first paint. The relay path revalidates in the background.
- **Post-deploy cold starts eliminated.** The `localStorage` Essays cache is now seeded from the snapshot endpoint rather than the relay path, so a deploy no longer cold-starts every reader's cache.
- **New nginx dependency.** The Essays experience now depends on the `essays_cache` nginx block being installed and the api.nostr.band upstream being reachable at least once per cache cycle. Both configs are committed in `deploy/nginx/`.
- **Author list in two places.** Essay author pubkeys appear in both `scripts/publish-curation.mjs` (as essay coordinates) and `deploy/nginx/cinemaslime-essays-location.conf` (as gateway filter params). Adding a new essay author requires updating both. This coupling is documented as the operational procedure in `docs/deploy/nginx-essays-proxy.md`.
- **Third-party HTTP gateway dependency introduced.** api.nostr.band is now on the critical path for cold loads; serve-stale ensures warm visits and subsequent warm loads are unaffected by gateway unavailability.
- **Decision #6 of ADR 0006 is superseded.** "Nostr stays client-side" was the right default to get the architecture in place; this amendment makes Essays as fast as Episodes without violating either owner constraint. The relay path remains the source of truth and the background-revalidation channel; the HTTP gateway is an additional, faster snapshot source.
- **No domain language change.** CONTEXT.md is unchanged; this is an implementation concern.
