#!/usr/bin/env bash
#
# Runs one Curator CLI command on the droplet with the daemon stopped
# (ADR 0022). Piped over SSH by .github/workflows/curator-command.yml:
#
#   ssh root@droplet 'bash -s -- run standardize --dry-run' < deploy/bot/curator-command.sh
#   ssh root@droplet 'bash -s -- start'                     < deploy/bot/curator-command.sh
#
# `run` stops the daemon (the CLI refuses while it holds the Curator lock),
# then runs the break-glass shim with the arguments exactly as given and exits
# with its status. `start` starts the daemon and waits for "gateway ready"; the
# workflow runs it whether or not `run` succeeded, so the bot always comes back.
#
# SYSTEMCTL, JOURNALCTL, BOT_CLI and READY_SECONDS are overridable so
# deploy/bot/test/run-curator-command-tests.sh can run this without root.

set -euo pipefail

SYSTEMCTL="${SYSTEMCTL:-systemctl}"
JOURNALCTL="${JOURNALCTL:-journalctl}"
BOT_CLI="${BOT_CLI:-/usr/local/bin/cinemaslime-bot}"
READY_SECONDS="${READY_SECONDS:-60}"
UNIT=cinemaslime-bot

log() { printf '[curator-command] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

run_command() {
    [ "$#" -gt 0 ] || die "run needs a cinemaslime-bot command"
    "$SYSTEMCTL" stop "$UNIT"
    log "stopped $UNIT; running: cinemaslime-bot $*"
    local status=0
    "$BOT_CLI" "$@" || status=$?
    log "cinemaslime-bot exited $status"
    return "$status"
}

start_daemon() {
    local since i
    since="$(date '+%Y-%m-%d %H:%M:%S')"
    "$SYSTEMCTL" start "$UNIT"
    log "started $UNIT"
    for ((i = 0; i < READY_SECONDS; i++)); do
        if "$JOURNALCTL" -u "$UNIT" --since "$since" --no-pager -o cat | grep -q 'gateway ready'; then
            log "$("$JOURNALCTL" -u "$UNIT" --since "$since" --no-pager -o cat | grep 'gateway ready' | tail -1)"
            return 0
        fi
        sleep 1
    done
    "$JOURNALCTL" -u "$UNIT" --since "$since" --no-pager -o cat | tail -20 >&2 || true
    die "$UNIT did not report gateway ready within ${READY_SECONDS}s"
}

case "${1:-}" in
    run) shift; run_command "$@" ;;
    start) start_daemon ;;
    *) die "usage: curator-command.sh run <cinemaslime-bot args...> | start" ;;
esac
