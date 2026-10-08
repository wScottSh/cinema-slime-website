#!/usr/bin/env bash
#
# Tests for deploy/bot/install-bot.sh, run in its BOT_TEST mode (no root, no
# systemctl, no user creation) against a throwaway BOT_ROOT. The Node pin is a
# fake tarball with a matching sha256, so nothing touches the network.
#
#   bash deploy/bot/test/run-installer-tests.sh      (or: npm run test:bot-installer)
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/deploy/bot/install-bot.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }

TARBALL=node-v0.0.0-linux-x64.tar.xz
mkdir -p "$WORK/cache" "$WORK/build/node-v0.0.0-linux-x64/bin"
printf '#!/bin/sh\necho v0.0.0\n' > "$WORK/build/node-v0.0.0-linux-x64/bin/node"
chmod +x "$WORK/build/node-v0.0.0-linux-x64/bin/node"
tar -cJf "$WORK/cache/$TARBALL" -C "$WORK/build" node-v0.0.0-linux-x64
SUM="$(sha256sum "$WORK/cache/$TARBALL" | cut -d' ' -f1)"

# make_payload DIR SUM
make_payload() {
    mkdir -p "$1/vault"
    cp "$ROOT"/deploy/bot/{cinemaslime-bot.service,cinemaslime-bot,config.json} "$1/"
    echo 'console.log("bundle")' > "$1/cinemaslime-bot.mjs"
    printf '%s  %s\n' "$2" "$TARBALL" > "$1/node.sha256"
}

# install BOT_ROOT PAYLOAD: runs the installer with fresh credentials and an empty TMPDIR.
install() {
    mkdir -p "$1/etc/cinemaslime-bot/credentials" "$WORK/tmp"
    echo token > "$1/etc/cinemaslime-bot/credentials/discord-token.new"
    echo key > "$1/etc/cinemaslime-bot/credentials/brand-secret-key.new"
    BOT_ROOT="$1" BOT_TEST=1 BOT_NODE_CACHE="$WORK/cache" TMPDIR="$WORK/tmp" bash "$SCRIPT" --payload "$2" 2>&1
}

make_payload "$WORK/good" "$SUM"
first="$(install "$WORK/root" "$WORK/good")" && second="$(install "$WORK/root" "$WORK/good")"
if [ $? -eq 0 ] && [ "$("$WORK/root/opt/cinemaslime-node/current/bin/node")" = v0.0.0 ]; then
    pass 'installs the pinned Node and converges on a re-run'
else
    fail "install: $first $second"
fi

if grep -q 'would daemon-reload, restart' <<<"$second"; then
    pass 'an unchanged re-run still restarts the bot'
else
    fail "unchanged re-run did not restart: $second"
fi

make_payload "$WORK/bad" "$(printf '0%.0s' {1..64})"
rm -rf "$WORK/tmp"
if out="$(install "$WORK/root2" "$WORK/bad")"; then
    fail "a sha256 mismatch was accepted: $out"
elif grep -q 'sha256 mismatch' <<<"$out" && [ -z "$(ls -A "$WORK/tmp")" ]; then
    pass 'a sha256 mismatch fails and leaves no temp directory'
else
    fail "sha256 mismatch: $out; left in TMPDIR: $(ls -A "$WORK/tmp")"
fi

[ "$FAILS" -eq 0 ] || { echo "$FAILS failed"; exit 1; }
echo 'all passed'
