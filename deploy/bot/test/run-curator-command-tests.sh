#!/usr/bin/env bash
#
# Tests for deploy/bot/curator-command.sh with fake systemctl, journalctl and
# cinemaslime-bot that record what they were asked to do.
#
#   bash deploy/bot/test/run-curator-command-tests.sh      (or: npm run test:bot-command)
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/deploy/bot/curator-command.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }

CALLS="$WORK/calls"
cat > "$WORK/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$CALLS"
EOF
cat > "$WORK/journalctl" <<EOF
#!/usr/bin/env bash
cat "$WORK/journal" 2>/dev/null
EOF
# Prints each argument on its own line so splitting or joining shows up.
cat > "$WORK/bot" <<EOF
#!/usr/bin/env bash
echo "bot" >> "$CALLS"
for arg in "\$@"; do echo "arg[\$arg]" >> "$CALLS"; done
exit "\${BOT_EXIT:-0}"
EOF
chmod +x "$WORK/systemctl" "$WORK/journalctl" "$WORK/bot"

run_script() {
    : > "$CALLS"
    SYSTEMCTL="$WORK/systemctl" JOURNALCTL="$WORK/journalctl" BOT_CLI="$WORK/bot" READY_SECONDS=2 \
        bash "$SCRIPT" "$@" 2> "$WORK/stderr"
}

run_script run standardize --dry-run
status=$?
expected=$'systemctl stop cinemaslime-bot\nbot\narg[standardize]\narg[--dry-run]'
[ "$status" = 0 ] && [ "$(cat "$CALLS")" = "$expected" ] \
    && pass "run stops the daemon, then passes the arguments verbatim" \
    || fail "run stops the daemon, then passes the arguments verbatim (status $status): $(cat "$CALLS")"

run_script run curate 'naddr1 with spaces' --name 'Display Name'
grep -qx 'arg\[naddr1 with spaces\]' "$CALLS" && grep -qx 'arg\[Display Name\]' "$CALLS" \
    && pass "an argument with spaces stays one argument" \
    || fail "an argument with spaces stays one argument: $(cat "$CALLS")"

BOT_EXIT=1 run_script run standardize
status=$?
[ "$status" = 1 ] && grep -q 'cinemaslime-bot exited 1' "$WORK/stderr" \
    && pass "a failing command fails the run" \
    || fail "a failing command fails the run (status $status)"

run_script run
status=$?
[ "$status" != 0 ] && ! grep -q 'systemctl stop' "$CALLS" \
    && pass "run with no command stops nothing" \
    || fail "run with no command stops nothing (status $status)"

echo 'gateway ready as Cinema Slime#0001' > "$WORK/journal"
run_script start
status=$?
[ "$status" = 0 ] && grep -qx 'systemctl start cinemaslime-bot' "$CALLS" && grep -q 'gateway ready as' "$WORK/stderr" \
    && pass "start starts the daemon and waits for gateway ready" \
    || fail "start starts the daemon and waits for gateway ready (status $status)"

echo 'login failed' > "$WORK/journal"
run_script start
status=$?
[ "$status" != 0 ] && grep -q 'did not report gateway ready within 2s' "$WORK/stderr" \
    && pass "start fails when the daemon never reports gateway ready" \
    || fail "start fails when the daemon never reports gateway ready (status $status)"

run_script bogus
[ "$?" != 0 ] && [ ! -s "$CALLS" ] \
    && pass "an unknown mode touches nothing" \
    || fail "an unknown mode touches nothing"

[ "$FAILS" = 0 ] && echo "all curator-command tests passed" || { echo "$FAILS failed"; exit 1; }
