#!/usr/bin/env bash
#
# Cinema Slime Curator: idempotent installer for the bot on the droplet (ADR 0021).
#
# Piped over SSH by .github/workflows/deploy-bot.yml, like install-edge-config.sh:
#
#   ssh root@droplet 'bash -s -- --payload /tmp/cinemaslime-bot.N' < deploy/bot/install-bot.sh
#
# The payload directory holds the CI-built bundle (cinemaslime-bot.mjs), the
# files in deploy/bot/, and vault/ (the repo's vault/essays/*.json). The
# workflow has already streamed each credential over SSH stdin into
# /etc/cinemaslime-bot/credentials/<name>.new.
#
# Every step converges: re-running with the same payload changes nothing and
# leaves the running bot alone; a changed bundle, unit, config, Node or
# credential restarts it. It ends by waiting for the bot to log "gateway ready".
#
# BOT_ROOT prefixes every path and BOT_TEST=1 skips user creation, chown and
# systemctl, so the file logic can be exercised locally without root;
# BOT_NODE_CACHE names a directory holding an already-downloaded Node tarball.

set -euo pipefail

ROOT="${BOT_ROOT:-}"
TEST="${BOT_TEST:-0}"
USER_NAME=cinemaslime-bot
NODE_DIR="$ROOT/opt/cinemaslime-node"
APP_DIR="$ROOT/opt/cinemaslime-bot"
CRED_DIR="$ROOT/etc/cinemaslime-bot/credentials"
STATE_DIR="$ROOT/var/lib/cinemaslime-bot"
ESSAY_DIR="$ROOT/var/www/cinemaslime/html/essay"
UNIT_DIR="$ROOT/etc/systemd/system"
BIN_DIR="$ROOT/usr/local/bin"
CREDENTIALS=(discord-token brand-secret-key)

PAYLOAD=""
while [ $# -gt 0 ]; do
    case "$1" in
        --payload) PAYLOAD="${2:-}"; shift 2 ;;
        *) echo "install-bot: unknown argument: $1" >&2; exit 2 ;;
    esac
done

log() { printf '[bot] %s\n' "$*"; }
die() { printf '[bot] ERROR: %s\n' "$*" >&2; exit 1; }

[ -n "$PAYLOAD" ] && [ -d "$PAYLOAD" ] || die "pass --payload DIR"
for f in cinemaslime-bot.mjs cinemaslime-bot.service cinemaslime-bot config.json node.sha256; do
    [ -f "$PAYLOAD/$f" ] || die "payload is missing $f"
done

CHANGED=0

# install_if_changed SRC DEST MODE: copies only when the content differs.
install_if_changed() {
    if [ -f "$2" ] && cmp -s "$1" "$2"; then return 0; fi
    install -D -m "$3" "$1" "$2"
    log "updated $2"
    CHANGED=1
}

ensure_user() {
    [ "$TEST" = 1 ] && return 0
    id "$USER_NAME" >/dev/null 2>&1 && return 0
    useradd --system --home-dir /var/lib/cinemaslime-bot --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
    log "created system user $USER_NAME"
}

# Pinned Node from nodejs.org, checked against the sha256 committed in
# deploy/bot/node.sha256. No apt repository.
ensure_node() {
    local sum tarball version dest tmp
    read -r sum tarball < "$PAYLOAD/node.sha256"
    version="${tarball%-linux-x64.tar.xz}"
    dest="$NODE_DIR/$version"
    [ "$(uname -m)" = x86_64 ] || die "Node pin is linux-x64 but this host is $(uname -m)"
    if [ ! -x "$dest/bin/node" ]; then
        tmp="$(mktemp -d)"
        if [ -f "${BOT_NODE_CACHE:-}/$tarball" ]; then
            cp "$BOT_NODE_CACHE/$tarball" "$tmp/"
        else
            curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/${version#node-}/$tarball"
        fi
        (cd "$tmp" && printf '%s  %s\n' "$sum" "$tarball" | sha256sum -c --quiet -) || die "sha256 mismatch for $tarball"
        mkdir -p "$dest.partial"
        tar -xJf "$tmp/$tarball" -C "$dest.partial" --strip-components=1
        rm -rf "$dest" "$tmp"
        mv "$dest.partial" "$dest"
        log "installed $version"
    fi
    if [ "$(readlink "$NODE_DIR/current" 2>/dev/null)" != "$version" ]; then
        ln -sfn "$version" "$NODE_DIR/current"
        log "node current -> $version"
        CHANGED=1
    fi
}

ensure_credentials() {
    local name
    mkdir -p "$CRED_DIR"
    chmod 0700 "$CRED_DIR"
    for name in "${CREDENTIALS[@]}"; do
        if [ -f "$CRED_DIR/$name.new" ]; then
            [ -s "$CRED_DIR/$name.new" ] || die "credential $name arrived empty"
            install_if_changed "$CRED_DIR/$name.new" "$CRED_DIR/$name" 0600
            rm -f "$CRED_DIR/$name.new"
        fi
        [ -s "$CRED_DIR/$name" ] || die "credential $name is missing; the deploy workflow must provide it"
    done
}

ensure_app() {
    install_if_changed "$PAYLOAD/cinemaslime-bot.mjs" "$APP_DIR/cinemaslime-bot.mjs" 0644
    install_if_changed "$PAYLOAD/config.json" "$APP_DIR/config.json" 0644
    install_if_changed "$PAYLOAD/cinemaslime-bot" "$BIN_DIR/cinemaslime-bot" 0755
    cmp -s "$PAYLOAD/cinemaslime-bot.service" "$UNIT_DIR/cinemaslime-bot.service" || UNIT_CHANGED=1
    install_if_changed "$PAYLOAD/cinemaslime-bot.service" "$UNIT_DIR/cinemaslime-bot.service" 0644
}

# The droplet vault is primary once seeded: files already there are never
# overwritten by the repo's (possibly older) copies.
ensure_state() {
    mkdir -p "$STATE_DIR/vault/essays"
    if [ -d "$PAYLOAD/vault" ]; then
        local f
        for f in "$PAYLOAD"/vault/*.json; do
            [ -e "$f" ] || continue
            [ -e "$STATE_DIR/vault/essays/$(basename "$f")" ] || { cp "$f" "$STATE_DIR/vault/essays/"; log "seeded $(basename "$f")"; }
        done
    fi
    mkdir -p "$ESSAY_DIR"
    [ "$TEST" = 1 ] && return 0
    chown -R "$USER_NAME:$USER_NAME" "$STATE_DIR"
    chmod 0750 "$STATE_DIR"
    # Deploys and the hourly refresh recreate essay/ as root; they chown it back
    # too, this covers the first install.
    chown -R "$USER_NAME:$USER_NAME" "$ESSAY_DIR"
}

ensure_running() {
    [ "$TEST" = 1 ] && { log "BOT_TEST: would restart=$CHANGED daemon-reload=$UNIT_CHANGED"; return 0; }
    [ "$UNIT_CHANGED" = 1 ] && systemctl daemon-reload
    systemctl enable cinemaslime-bot >/dev/null
    local since
    since="$(date '+%Y-%m-%d %H:%M:%S')"
    if [ "$CHANGED" = 1 ] || ! systemctl is-active --quiet cinemaslime-bot; then
        systemctl restart cinemaslime-bot
        log "restarted cinemaslime-bot"
    else
        log "unchanged and running; left alone"
        return 0
    fi
    local i
    for i in $(seq 1 45); do
        if journalctl -u cinemaslime-bot --since "$since" --no-pager -o cat | grep -q 'gateway ready'; then
            log "$(journalctl -u cinemaslime-bot --since "$since" --no-pager -o cat | grep 'gateway ready' | tail -1)"
            return 0
        fi
        sleep 1
    done
    journalctl -u cinemaslime-bot --since "$since" --no-pager -o cat | tail -20 >&2
    die "cinemaslime-bot did not reach 'gateway ready' within 45s"
}

UNIT_CHANGED=0
ensure_user
ensure_node
ensure_credentials
ensure_app
ensure_state
ensure_running
log "done"
