# A third-party gateway is never load-bearing — for readers or for deploys

**Date**: 2026-07-25
**Status**: accepted
**Amends**: ADR 0008 (same-origin edge-cached Essays endpoint)
**Context**: ADR 0008 introduced `api.nostr.band` as an HTTP gateway in front of the Nostr relay network, on the explicit premise that it is an *accelerator* — "the relay path remains the source of truth… the HTTP gateway is an additional, faster snapshot source." On 2026-07-25 the gateway went down for hours, and it turned out to be load-bearing in three separate places that nobody had noticed. This ADR records the fixes that make ADR 0008's premise true rather than merely intended.

---

## Context / problem

api.nostr.band stopped accepting TCP connections. Every one of its hostnames (`api.`, `relay.`, and the apex) was unreachable; DNS resolved fine, the handshake never completed. Three failures followed, in increasing order of severity:

1. **The deploy was blocked.** `npm run verify:edge` (the pre-cutover gate) failed on two 504s and exited 1, blocking a release whose contents had nothing to do with Essays.
2. **Serve-stale did not save us.** ADR 0008 promised "a flaky or down upstream still serves the last good copy". `proxy_cache_use_stale` was configured correctly, but the cache zone's `inactive=60m` had *deleted the entries* — `inactive` is an eviction timer, not a TTL, and it silently capped the serve-stale guarantee at one hour.
3. **The site showed a blank page for a full minute.** This was the real damage. `init()` in `src/main.js` did `await fetchEssaysSnapshot()` — a bare `fetch` with **no timeout** — *before* `setupRouter()` and `renderCurrentView()`. nginx sat on its default 60s `proxy_connect_timeout`, so every cold visitor got sixty seconds of nothing, on every page of the site.

The bitterest detail: **the Essays were fine the whole time.** Queried directly during the outage, `wss://nos.lol` served the curation list and all three essays, and `wss://relay.damus.io` served the essays. The distributed fallback that ADR 0008 said was the source of truth was working perfectly and was never given the chance to run, because a blocking `await` on the accelerator ran first.

---

## Decision

### 1. The snapshot fetch is time-boxed (`src/main.js`)

`fetchEssaysSnapshot()` now passes an `AbortSignal.timeout(ESSAYS_SNAPSHOT_TIMEOUT_MS)` — 2500 ms — shared by both requests. On timeout it returns `null`, which is the failure path the code already had, and `init()` proceeds to render and to the relay fetch.

The budget is sized against what the snapshot is *worth*: the edge cache answers a hit in well under 50 ms, and a snapshot slower than a couple of seconds has already lost to the relays it exists to beat. An accelerator that can stall the first paint is not an accelerator.

### 2. The edge fails fast (`cinemaslime-essays-location.conf`)

`proxy_connect_timeout 3s`, `proxy_send_timeout 5s`, `proxy_read_timeout 5s` on both `/api/essays/*` blocks, replacing nginx's 60s defaults. A dead upstream now costs a reader three seconds at the edge instead of a minute, and the failure reaches `proxy_cache_use_stale` fast enough to be useful.

### 3. The serve-stale horizon is 30 days (`cinemaslime-essays-cache.conf`)

`inactive=60m` → `inactive=30d`. Freshness is still governed by `proxy_cache_valid 200 5m`; `inactive` is purely how long a cold entry survives on disk before nginx deletes it, and a deleted entry is one serve-stale cannot serve. 30d means the gateway can be gone for a month and readers still get the last good snapshot. The zone is capped at `max_size=10m`, so the longer horizon costs nothing.

### 4. The gate distinguishes our faults from theirs (`src/edge-contract.js`)

`classifyCheckOutcome` sorts every failing check into `fatal` or `degraded`. A check is downgraded to `degraded` — reported loudly, but not setting the exit code — only when **all three** hold:

1. the check declares an `upstream` (only the proxied Essays endpoints do);
2. the verifier **independently confirmed on that run** that the upstream is unreachable;
3. nginx answered with a status it only produces when the upstream failed (502/503/504).

Everything else stays fatal. In particular a **200 `text/html`** — the SPA shell, the missing-`location`-block bug the gate was written for — is fatal no matter how dead the upstream is. This is the narrowest downgrade that unblocks the deploy, and it is deliberately narrow: `verdictArtworkDerivative` already warns that silently degrading a check whose input is missing is how this site rotted in the first place, and that warning is correct.

`parseProxyPassHosts` reads the probed host out of the committed nginx config so `ESSAYS_UPSTREAM` and the real `proxy_pass` target cannot drift apart; a unit test asserts they agree.

---

## Consequences

- **A third-party outage degrades the site instead of breaking it.** Cold visitors wait at most 2.5 s for the snapshot, then get Essays from the relay network — which, as the outage demonstrated, generally has them.
- **A third-party outage no longer blocks releases.** The gate reports `⚠️ Edge contract holds, with a third-party gateway down` and exits 0.
- **The gate's teeth are unchanged for config rot.** Every failure mode it was built to catch — SPA shell, missing location, un-downscaled artwork, undersized buffer — is still fatal, including during an outage.
- **The relay set is now known to be uneven.** During the outage only `nos.lol` carried the kind:30001 curation list; damus had the essays but not the list, and primal had neither. The curation list therefore has a redundancy of **one**. That is a real single point of failure in the layer we just made load-bearing, and it is not addressed here — see the open question below.
- **ADR 0008's gateway selection is unchanged.** nostr.band remains the right choice; the alternatives it rejected were rejected on grounds this outage does not affect. The lesson is not "pick a better gateway", it is "do not let any gateway be load-bearing".

## Open question

The curation list resolves from exactly one of the four `DEFAULT_RELAYS`. Publishing it to more relays (`npm run publish:curation` targets) would give the fallback path the redundancy the fallback path is supposed to provide. Deferred: it is a curation-workflow change, not an edge change.
