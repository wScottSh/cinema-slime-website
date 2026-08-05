#!/usr/bin/env bash
#
# Tests for deploy/nginx/install-edge-config.sh.
#
# The installer is the riskiest artifact in this repo: it rewrites a
# certbot-managed nginx vhost in place on the production droplet. Everything it
# does is driven by env-var overrides (EDGE_VHOST, EDGE_SNIPPETS, …), so the
# whole rewriting path can be exercised against a fixture copy of the real
# production vhost without going anywhere near a server. Nothing here touches
# the network, ssh, or any path outside the repo and a throwaway mktemp dir.
#
# The suite runs twice: once against an LF payload and once against a CRLF one.
# That is not paranoia — a CRLF checkout puts a stray CR at the end of every
# location signature the installer derives from a snippet, so `location =
# /api/rss` in the snippet stops comparing equal to the same line in the vhost,
# the inline block is never migrated out, and nginx refuses to start with
# "duplicate location". That is the exact production failure of 2026-07-25.
#
#   bash deploy/nginx/test/run-installer-tests.sh      (or: npm run test:installer)
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/deploy/nginx/install-edge-config.sh"
FIXTURE_SRC="$(cd "$(dirname "$0")" && pwd)/fixtures/vhost-real.conf"

[ -f "$SCRIPT" ]      || { echo "installer not found: $SCRIPT" >&2; exit 1; }
[ -f "$FIXTURE_SRC" ] || { echo "fixture not found: $FIXTURE_SRC" >&2; exit 1; }

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); echo "  PASS  $1"; }
fail() { FAILED=$((FAILED + 1)); echo "  FAIL  $1"; }
assert() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# ── Payloads, built here rather than committed ───────────────────────────────
# The payload is just deploy/nginx/*.conf. Deriving it at run time means the
# tests always exercise the config this checkout actually ships, and the CRLF
# variant is manufactured rather than stored (git would normalise it away —
# .gitattributes pins deploy/nginx/** to LF precisely to stop CRLF reaching the
# droplet).
PAY_LF="$TMPROOT/payload-lf"
PAY_CRLF="$TMPROOT/payload-crlf"
mkdir -p "$PAY_LF" "$PAY_CRLF"
for f in "$ROOT"/deploy/nginx/cinemaslime-*.conf; do
    [ -f "$f" ] || continue
    b="$(basename "$f")"
    tr -d '\r' < "$f" > "$PAY_LF/$b"
    sed 's/$/\r/' "$PAY_LF/$b" > "$PAY_CRLF/$b"
done
[ "$(ls -1 "$PAY_LF" | wc -l)" -gt 0 ] || { echo "no cinemaslime-*.conf payload in $ROOT/deploy/nginx" >&2; exit 1; }

# The fixture is a verbatim copy of the production vhost as it stood before the
# first CI-owned install: two server blocks, certbot's lines, hand-pasted inline
# rss/llms locations, and one stray art include outside the markers.
FIX="$TMPROOT/vhost-real.conf"
tr -d '\r' < "$FIXTURE_SRC" > "$FIX"

# ── Fault-injection copy of the installer ───────────────────────────────────
# Neuters the inline-location removal branch, reproducing exactly the reported
# failure: includes get added, inline blocks survive, nginx would refuse to
# start. The duplicate-location preflight must catch it before anything is
# written.
BROKEN="$TMPROOT/install-edge-config.broken.sh"
sed 's/if (s != "" && (s in sig)) {/if (0) {/' "$SCRIPT" > "$BROKEN"
if cmp -s "$SCRIPT" "$BROKEN"; then
    echo "fault injection matched nothing — the removal branch in $SCRIPT has been renamed;" >&2
    echo "update the sed in $0 or these tests silently stop testing anything." >&2
    exit 1
fi

# ── A clock frozen to one second ─────────────────────────────────────────────
# The installer names its backup directory after the current UTC second. On a CI
# runner the whole suite completes in ~0.4s, so several runs shared one backup
# directory and its contents became the union of several different states —
# which restore then replayed. Locally each run took over a second, the names
# never collided, and the suite passed. A test that only fails on a fast machine
# is not a test, so the same-second case is forced here rather than raced for.
FROZEN_BIN="$TMPROOT/frozen-clock"
mkdir -p "$FROZEN_BIN"
cat > "$FROZEN_BIN/date" <<'DATE'
#!/usr/bin/env bash
# Only the installer's `date -u +FORMAT` stamp is pinned; anything else passes
# through, so this cannot quietly break unrelated commands.
if [ "${1:-}" = "-u" ]; then echo 20260101000000; exit 0; fi
exec /usr/bin/date "$@"
DATE
chmod +x "$FROZEN_BIN/date"

# ── daemon-reload shim ────────────────────────────────────────────────────────
# Appends a line to a marker file whenever invoked, so tests can count
# daemon-reload calls and assert the drop-in write is idempotent (no reload on
# an unchanged re-run).
DAEMON_RELOAD_SHIM="$TMPROOT/daemon-reload-shim.sh"
cat > "$DAEMON_RELOAD_SHIM" <<'SHIM'
#!/usr/bin/env bash
echo "daemon-reload" >> "$DAEMON_RELOAD_LOG"
SHIM
chmod +x "$DAEMON_RELOAD_SHIM"

run_suite() {
    LABEL="$1"
    PAY="$2"

    echo
    echo "==============================================================="
    echo "  PAYLOAD: $LABEL"
    echo "==============================================================="

    W="$TMPROOT/w-$LABEL"
    rm -rf "$W"
    mkdir -p "$W/confd" "$W/snippets" "$W/backups" "$W/cache" "$W/systemd"
    cp "$FIX" "$W/vhost"
    : > "$W/daemon-reload.log"

    export EDGE_VHOST="$W/vhost" EDGE_CONFD="$W/confd" EDGE_SNIPPETS="$W/snippets" \
           EDGE_BACKUP_ROOT="$W/backups" EDGE_SKIP_PACKAGES=1 EDGE_CACHE_PREFIX="$W/cache" \
           EDGE_NGINX_TEST_CMD=true EDGE_NGINX_RELOAD_CMD=true \
           EDGE_SYSTEMD_DROPIN_DIR="$W/systemd" \
           EDGE_SYSTEMCTL_DAEMON_RELOAD_CMD="bash $DAEMON_RELOAD_SHIM" \
           DAEMON_RELOAD_LOG="$W/daemon-reload.log"

    # Every scenario after the idempotency runs starts from a pristine box, the
    # BACKUP ROOT INCLUDED. Leaving old backups in place is not harmless setup
    # sloppiness: a scenario would then be able to restore files an earlier
    # scenario put there, which both hides real restore bugs and invents fake
    # ones. Only runs 1–3 deliberately share state, because idempotency is
    # exactly the property of running twice against what the last run left.
    reset_state() {
        rm -rf "$W/confd" "$W/snippets" "$W/backups" "$W/systemd"
        mkdir -p "$W/confd" "$W/snippets" "$W/backups" "$W/systemd"
        cp "$FIX" "$W/vhost"
        : > "$W/daemon-reload.log"
    }

    echo
    echo "##### RUN 1 (migration from the real pre-CI vhost) #####"
    if ! bash "$SCRIPT" --payload "$PAY"; then
        echo "installer exited non-zero on run 1 — aborting this payload" >&2
        FAILED=$((FAILED + 1))
        return
    fi
    cp "$W/vhost" "$W/after1"

    echo
    echo "##### ASSERTIONS (run 1) #####"
    assert "no inline 'location = /api/rss' outside markers" \
      '! grep -q "^ *location = /api/rss" "$W/after1"'
    assert "no inline 'location = /llms.txt' outside markers" \
      '! grep -q "^ *location = /llms.txt" "$W/after1"'
    assert "rss comment header gone" \
      '! grep -q "RSS reverse-proxy location (server context)" "$W/after1"'
    assert "llms comment header gone" \
      '! grep -q "llms.txt static-file location (see deploy" "$W/after1"'
    assert "stray art include gone (only inside markers)" \
      '[ "$(grep -c "cinemaslime-art-location.conf" "$W/after1")" = 1 ]'
    assert "marker block present" 'grep -q ">>> cinemaslime managed by CI >>>" "$W/after1"'
    assert "marker END before 'location / {'" \
      '[ "$(grep -n "<<< cinemaslime managed by CI <<<" "$W/after1" | cut -d: -f1)" -lt "$(grep -n "^ *location / {" "$W/after1" | cut -d: -f1)" ]'
    assert "all 4 includes inside marker block" \
      '[ "$(sed -n "/>>> cinemaslime/,/<<< cinemaslime/p" "$W/after1" | grep -c "^ *include ")" = 4 ]'
    assert "certbot lines untouched (byte-identical)" \
      'diff <(grep "managed by Certbot" "$FIX") <(grep "managed by Certbot" "$W/after1") >/dev/null'
    assert "both server blocks survive" '[ "$(grep -c "^server {" "$W/after1")" = 2 ]'
    assert "snippets installed" '[ "$(ls "$W/snippets" | wc -l)" = 4 ]'
    assert "cache confs installed" '[ "$(ls "$W/confd" | wc -l)" = 3 ]'
    assert "systemd drop-in written" '[ -f "$W/systemd/restart.conf" ]'
    assert "drop-in has Restart=on-failure" 'grep -q "^Restart=on-failure$" "$W/systemd/restart.conf"'
    assert "drop-in has RestartSec=5s" 'grep -q "^RestartSec=5s$" "$W/systemd/restart.conf"'
    assert "drop-in has StartLimitIntervalSec=0" 'grep -q "^StartLimitIntervalSec=0$" "$W/systemd/restart.conf"'
    assert "daemon-reload ran on run 1" '[ -s "$W/daemon-reload.log" ]'
    cp "$W/systemd/restart.conf" "$W/dropin-after1"

    echo
    echo "##### RUNS 2 AND 3 (idempotency) #####"
    RELOAD_COUNT_BEFORE_RUN2="$(wc -l < "$W/daemon-reload.log")"
    bash "$SCRIPT" --payload "$PAY" | grep -E "vhost (unchanged|rewritten)"
    RELOAD_COUNT_AFTER_RUN2="$(wc -l < "$W/daemon-reload.log")"
    if cmp -s "$W/after1" "$W/vhost"; then
        pass "run 2 byte-identical to run 1"
    else
        fail "run 2 differs from run 1"; diff "$W/after1" "$W/vhost" | sed 's/^/    /'
    fi
    assert "systemd drop-in byte-identical after run 2" 'cmp -s "$W/dropin-after1" "$W/systemd/restart.conf"'
    assert "daemon-reload did NOT run again on run 2 (unchanged drop-in)" \
      '[ "$RELOAD_COUNT_AFTER_RUN2" = "$RELOAD_COUNT_BEFORE_RUN2" ]'

    bash "$SCRIPT" --payload "$PAY" >/dev/null
    if cmp -s "$W/after1" "$W/vhost"; then
        pass "run 3 byte-identical to run 1"
    else
        fail "run 3 differs from run 1"; diff "$W/after1" "$W/vhost" | sed 's/^/    /'
    fi

    echo
    echo "##### SYSTEMD DROP-IN: CHANGED PATH (hand-edited drop-in gets repaired) #####"
    # Reproduces exactly the drift this feature exists to fix: someone (or a prior
    # install) leaves wrong content in restart.conf. The installer must detect
    # "changed" (not "unchanged"), rewrite it, and daemon-reload again.
    echo "[Service]" > "$W/systemd/restart.conf"
    RELOAD_COUNT_BEFORE_CHANGED="$(wc -l < "$W/daemon-reload.log")"
    bash "$SCRIPT" --payload "$PAY" >/dev/null
    RELOAD_COUNT_AFTER_CHANGED="$(wc -l < "$W/daemon-reload.log")"
    assert "drop-in rewritten byte-identical to the correct content" \
      'cmp -s "$W/dropin-after1" "$W/systemd/restart.conf"'
    assert "daemon-reload ran again on the changed path" \
      '[ "$RELOAD_COUNT_AFTER_CHANGED" -gt "$RELOAD_COUNT_BEFORE_CHANGED" ]'

    echo
    echo "##### DUPLICATE-LOCATION CHECK (flattened vhost + includes) #####"
    # nginx refuses to start when two `location` directives in the same server
    # block match identically, so the only meaningful check is against the vhost
    # with every managed include expanded in place.
    FLAT="$W/flat"
    awk -v S="$W/snippets" '
      { t=$0; gsub(/\r/,"",t); gsub(/[ \t]+/," ",t); sub(/^ /,"",t)
        if (t ~ /^include .*\/cinemaslime-.*\.conf ?;$/) {
          p=t; sub(/^include +/,"",p); sub(/ *;$/,"",p)
          while (index(p,"/")>0) p=substr(p,index(p,"/")+1)
          while ((getline l < (S "/" p)) > 0) print l
          close(S "/" p); next }
        print }' "$W/after1" > "$FLAT"
    DUPES="$(awk '
      function sq(s){gsub(/\r/,"",s);gsub(/[ \t]+/," ",s);sub(/^ /,"",s);sub(/ $/,"",s);return s}
      { n=length($0); for(i=1;i<=n;i++){c=substr($0,i,1)
          if(esc){esc=0;continue}
          if(c=="\\"){if(dq||sq_)esc=1;continue}
          if(dq){if(c=="\"")dq=0;continue}
          if(sq_){if(c=="'"'"'")sq_=0;continue}
          if(c=="#")break
          if(c=="\""){dq=1;continue}
          if(c=="'"'"'"){sq_=1;continue}
          if(c=="{"){if(d==1&&pend!=""){k=blk SUBSEP pend; if(k in seen)print pend; seen[k]=1; pend=""} d++; if(d==1)blk++}
          else if(c=="}")d--}
        t=sq($0); if(d==1 && t ~ /^location /){b=index(t,"{"); if(b>0)t=substr(t,1,b-1); pend=sq(t)}
      }' "$FLAT")"
    LOCS="$(grep -c "^ *location " "$FLAT" || true)"
    echo "  flattened vhost: $(wc -l < "$FLAT") lines, $LOCS location directives"
    if [ -z "$DUPES" ]; then pass "zero duplicate locations"; else fail "duplicate locations: $DUPES"; fi

    echo
    echo "##### FAIL-CLOSED (EDGE_NGINX_TEST_CMD=false) #####"
    # A candidate config that nginx rejects must leave the box exactly as it was
    # found — vhost, snippets and conf.d all restored — and must never reload.
    reset_state
    echo "STALE" > "$W/snippets/cinemaslime-zzz-location.conf"
    EDGE_NGINX_TEST_CMD=false bash "$SCRIPT" --payload "$PAY" > "$W/fc.log" 2>&1
    RC=$?
    tail -4 "$W/fc.log" | sed 's/^/    /'
    assert "fail-closed exits non-zero" '[ "'"$RC"'" -ne 0 ]'
    assert "vhost restored byte-identical to original" 'cmp -s "$FIX" "$W/vhost"'
    assert "no snippets left installed after restore" '[ "$(ls "$W/snippets" | wc -l)" = 1 ]'
    assert "stale snippet restored too" '[ -f "$W/snippets/cinemaslime-zzz-location.conf" ]'
    assert "reload never ran" '! grep -q "reloading" "$W/fc.log"'

    echo
    echo "##### FAIL-CLOSED ON A BOX WITH NO MANAGED FILES AT ALL #####"
    # The first-install case. Nothing managed exists beforehand, so every file
    # the run writes is one it CREATED, and none of them has a backup copy to be
    # put back from. Restore has to delete them, or a rejected config leaves the
    # box carrying files the repo never got to validate.
    reset_state
    EDGE_NGINX_TEST_CMD=false bash "$SCRIPT" --payload "$PAY" > "$W/fc2.log" 2>&1
    RCF=$?
    assert "fail-closed (first install) exits non-zero" '[ "'"$RCF"'" -ne 0 ]'
    assert "vhost restored byte-identical (first install)" 'cmp -s "$FIX" "$W/vhost"'
    assert "newly created snippets deleted by restore" '[ "$(ls "$W/snippets" | wc -l)" = 0 ]'
    assert "newly created conf.d files deleted by restore" '[ "$(ls "$W/confd" | wc -l)" = 0 ]'
    assert "first-install failure never reloaded" '! grep -q "reloading" "$W/fc2.log"'

    echo
    echo "##### SAME-SECOND RUNS GET SEPARATE BACKUPS (frozen clock) #####"
    # Runs sharing a backup directory make its contents the union of several
    # states, and restore then replays that union — resurrecting reaped files and
    # keeping files the failed run created. Reproduced deterministically here by
    # pinning the clock, which is what a fast CI runner does by accident.
    reset_state
    PATH="$FROZEN_BIN:$PATH" bash "$SCRIPT" --payload "$PAY" >/dev/null
    PATH="$FROZEN_BIN:$PATH" bash "$SCRIPT" --payload "$PAY" >/dev/null
    PATH="$FROZEN_BIN:$PATH" bash "$SCRIPT" --payload "$PAY" >/dev/null
    assert "three same-second runs make three backup dirs" \
      '[ "$(ls -1 "$W/backups" | wc -l)" = 3 ]'
    rm -f "$W/snippets"/* "$W/confd"/*
    cp "$FIX" "$W/vhost"
    echo "STALE" > "$W/snippets/cinemaslime-zzz-location.conf"
    EDGE_NGINX_TEST_CMD=false PATH="$FROZEN_BIN:$PATH" bash "$SCRIPT" --payload "$PAY" \
      > "$W/fc3.log" 2>&1
    assert "same-second restore leaves only the pre-existing snippet" \
      '[ "$(ls "$W/snippets" | wc -l)" = 1 ] && [ -f "$W/snippets/cinemaslime-zzz-location.conf" ]'
    assert "same-second restore does not resurrect reaped conf.d files" \
      '[ "$(ls "$W/confd" | wc -l)" = 0 ]'

    echo
    echo "##### PREFLIGHT CATCHES THE ORIGINAL BUG (fault injection) #####"
    reset_state
    bash "$BROKEN" --payload "$PAY" > "$W/pf.log" 2>&1
    RC2=$?
    grep -E "duplicate|ERROR" "$W/pf.log" | sed 's/^/    /'
    assert "preflight aborts the broken migration" '[ "'"$RC2"'" -ne 0 ]'
    assert "preflight ran BEFORE writing (vhost untouched)" 'cmp -s "$FIX" "$W/vhost"'

    echo
    echo "##### SINGLE-LINE BLOCK #####"
    # A one-line `location = /llms.txt { ... }` must be recognised as opening AND
    # closing on the same line. A before/after depth comparison sees it as never
    # opening, which makes the removal loop delete everything to EOF.
    reset_state
    cat > "$W/vhost" <<'EOF'
server {
    listen 443 ssl;
    server_name cinemaslime.com;

    # llms header comment
    location = /llms.txt { default_type text/markdown; }

    location /keepme { return 204; }

    location / {
        try_files $uri /index.html;
    }
}
EOF
    bash "$SCRIPT" --payload "$PAY" >/dev/null
    assert "single-line managed block removed"      '! grep -q "location = /llms.txt {" "$W/vhost"'
    assert "single-line header comment removed"     '! grep -q "llms header comment" "$W/vhost"'
    assert "unmanaged single-line block survives"   'grep -q "location /keepme" "$W/vhost"'
    assert "did not delete to EOF"                  'grep -q "try_files" "$W/vhost"'
    assert "closing brace of server survives"       '[ "$(grep -c "^}" "$W/vhost")" = 1 ]'

    echo
    echo "##### UNTERMINATED BLOCK #####"
    reset_state
    cat > "$W/vhost" <<'EOF'
server {
    listen 443 ssl;

    location / {
        try_files $uri /index.html;
    }

    location = /llms.txt {
        default_type text/markdown;
EOF
    cp "$W/vhost" "$W/vhost.orig"
    bash "$SCRIPT" --payload "$PAY" > "$W/unterm.log" 2>&1
    RC3=$?
    grep -E "unterminated" "$W/unterm.log" | sed 's/^/    /'
    assert "unterminated block aborts non-zero"     '[ "'"$RC3"'" -ne 0 ]'
    assert "unterminated block wrote nothing"       'cmp -s "$W/vhost.orig" "$W/vhost"'
}

echo "installer: $SCRIPT"
# Printed because it matters: gawk and mawk disagree about `\{` in regexes and
# about how CR survives a gsub, which is the whole reason for the CRLF pass.
# The droplet's /usr/bin/awk is mawk (Ubuntu server default); the GitHub
# ubuntu-latest runner and most dev machines are gawk — so the version this
# suite ran under is worth having in the log before reading any failure.
echo "awk:       $(awk -W version 2>&1 | head -1)"

run_suite "lf"   "$PAY_LF"
run_suite "crlf" "$PAY_CRLF"

echo
echo "==============================================================="
echo "  $((PASSED + FAILED)) assertions: $PASSED passed, $FAILED failed"
echo "==============================================================="
if [ "$FAILED" -ne 0 ]; then
    echo "INSTALLER TESTS FAILED"
    exit 1
fi
echo "ALL INSTALLER TESTS PASSED"
