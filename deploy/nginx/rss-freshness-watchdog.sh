#!/usr/bin/env bash
# Cinema Slime — RSS freshness watchdog.
#
# WHY THIS EXISTS
# ---------------
# Episodes are served from /api/rss, an nginx proxy_cache in front of Anchor's
# Fastly-fronted feed (docs/deploy/nginx-rss-proxy.md, ADR 0006). The design
# promise is "no manual intervention when content changes" — a new episode must
# appear on the site on its own. In practice the published copy repeatedly got
# STUCK behind the live feed for far longer than the 5-minute TTL, and the only
# known cure was a manual rebuild/redeploy. Diagnosis (2026-08-12):
#
#   * The shipped `?_=$msec` cache-buster is INERT: Fastly ignores the query
#     string for this resource (a distinct query returns MISS,MISS,HIT of the
#     same stored object; only a distinct PATH forces a real MISS). So no
#     client-side directive can force-refresh a stale copy.
#   * With `proxy_cache_use_stale ... updating` + `proxy_cache_background_update`,
#     once the TTL expires nginx serves STALE while a background revalidation
#     runs; if that revalidation does not refresh the entry, the stale copy is
#     served indefinitely with no bound and no alarm. The human became the
#     error handler.
#
# WHAT THIS DOES
# --------------
# Enforce freshness from OUTSIDE nginx, so no single cache layer's bug can pin
# the site. Every run: read the latest episode id (newest <guid>) the live feed
# advertises, read the latest id OUR edge is currently serving, and if they
# differ, purge the nginx RSS cache entry and re-warm it — i.e. do automatically,
# on a timer, exactly what a manual rebuild did by hand. Self-heals the layer we
# control (our nginx cache); if Fastly itself is ever the stuck layer, each run
# re-pulls so we recover the instant Fastly does. Every run is logged, so a
# recurrence is visible in the journal instead of only in Scott's inbox.
#
# Safe by construction: it only ever PURGES + RE-WARMS (never serves or writes
# feed content itself), and it refuses to purge when it cannot read a trustworthy
# "truth" (an unreachable feed must not nuke a good last-known-good copy).
#
# Installed + scheduled by deploy/nginx/install-edge-config.sh as a systemd
# timer. Run manually any time:  rss-freshness-watchdog.sh  (add --verbose).

set -uo pipefail

FEED_URL="${RSS_FEED_URL:-https://anchor.fm/s/1050fb0e4/podcast/rss}"
EDGE_HOST="${RSS_EDGE_HOST:-cinemaslime.com}"
CACHE_DIR="${RSS_CACHE_DIR:-/var/cache/nginx/rss}"
VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

log() { echo "rss-watchdog: $*"; }
vlog() { [ "$VERBOSE" = 1 ] && log "$*"; return 0; }

# Newest episode id = the first <guid> in a reverse-chronological feed. Reading
# the id (not item count) makes the signal sharp: it changes on exactly the
# event we care about — a new/edited latest episode.
latest_guid() { grep -oiE '<guid[^>]*>[^<]+' | head -1 | sed -E 's/^<guid[^>]*>//' | tr -d ' \t\r\n'; }

# TRUTH: the freshest copy reachable — Anchor's current Fastly object. Identity
# encoding to match how nginx fetches; short timeouts so a slow feed never wedges
# the timer.
truth_xml="$(curl -fsS --max-time 20 -H 'Accept-Encoding: identity' "$FEED_URL" 2>/dev/null)"
truth_guid="$(printf '%s' "$truth_xml" | latest_guid)"

if [ -z "$truth_guid" ]; then
  # Cannot establish truth (feed down/blip). Do NOT purge — last-known-good must
  # stand. This is the graceful-degradation path, not a failure to act on.
  log "SKIP: could not read a trustworthy feed from $FEED_URL (leaving cache intact)"
  exit 0
fi

read_edge_guid() {
  curl -fsS --max-time 15 --resolve "$EDGE_HOST:443:127.0.0.1" \
    "https://$EDGE_HOST/api/rss" 2>/dev/null | latest_guid
}

edge_guid="$(read_edge_guid)"
vlog "edge=$edge_guid truth=$truth_guid"

if [ "$edge_guid" = "$truth_guid" ]; then
  vlog "OK: edge matches feed ($truth_guid)"
  exit 0
fi

log "STALE: edge serving '$edge_guid' but feed advertises '$truth_guid' — purging + re-warming"

# Purge the single /api/rss entry. The zone holds only this resource, so a whole-
# zone file delete is the entry purge. nginx treats the now-missing file as a
# MISS on the next request (safe while running; this is the manual-purge idiom).
find "$CACHE_DIR" -type f -delete 2>/dev/null

# Re-warm immediately so the next real visitor gets fresh, not a cold MISS.
rewarmed_guid="$(read_edge_guid)"

if [ "$rewarmed_guid" = "$truth_guid" ]; then
  log "HEALED: edge now serving '$rewarmed_guid'"
  exit 0
fi

# Purge+rewarm did not converge: the stale copy is NOT in our nginx — the
# freshest reachable copy (Fastly) is itself behind. Nothing client-side can fix
# that; surface it loudly and let the next run retry (it heals when Fastly does).
log "ESCALATE: re-warm still '$rewarmed_guid' vs feed '$truth_guid' — upstream (Fastly/Anchor) is the stale layer, not our cache"
exit 0
