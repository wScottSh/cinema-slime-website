#!/usr/bin/env bash
#
# Cinema Slime — idempotent installer for the droplet's edge (nginx) config.
#
# ── Why this file exists ──────────────────────────────────────────────────────
#
# The nginx box was always *meant* to be CI-managed, but for a long time it was
# not: deploy/nginx/*.conf were committed to the repo and docs/deploy/*.md told a
# human to scp them and paste location blocks into the vhost by hand. Nothing
# enforced that any of it had actually happened. Two silent production failures
# came out of that gap on 2026-07-25:
#
#   * The entire ADR 0013 artwork config was simply absent, so every
#     /api/art/ request 404'd site-wide. The client degrades to a dark
#     placeholder, so nothing looked broken — it just looked empty.
#   * The ADR 0008 essays config had NEVER been applied at all, so
#     /api/essays/curation and /api/essays/events returned 200 text/html (the
#     SPA shell) instead of JSON. The edge-cached snapshot has therefore never
#     worked in production; the site silently fell back to the slow relay path.
#
# Both failure modes are invisible from the outside, which is exactly why the
# "a human will remember to paste it" model cannot be trusted. This script makes
# the repo the single source of truth for the server's edge config and runs on
# every deploy, so config drift is repaired before the client that depends on it
# is cut over.
#
# ── How it is invoked ─────────────────────────────────────────────────────────
#
# From .github/workflows/deploy-live.yml, after scp'ing deploy/nginx/ to a temp
# dir on the box (payload alongside the script — much easier to read and audit
# than embedding every .conf in a heredoc):
#
#   scp -r deploy/nginx "$USER@$HOST:/tmp/cinemaslime-edge.$$"
#   ssh "$USER@$HOST" 'bash -s -- --payload /tmp/cinemaslime-edge.$$' \
#       < deploy/nginx/install-edge-config.sh
#
# Locally, for review, from the repo root:
#
#   bash deploy/nginx/install-edge-config.sh --dry-run --payload deploy/nginx
#
# ── Design rules this script must never break ─────────────────────────────────
#
# 1. ORDERING. nginx picks the FIRST matching regex location in file order. A
#    derivative URI ends in .jpg and the vhost carries a static-asset regex
#    location (`location ~* \.(js|css|png|jpg|...)$`) after `location / {`. So
#    the managed include block MUST land BEFORE `location / {`. This is not
#    cosmetic: getting it wrong 404s every derivative, silently.
# 2. CERTBOT. Certbot owns the ssl_*/listen 443 lines in the vhost. This script
#    only ever inserts/replaces its own clearly-delimited marker block and
#    removes location blocks it is taking ownership of. It never rewrites,
#    reorders, or regenerates the file wholesale.
# 3. FAIL CLOSED. `nginx -t` runs before any reload. On failure the previous
#    state (vhost AND every managed conf) is restored and the script exits
#    non-zero WITHOUT reloading, so a bad config can never reach live traffic.
#
# Every path is overridable by environment variable. That is not a test hack: it
# is the only way the vhost-rewriting logic — the genuinely risky part — can be
# exercised against fixtures without touching the production box.

set -euo pipefail

# ── Configuration (all overridable, for fixture-based testing) ────────────────
VHOST="${EDGE_VHOST:-/etc/nginx/sites-available/cinemaslime.com}"
CONFD="${EDGE_CONFD:-/etc/nginx/conf.d}"
SNIPPETS="${EDGE_SNIPPETS:-/etc/nginx/snippets}"
BACKUP_ROOT="${EDGE_BACKUP_ROOT:-/var/backups/cinemaslime-edge}"
NGINX_TEST_CMD="${EDGE_NGINX_TEST_CMD:-nginx -t}"
NGINX_RELOAD_CMD="${EDGE_NGINX_RELOAD_CMD:-systemctl reload nginx}"
# Set to 1 in fixture tests, where there is no apt and no nginx to install into.
SKIP_PACKAGES="${EDGE_SKIP_PACKAGES:-0}"
# The cache owner. nginx creates cache dirs itself at startup, but only if it can
# write the parent; creating them up-front with the right owner removes that
# dependency and any "permission denied" surprise on first request.
NGINX_USER="${EDGE_NGINX_USER:-www-data}"
# Prepended to every proxy_cache_path directory. Empty in production (the paths
# in the conf files are already absolute); set to a temp dir by the fixture tests
# so they never try to mkdir under /var.
CACHE_PREFIX="${EDGE_CACHE_PREFIX:-}"
# Where the systemd drop-in that makes nginx self-heal after a boot-time
# `[emerg]` gets written. Overridable so the fixture tests can point it at a
# temp dir instead of the real systemd unit tree.
SYSTEMD_DROPIN_DIR="${EDGE_SYSTEMD_DROPIN_DIR:-/etc/systemd/system/nginx.service.d}"
# Run whenever the drop-in is written or changed, same as NGINX_RELOAD_CMD.
# Overridable so the fixture tests can point it at a no-op/logging shim instead
# of touching the real systemd daemon.
SYSTEMCTL_DAEMON_RELOAD_CMD="${EDGE_SYSTEMCTL_DAEMON_RELOAD_CMD:-systemctl daemon-reload}"
# Where the RSS freshness watchdog (script + systemd timer) is installed. The
# watchdog purges + re-warms the /api/rss cache when the published feed falls
# behind the source, so the site self-heals without a manual rebuild (see
# rss-freshness-watchdog.sh). Dirs are overridable so fixture tests can point at
# temp dirs instead of the real system trees.
WATCHDOG_BIN_DIR="${EDGE_WATCHDOG_BIN_DIR:-/usr/local/bin}"
SYSTEMD_UNIT_DIR="${EDGE_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
# Enables/starts the watchdog timer. Overridable to a no-op shim in tests.
SYSTEMCTL_CMD="${EDGE_SYSTEMCTL_CMD:-systemctl}"

# Everything this script owns is prefixed so it can be told apart from anything
# else on the box (and so a removed repo file can be reaped — see sync_dir).
MANAGED_PREFIX="cinemaslime-"
# ADR 0013's GD-backed resize module. The package drops its own `load_module`
# line into /etc/nginx/modules-enabled/, which nginx.conf includes from the main
# context, so there is nothing to hand-edit after installing it.
IMAGE_FILTER_PKG="libnginx-mod-http-image-filter"

MARKER_START="# >>> cinemaslime managed by CI >>>"
MARKER_END="# <<< cinemaslime managed by CI <<<"

DRY_RUN=0
PAYLOAD_DIR="${EDGE_PAYLOAD_DIR:-}"

usage() {
    cat <<'USAGE'
Usage: install-edge-config.sh [--payload DIR] [--dry-run]

  --payload DIR  Directory holding the deploy/nginx/*.conf payload. Defaults to
                 the directory this script lives in, which only works when the
                 script is run as a file; when it is piped in over `bash -s`
                 (the CI path) --payload is required.
  --dry-run      Print the planned actions and the resulting vhost. Writes
                 nothing, installs nothing, reloads nothing. This is how a human
                 reviews the change before the first real run.
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --payload) PAYLOAD_DIR="${2:-}"; shift 2 ;;
        --payload=*) PAYLOAD_DIR="${1#*=}"; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "install-edge-config: unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

log()  { printf '[edge-config] %s\n' "$*"; }
die()  { printf '[edge-config] ERROR: %s\n' "$*" >&2; exit 1; }

# When run as a real file the payload sits next to us. When piped over `bash -s`
# $0 is "bash" and there is nothing to resolve, hence the explicit flag.
if [ -z "$PAYLOAD_DIR" ]; then
    if [ -f "${BASH_SOURCE[0]:-}" ]; then
        PAYLOAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    else
        die "no payload directory: pass --payload DIR (required when piped via 'bash -s')"
    fi
fi
[ -d "$PAYLOAD_DIR" ] || die "payload directory not found: $PAYLOAD_DIR"

# ── Collect the payload ──────────────────────────────────────────────────────
#
# Membership is derived from the files present in the repo, not from a hardcoded
# list, so adding deploy/nginx/cinemaslime-foo-location.conf is all it takes to
# get it installed and included. That is the whole point of "the repo is the
# single source of truth" — a list here would be a second source that can rot.
#
# Naming convention (load-bearing):
#   *-cache.conf     -> http{} context   -> /etc/nginx/conf.d/
#   *-location.conf  -> server{} context -> /etc/nginx/snippets/ + an include
#                                           inside the managed marker block
CACHE_CONFS=()
LOCATION_CONFS=()
for f in "$PAYLOAD_DIR"/${MANAGED_PREFIX}*-cache.conf; do
    [ -e "$f" ] && CACHE_CONFS+=("$f")
done
for f in "$PAYLOAD_DIR"/${MANAGED_PREFIX}*-location.conf; do
    [ -e "$f" ] && LOCATION_CONFS+=("$f")
done
[ "${#LOCATION_CONFS[@]}" -gt 0 ] || die "no ${MANAGED_PREFIX}*-location.conf files in $PAYLOAD_DIR"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# ── The awk lexer, shared by both awk programs below ─────────────────────────
#
# Brace matching has to be quote- and comment-aware. A naive regex or a plain
# `grep -c '{'` would mis-count on lines like
#   add_header Cache-Control "public, max-age=31536000, immutable" always;
# and would treat a `#`-commented brace as real. Getting this wrong means
# deleting the wrong span of the vhost, which is why it is a character-level
# scanner and not a pattern.
#
# Known limitation, stated rather than hidden: an unquoted `{` or `#` inside an
# nginx regex (a `{2,3}` quantifier, say) would confuse the scanner. No such
# construct exists in this vhost, and `nginx -t` plus the restore-on-failure path
# below is the backstop if one ever appears.
cat > "$TMP/scan.awk" <<'AWK'
# Advances the global `depth`/`dq`/`sq` state across one line, and sets the
# global `linemax` to the DEEPEST nesting reached anywhere within that line.
#
# linemax is not a nicety. Comparing depth before/after is enough for a block
# that opens on one line and closes on another, but a single-line block —
#   location = /x { return 404; }
# — leaves depth unchanged, so a before/after comparison concludes it never
# opened. The removal loop would then keep waiting for a close that already
# happened and delete to EOF. linemax makes "did this line open a block?"
# answerable regardless of where it closes.
function scan_line(s,    i, c, n, esc) {
    n = length(s); esc = 0; linemax = depth
    for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (esc)        { esc = 0; continue }
        if (c == "\\")  { if (dq || sq) esc = 1; continue }
        if (dq)         { if (c == "\"") dq = 0; continue }
        if (sq)         { if (c == "'")  sq = 0; continue }
        if (c == "#")   return                 # comment runs to end of line
        if (c == "\"")  { dq = 1; continue }
        if (c == "'")   { sq = 1; continue }
        if (c == "{")   { depth++; if (depth > linemax) linemax = depth }
        else if (c == "}") depth--
    }
}

# Same walk, but returns the line with any trailing comment removed.
function strip_comment(s,    i, c, n, esc, ldq, lsq) {
    n = length(s); esc = 0; ldq = dq; lsq = sq
    for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (esc)       { esc = 0; continue }
        if (c == "\\") { if (ldq || lsq) esc = 1; continue }
        if (ldq)       { if (c == "\"") ldq = 0; continue }
        if (lsq)       { if (c == "'")  lsq = 0; continue }
        if (c == "#")  return substr(s, 1, i - 1)
        if (c == "\"") { ldq = 1; continue }
        if (c == "'")  { lsq = 1; continue }
    }
    return s
}

# Canonical form of a line for COMPARISON purposes. The \r strip is the whole
# reason the 2026-07-25 migration silently did nothing in production: the payload
# was scp'd from a Windows clone where deploy/nginx/*.conf had checked out CRLF,
# so the signature derived from a snippet was "location = /api/rss\r" and never
# compared equal to the LF vhost's "location = /api/rss". The includes were added
# and the inline blocks were left in place — a duplicate location, which fails
# `nginx -t` and aborts the deploy. (.gitattributes now pins the directory to LF;
# this is the belt to that suspenders, and it must be applied to BOTH sides of
# every comparison, never just one.)
function squeeze(s) {
    gsub(/\r/, "", s)
    gsub(/[ \t]+/, " ", s)
    sub(/^ /, "", s)
    sub(/ $/, "", s)
    return s
}

function is_blank(s) { return squeeze(s) == "" }

function is_comment_only(s,    t) { t = squeeze(s); return (t ~ /^#/) }

# "location = /api/rss {"  ->  "location = /api/rss"     (the identity of a block)
# Anything that is not a location directive returns "".
#
# The trailing brace is chopped with index()/substr() rather than a regex on
# purpose: `\{` is not portable between awk implementations (gawk warns and
# treats it one way, mawk — Ubuntu's default /usr/bin/awk, and therefore what
# actually runs on the droplet — another). A signature that silently keeps its
# "{" matches nothing, which is exactly the failure mode this whole file exists
# to prevent, so the comparison key must not depend on awk dialect.
function loc_sig(s,    t, b) {
    t = squeeze(strip_comment(s))
    if (t !~ /^location[ ]/) return ""
    b = index(t, "{")
    if (b > 0) t = substr(t, 1, b - 1)
    return squeeze(t)
}
AWK

# ── Which location blocks are we taking ownership of? ────────────────────────
#
# Derived from the snippets themselves rather than hardcoded: whatever a snippet
# defines at its top level, the installer will remove from the vhost if an inline
# copy is found there. That is what makes the first-run migration automatic — the
# box currently has `location = /api/rss { ... }` and `location = /llms.txt { ... }`
# pasted inline, and including the snippets without removing them would make
# nginx refuse to start with "duplicate location".
cat > "$TMP/sigs.awk" <<'AWK'
{ lines[NR] = $0 }
END {
    depth = 0; dq = 0; sq = 0
    for (i = 1; i <= NR; i++) {
        d0 = depth
        s = loc_sig(lines[i])
        scan_line(lines[i])
        if (d0 == 0 && s != "") print s
    }
}
AWK

: > "$TMP/sigs.txt"
for f in "${LOCATION_CONFS[@]}"; do
    awk -f "$TMP/scan.awk" -f "$TMP/sigs.awk" "$f" >> "$TMP/sigs.txt"
done

# Zero derived signatures means the parse produced nothing usable (empty or
# unreadable snippets, or a lexer that has stopped recognising `location`). In
# that state the script would happily add includes while removing nothing —
# precisely the duplicate-location deploy break. Refuse instead of guessing.
[ -s "$TMP/sigs.txt" ] || die "derived no location signatures from ${#LOCATION_CONFS[@]} snippet(s) in $PAYLOAD_DIR — refusing to install includes for locations that cannot be migrated"

# ── The marker block that goes into the vhost ────────────────────────────────
{
    printf '%s\n' "$MARKER_START"
    cat <<'BLOCKDOC'
# Generated by deploy/nginx/install-edge-config.sh from the cinema-slime-website
# repo (deploy/nginx/*-location.conf). DO NOT EDIT BETWEEN THE MARKERS — the next
# deploy replaces this whole block. Change the .conf files in the repo instead.
#
# Position is load-bearing. This block sits immediately before `location / {` so
# that it also sits before the static-asset regex location further down. nginx
# picks the FIRST matching regex location in file order, and an artwork
# derivative URI ends in .jpg — below that block, every derivative 404s.
BLOCKDOC
    for f in "${LOCATION_CONFS[@]}"; do
        printf 'include %s/%s;\n' "$SNIPPETS" "$(basename "$f")"
    done
    printf '%s\n' "$MARKER_END"
} > "$TMP/block.txt"

# ── The vhost rewriter ───────────────────────────────────────────────────────
cat > "$TMP/rewrite.awk" <<'AWK'
BEGIN {
    while ((getline l < SIGFILE) > 0) { l = squeeze(l); if (l != "") sig[l] = 1 }
    while ((getline l < BLOCKFILE) > 0) block[++nb] = l
}
{ lines[NR] = $0 }
END {
    # ── Pass 1: find the insertion point ─────────────────────────────────────
    #
    # The vhost holds two server blocks (443 and 80). The managed include block
    # belongs in the HTTPS one, immediately before its `location / {`. Rather
    # than assume ordering, identify server blocks and prefer the one that
    # mentions 443 — certbot may put its `listen 443 ssl` line anywhere in the
    # block, so the whole block is scanned before choosing.
    depth = 0; dq = 0; sq = 0; nblocks = 0; cur = 0
    for (i = 1; i <= NR; i++) {
        d0 = depth
        t = squeeze(strip_comment(lines[i]))
        scan_line(lines[i])
        if (d0 == 0 && depth > 0 && (t ~ /^server[ ]*\{/ || t == "server")) {
            nblocks++; cur = nblocks; has443[cur] = 0; firstroot[cur] = 0
        }
        if (cur > 0) {
            if (d0 == 1 && t ~ /^listen[^;]*443/) has443[cur] = 1
            if (d0 == 1 && firstroot[cur] == 0 && t ~ /^location[ ]+\/[ ]*\{?$/) firstroot[cur] = i
        }
        if (depth == 0) cur = 0
    }
    target = 0
    for (b = 1; b <= nblocks; b++) if (has443[b] && firstroot[b]) { target = firstroot[b]; break }
    if (!target)
        for (b = 1; b <= nblocks; b++) if (firstroot[b]) { target = firstroot[b]; fallback = 1; break }
    if (!target) {
        print "install-edge-config: no `location / {` found in any server block — refusing to guess" > "/dev/stderr"
        exit 3
    }
    if (fallback)
        print "install-edge-config: WARNING no server block mentions 443; inserting into the first one with a `location / {`" > "/dev/stderr"

    # Match the surrounding indentation so the result stays readable.
    indent = lines[target]
    sub(/[^ \t].*$/, "", indent)

    # ── Pass 2: MARK which lines go away ─────────────────────────────────────
    #
    # Marking and emitting are separate passes for one specific reason: a block
    # can only be removed once its extent is known, but the comment header that
    # documents it sits ABOVE its first line and is already printed by the time a
    # single-pass emitter discovers the block. Deciding first, printing second,
    # makes deletion possible in both directions — forwards over the block body,
    # backwards over the now-orphaned header.
    depth = 0; dq = 0; sq = 0; in_marker = 0
    for (i = 1; i <= NR; i++) {
        L = lines[i]

        # Drop a previously-installed marker block wholesale. It is re-emitted
        # below at the canonical position, which is what makes re-runs both
        # idempotent AND self-healing if someone moved it.
        if (in_marker) {
            drop[i] = 1; scan_line(L)
            if (index(L, MEND)) in_marker = 0
            continue
        }
        if (index(L, MSTART)) { in_marker = 1; drop[i] = 1; scan_line(L); continue }

        d0 = depth
        t = squeeze(strip_comment(L))

        # An `include .../cinemaslime-*.conf;` line OUTSIDE the markers is a hand
        # edit (one was added by hand on 2026-07-25 to restore artwork). Drop it:
        # the marker block is now the only place includes live, and leaving the
        # stray one would duplicate every location it pulls in.
        if (d0 == 1 && t ~ /^include[ ].*\/cinemaslime-[^ ]*\.conf[ ]*;$/) {
            drop[i] = 1; scan_line(L)
            continue
        }

        # An inline copy of a location a snippet now owns: migrate it out.
        if (d0 == 1) {
            s = loc_sig(L)
            if (s != "" && (s in sig)) {
                closed = 0; opened = 0
                for (j = i; j <= NR; j++) {
                    drop[j] = 1
                    scan_line(lines[j])
                    if (!opened && linemax > d0) opened = 1
                    if (opened && depth <= d0) { closed = 1; break }
                }
                if (!closed) {
                    print "install-edge-config: unterminated `" s "` block at line " i " — refusing to guess where it ends" > "/dev/stderr"
                    exit 3
                }

                # The block is gone; the comment header that introduced it is now
                # an orphan describing nothing. Walk UP over a contiguous run of
                # `#` lines, tolerating blank lines within the run, and stop dead
                # at the first real directive (or at anything already dropped, so
                # two adjacent removals cannot chain into each other's context).
                np = 0
                for (k = i - 1; k >= 1; k--) {
                    if (k in drop) break
                    if (is_blank(lines[k])) { pending[++np] = k; continue }
                    if (!is_comment_only(lines[k])) break
                    for (q = 1; q <= np; q++) drop[pending[q]] = 1
                    np = 0
                    drop[k] = 1
                }

                i = j
                continue
            }
        }

        scan_line(L)
    }

    # ── Pass 3: emit ─────────────────────────────────────────────────────────
    blank_run = 0
    for (i = 1; i <= NR; i++) {
        if (i in drop) continue
        L = lines[i]

        if (i == target) for (j = 1; j <= nb; j++) print indent block[j]

        # Removals leave gaps; collapse runs of blank lines so repeated runs
        # cannot slowly accordion the file.
        if (is_blank(L)) { if (blank_run) continue; blank_run = 1 }
        else blank_run = 0

        print L
    }
}
AWK

rewrite_vhost() {  # $1 = source vhost, stdout = rewritten vhost
    awk -f "$TMP/scan.awk" -f "$TMP/rewrite.awk" \
        -v SIGFILE="$TMP/sigs.txt" \
        -v BLOCKFILE="$TMP/block.txt" \
        -v MSTART="$MARKER_START" \
        -v MEND="$MARKER_END" \
        "$1"
}

# ── Duplicate-location preflight ─────────────────────────────────────────────
#
# The structural fix for the 2026-07-25 break. Everything above tries to produce
# a correct vhost; this decides whether the attempt SUCCEEDED, by answering the
# question nginx will ask: after every managed include is expanded, does any
# server block define the same location twice?
#
# Relying on `nginx -t` to catch it is not equivalent. By then the bad config has
# already been written over the live one, and recovery depends on the restore
# path working perfectly on a box that is mid-deploy. Checking the CANDIDATE
# makes that whole sequence unreachable: if the migration did not actually
# migrate, nothing is written at all, in dry-run and in production alike.
#
# The includes are expanded from the PAYLOAD, not from /etc/nginx/snippets,
# because the payload is what this run is about to install.
cat > "$TMP/flatten.awk" <<'AWK'
{
    t = squeeze($0)
    if (t ~ /^include[ ].*\/cinemaslime-[^ ]*\.conf[ ]*;$/) {
        p = t
        sub(/^include[ ]+/, "", p)
        sub(/[ ]*;$/, "", p)
        while (index(p, "/") > 0) p = substr(p, index(p, "/") + 1)
        src = PAYLOAD "/" p
        n = 0
        while ((getline l < src) > 0) { print l; n++ }
        close(src)
        # Unreadable or not part of this payload: keep the line so the check
        # errs toward reporting less, never toward inventing content.
        if (n == 0) print $0
        next
    }
    print
}
AWK

cat > "$TMP/dupes.awk" <<'AWK'
{ lines[NR] = $0 }
END {
    depth = 0; dq = 0; sq = 0; blk = 0
    for (i = 1; i <= NR; i++) {
        d0 = depth
        s = loc_sig(lines[i])
        scan_line(lines[i])
        if (d0 == 0 && linemax > 0) blk++
        if (d0 == 1 && s != "") {
            key = blk SUBSEP s
            if (key in seen) print "server block " blk ": " s
            seen[key] = 1
        }
    }
}
AWK

duplicate_locations() {  # $1 = candidate vhost, stdout = one line per duplicate
    awk -f "$TMP/scan.awk" -f "$TMP/flatten.awk" -v PAYLOAD="$PAYLOAD_DIR" "$1" \
        > "$TMP/flat.conf"
    awk -f "$TMP/scan.awk" -f "$TMP/dupes.awk" "$TMP/flat.conf"
}

# ── Cache directories, derived from the cache confs ──────────────────────────
#
# Read out of `proxy_cache_path` rather than listed here, for the same
# single-source-of-truth reason as the file globs above.
cache_dirs() {
    [ "${#CACHE_CONFS[@]}" -gt 0 ] || return 0
    awk -v pfx="$CACHE_PREFIX" '/^[ \t]*proxy_cache_path[ \t]/ { print pfx $2 }' "${CACHE_CONFS[@]}"
}

# ── systemd drop-in: make nginx self-heal after a boot-time crash ────────────
#
# nginx shipped with `Restart=no`. When it `[emerg]`'d at boot on 2026-07-29
# (a bad config reached a reload — see ADR 0014, #135, for why that must never
# be load-bearing again), systemd never retried it and the box stayed down for
# three days. During recovery a human hand-wrote a drop-in directly on the
# droplet at /etc/systemd/system/nginx.service.d/restart.conf to fix that —
# exactly the undocumented config drift this whole installer exists to
# eliminate. This section makes the repo own that drop-in instead.
#
# This is a safety net, not a substitute for keeping upstreams non-load-bearing.
DROPIN_CONTENT="$(cat <<'DROPIN'
[Unit]
# A boot-time DNS failure to an upstream is transient — keep retrying instead of
# giving up after systemd's default 5 starts / 10s. 0 disables the start-rate
# limiter so a nginx that [emerg]'d at boot is restarted until it comes up.
StartLimitIntervalSec=0

[Service]
# nginx shipped with Restart=no, so a boot-time [emerg] stayed down for 3 days
# (2026-07-29). This makes the box heal itself. A safety net, NOT a substitute
# for keeping upstreams non-load-bearing (ADR 0014, #135).
Restart=on-failure
RestartSec=5s
DROPIN
)"

# Idempotent: only writes and only daemon-reloads when the content actually
# changed, mirroring the file_state pattern used for the vhost/managed confs
# above. Called from the write phase, independent of the nginx -t fail-closed
# gate — see the call site for why.
ensure_systemd_dropin() {
    mkdir -p "$SYSTEMD_DROPIN_DIR"
    local dest="$SYSTEMD_DROPIN_DIR/restart.conf"
    local tmp="$TMP/restart.conf.new"
    printf '%s\n' "$DROPIN_CONTENT" > "$tmp"
    local state
    state="$(file_state "$tmp" "$dest")"
    if [ "$state" = "unchanged" ]; then
        log "systemd drop-in already correct: $dest"
        return 0
    fi
    install -m 0644 "$tmp" "$dest"
    log "systemd drop-in $state: $dest"
    log "running '$SYSTEMCTL_DAEMON_RELOAD_CMD'"
    $SYSTEMCTL_DAEMON_RELOAD_CMD
}

# ── RSS freshness watchdog: make the site self-heal when it falls behind ──────
#
# /api/rss got stuck serving a stale feed for far longer than its 5-min TTL, and
# the only known cure was a manual rebuild — the exact "must not need manual
# updating" failure the runtime-fetch architecture (ADR 0006) exists to prevent.
# Root cause (2026-08-12): the shipped `?_=$msec` cache-buster is inert because
# Fastly ignores the query string for this resource, and `proxy_cache_use_stale`
# then serves the last-good copy unbounded and unmonitored when a background
# revalidation fails to refresh the entry. This watchdog enforces freshness from
# OUTSIDE nginx: a systemd timer compares the published copy against the live
# feed and purges + re-warms the cache on divergence. See
# rss-freshness-watchdog.sh for the full diagnosis.
#
# Like the drop-in above, this is not nginx config: it cannot fail `nginx -t`,
# so it sits outside the backup/restore fail-closed path. Idempotent via
# file_state; only reloads/enables when something actually changed.
ensure_watchdog() {
    local src_sh="$PAYLOAD_DIR/rss-freshness-watchdog.sh"
    local src_svc="$PAYLOAD_DIR/rss-freshness-watchdog.service"
    local src_tmr="$PAYLOAD_DIR/rss-freshness-watchdog.timer"
    # If the payload predates the watchdog (older checkout), do nothing.
    [ -f "$src_sh" ] && [ -f "$src_svc" ] && [ -f "$src_tmr" ] || {
        log "watchdog payload absent; skipping"
        return 0
    }

    local dest_sh="$WATCHDOG_BIN_DIR/rss-freshness-watchdog.sh"
    local dest_svc="$SYSTEMD_UNIT_DIR/rss-freshness-watchdog.service"
    local dest_tmr="$SYSTEMD_UNIT_DIR/rss-freshness-watchdog.timer"
    local changed=0

    mkdir -p "$WATCHDOG_BIN_DIR" "$SYSTEMD_UNIT_DIR"
    local s
    s="$(file_state "$src_sh" "$dest_sh")"
    if [ "$s" != "unchanged" ]; then install -m 0755 "$src_sh" "$dest_sh"; log "watchdog script $s: $dest_sh"; changed=1; fi
    s="$(file_state "$src_svc" "$dest_svc")"
    if [ "$s" != "unchanged" ]; then install -m 0644 "$src_svc" "$dest_svc"; log "watchdog service $s: $dest_svc"; changed=1; fi
    s="$(file_state "$src_tmr" "$dest_tmr")"
    if [ "$s" != "unchanged" ]; then install -m 0644 "$src_tmr" "$dest_tmr"; log "watchdog timer $s: $dest_tmr"; changed=1; fi

    if [ "$changed" -eq 1 ]; then
        log "running '$SYSTEMCTL_DAEMON_RELOAD_CMD'"
        $SYSTEMCTL_DAEMON_RELOAD_CMD
    fi
    # enable --now is idempotent: safe to run every deploy, starts the timer the
    # first time and is a no-op once it is already enabled and running.
    log "enabling rss-freshness-watchdog.timer"
    $SYSTEMCTL_CMD enable --now rss-freshness-watchdog.timer
}

# ── Plan ─────────────────────────────────────────────────────────────────────
[ -f "$VHOST" ] || die "vhost not found: $VHOST"

rewrite_vhost "$VHOST" > "$TMP/vhost.new"
VHOST_CHANGED=0
cmp -s "$VHOST" "$TMP/vhost.new" || VHOST_CHANGED=1

file_state() {  # $1 = src, $2 = dest -> "new" | "changed" | "unchanged"
    if [ ! -f "$2" ]; then echo new
    elif cmp -s "$1" "$2"; then echo unchanged
    else echo changed
    fi
}

log "payload:   $PAYLOAD_DIR"
log "vhost:     $VHOST"
log "conf.d:    $CONFD"
log "snippets:  $SNIPPETS"
log ""
log "locations owned by the repo:"
while read -r s; do [ -n "$s" ] && log "  $s"; done < "$TMP/sigs.txt"
log ""
log "planned file sync:"
for f in "${CACHE_CONFS[@]}"; do
    log "  $(file_state "$f" "$CONFD/$(basename "$f")")  $CONFD/$(basename "$f")"
done
for f in "${LOCATION_CONFS[@]}"; do
    log "  $(file_state "$f" "$SNIPPETS/$(basename "$f")")  $SNIPPETS/$(basename "$f")"
done

# Anything managed-looking on the box that the repo no longer ships is stale and
# gets reaped, otherwise a deleted feature's config would linger forever.
STALE=()
for d in "$CONFD" "$SNIPPETS"; do
    [ -d "$d" ] || continue
    for existing in "$d"/${MANAGED_PREFIX}*.conf; do
        [ -e "$existing" ] || continue
        if [ ! -f "$PAYLOAD_DIR/$(basename "$existing")" ]; then
            STALE+=("$existing")
            log "  stale (will remove)  $existing"
        fi
    done
done

log ""
log "vhost: $([ "$VHOST_CHANGED" -eq 1 ] && echo 'will be rewritten' || echo 'already correct (no change)')"

# Runs before every write path, dry-run included. Nothing below this line
# executes if the candidate config would define a location twice.
DUPES="$(duplicate_locations "$TMP/vhost.new")"
if [ -n "$DUPES" ]; then
    log ""
    log "duplicate locations in the candidate config (vhost + managed includes):"
    printf '%s\n' "$DUPES" | while read -r d; do log "  $d"; done
    die "the candidate config defines the same location twice — nginx would refuse to start. Nothing has been written. This usually means an inline copy of a managed location was not migrated out of the vhost (check that the payload's *-location.conf files have LF line endings)."
fi
log "duplicate-location preflight: clean"

if [ "$DRY_RUN" -eq 1 ]; then
    log ""
    log "--dry-run: nothing written. Resulting vhost would be:"
    echo "------------------------------------------------------------------"
    cat "$TMP/vhost.new"
    echo "------------------------------------------------------------------"
    log "--dry-run: would also ensure package '$IMAGE_FILTER_PKG', create cache dirs:"
    cache_dirs | while read -r d; do log "  $d"; done
    log "--dry-run: would ensure systemd drop-in $SYSTEMD_DROPIN_DIR/restart.conf and, if new or changed, run '$SYSTEMCTL_DAEMON_RELOAD_CMD'."
    log "--dry-run: would then run '$NGINX_TEST_CMD' and, on success, '$NGINX_RELOAD_CMD'."
    exit 0
fi

# ── Package ──────────────────────────────────────────────────────────────────
if [ "$SKIP_PACKAGES" != "1" ]; then
    if dpkg -s "$IMAGE_FILTER_PKG" >/dev/null 2>&1; then
        log "package $IMAGE_FILTER_PKG already installed"
    else
        log "installing $IMAGE_FILTER_PKG"
        # Non-interactive or the deploy hangs forever on a config prompt with no
        # tty to answer it.
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq "$IMAGE_FILTER_PKG"
    fi
fi

# ── Cache dirs ───────────────────────────────────────────────────────────────
cache_dirs | while read -r d; do
    [ -n "$d" ] || continue
    if [ ! -d "$d" ]; then
        log "creating cache dir $d"
        mkdir -p "$d"
    fi
    if id "$NGINX_USER" >/dev/null 2>&1; then
        chown -R "$NGINX_USER":"$NGINX_USER" "$d" 2>/dev/null || true
    fi
done

# A systemd drop-in is not nginx config: it cannot fail `nginx -t`, and
# daemon-reload cannot break a running nginx. So it deliberately sits outside
# the backup/restore fail-closed path below — even a run that goes on to fail
# closed on a bad vhost still leaves the self-healing restart policy installed.
ensure_systemd_dropin
ensure_watchdog

# ── Backup (vhost + every managed conf), so a failed `nginx -t` fully reverts ─
#
# Backing up the vhost alone is not enough: a re-run also rewrites the snippet
# files the restored vhost includes, so a partial restore could leave the box in
# a state neither version ever had.
#
# The backup directory must be EXCLUSIVE to this run. A plain
# `$BACKUP_ROOT/$(date +%Y%m%d%H%M%S)` is only unique to the second, and two
# runs inside the same second then share one directory: the second run's `cp -a`
# lands on top of the first run's saved files, so the directory ends up holding
# the UNION of two different states. Restoring from that union puts back files
# the repo had deliberately reaped and leaves behind files this run created —
# i.e. a restore that lands the box in a state it was never in. `mkdir` (not
# `mkdir -p`) is the atomic claim: it fails if the name is taken, so the loop
# below always ends on a directory nobody else owns.
STAMP="$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_ROOT"
BACKUP="$BACKUP_ROOT/$STAMP"
seq=0
until mkdir "$BACKUP" 2>/dev/null; do
    seq=$((seq + 1))
    [ "$seq" -le 1000 ] || die "cannot create a fresh backup directory under $BACKUP_ROOT/$STAMP"
    BACKUP="$BACKUP_ROOT/$STAMP-$seq"
done
mkdir -p "$BACKUP/conf.d" "$BACKUP/snippets"
cp -a "$VHOST" "$BACKUP/vhost"

# The manifest is the record of which managed files EXISTED before this run.
# Restore needs it, not just the saved copies: a file this run creates has no
# backup entry, and "no entry" has to mean "delete it again", which is only
# knowable from an explicit list of what was there beforehand.
MANIFEST="$BACKUP/manifest"
: > "$MANIFEST"
for d in "$CONFD:conf.d" "$SNIPPETS:snippets"; do
    src="${d%%:*}"; dst="${d##*:}"
    [ -d "$src" ] || continue
    for existing in "$src"/${MANAGED_PREFIX}*.conf; do
        if [ -e "$existing" ]; then
            cp -a "$existing" "$BACKUP/$dst/"
            printf '%s/%s\n' "$dst" "$(basename "$existing")" >> "$MANIFEST"
        fi
    done
done
log "backed up current state to $BACKUP"

# Puts the box back exactly as this run found it: the vhost, every managed file
# that was modified, and — the part a copy-back alone cannot do — the removal of
# every managed file this run CREATED. Everything managed is cleared first and
# only the manifest is replayed, so "created by this run" needs no separate
# bookkeeping: it is precisely what fails to come back.
restore() {
    log "restoring previous config from $BACKUP"
    cp -a "$BACKUP/vhost" "$VHOST"
    for d in "$CONFD" "$SNIPPETS"; do
        [ -d "$d" ] || continue
        for existing in "$d"/${MANAGED_PREFIX}*.conf; do
            if [ -e "$existing" ]; then rm -f "$existing"; fi
        done
    done
    while read -r rel; do
        [ -n "$rel" ] || continue
        case "$rel" in
            conf.d/*)   dest="$CONFD" ;;
            snippets/*) dest="$SNIPPETS" ;;
            *)          continue ;;
        esac
        mkdir -p "$dest"
        cp -a "$BACKUP/$rel" "$dest/"
    done < "$MANIFEST"
    log "restore complete: previous state reinstated, files created by this run removed"
}

# ── Write ────────────────────────────────────────────────────────────────────
mkdir -p "$CONFD" "$SNIPPETS"
for f in "${CACHE_CONFS[@]}"; do
    install -m 0644 "$f" "$CONFD/$(basename "$f")"
done
for f in "${LOCATION_CONFS[@]}"; do
    install -m 0644 "$f" "$SNIPPETS/$(basename "$f")"
done
for s in ${STALE[@]+"${STALE[@]}"}; do
    log "removing stale $s"
    rm -f "$s"
done
if [ "$VHOST_CHANGED" -eq 1 ]; then
    cat "$TMP/vhost.new" > "$VHOST"
    log "vhost rewritten"
else
    log "vhost unchanged"
fi

# ── Validate, then reload (or revert) ────────────────────────────────────────
if ! $NGINX_TEST_CMD; then
    restore
    if $NGINX_TEST_CMD; then
        die "nginx -t failed on the new config; previous config restored and still valid. NOT reloaded."
    fi
    die "nginx -t failed on the new config AND on the restored config. Manual intervention required; backup at $BACKUP. NOT reloaded."
fi

log "nginx -t passed; reloading"
$NGINX_RELOAD_CMD
log "done"
