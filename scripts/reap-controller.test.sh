#!/usr/bin/env bash
# `launchctl kickstart -k` leaves the previous node server alive, reparented to
# PID 1. It releases the port and its database handle early in shutdown but can
# then fail to exit, so a reaper that selects on either one samples the wrong
# instant and lets a second scheduler run against the same durable queue. These
# tests pin the selection to the working directory instead.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="$ROOT_DIR/scripts/start-standalone.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mc-reap.XXXXXX")"
STANDALONE_DIR="$TMP_DIR/standalone"
PIDS=()

cleanup() {
  # Capture and re-assert the status first: bash lets the trap's own last command
  # become the script's exit status, which would turn an aborted run into a pass.
  local status=$?
  for pid in "${PIDS[@]:-}"; do kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT

fail() { echo "reap-controller: $1" >&2; exit 1; }

command -v lsof >/dev/null 2>&1 || { echo "reap-controller: skipping, lsof is unavailable" >&2; exit 0; }

mkdir -p "$STANDALONE_DIR"

# Load the reaper exactly as start-standalone.sh defines it, without running the
# rest of the script (which would need a real build and would bind a port).
eval "$(sed -n '/^reap_previous_controller() {$/,/^}$/p' "$START_SCRIPT")"
declare -F reap_previous_controller >/dev/null || fail 'could not load reap_previous_controller from start-standalone.sh'

# A prior controller mid-shutdown: cwd is the standalone directory, but it holds
# no port and no database handle. This is the case the old reaper missed.
cat > "$STANDALONE_DIR/server.js" <<'EOF'
process.on('SIGTERM', () => {}) // Hung shutdown, as observed in production.
setTimeout(() => {}, 60000)
EOF
# Detach both stand-ins so they are reparented to PID 1, exactly as `launchctl
# kickstart -k` leaves the real controller. A direct child would linger as a
# zombie after being signalled, and a zombie still answers `kill -0`, so the
# assertions below could not tell a reaped process from a surviving one.
STALE="$( cd "$STANDALONE_DIR" && bash -c 'node server.js >/dev/null 2>&1 & echo $!' )"
PIDS+=("$STALE")

# A shell someone left sitting in the same directory must never be signalled.
BYSTANDER="$( cd "$STANDALONE_DIR" && bash -c 'sleep 60 >/dev/null 2>&1 & echo $!' )"
PIDS+=("$BYSTANDER")
sleep 1

kill -0 "$STALE" 2>/dev/null || fail 'the stale controller stand-in did not start'

# Run it in a subshell that drops a marker only on the way out, and keep its
# stderr rather than discarding it. bash 3.2 (the system bash on macOS) exits 0
# and skips the EXIT trap when `set -u` aborts a function called with a variable
# assignment prefix, so a reaper that dies on an unset variable would otherwise
# be indistinguishable from one that found nothing to do. The marker does not
# depend on an exit status, so it survives that.
( STANDALONE_DIR="$STANDALONE_DIR" reap_previous_controller 2>"$TMP_DIR/reap.err"
  : > "$TMP_DIR/reap.done" ) || true
[[ -f "$TMP_DIR/reap.done" ]] || fail "the reaper aborted: $(cat "$TMP_DIR/reap.err" 2>/dev/null)"

kill -0 "$STALE" 2>/dev/null && fail "a prior controller holding neither the port nor the database survived the reaper (pid $STALE)"
kill -0 "$BYSTANDER" 2>/dev/null || fail "the reaper signalled an unrelated process in the same directory (pid $BYSTANDER)"

# The reaper must never signal itself or the process tree that started it.
( cd "$STANDALONE_DIR" && STANDALONE_DIR="$STANDALONE_DIR" bash -c "
    $(sed -n '/^reap_previous_controller() {$/,/^}$/p' "$START_SCRIPT")
    reap_previous_controller 2>/dev/null
    echo alive
  " ) > "$TMP_DIR/self.out" 2>/dev/null || fail 'the reaper killed its own shell or an ancestor'
[[ "$(cat "$TMP_DIR/self.out")" == "alive" ]] || fail 'the reaper did not survive its own sweep'


# A redeploy rebuilds $STANDALONE_DIR before the new server starts, which replaces
# the directory. The prior controller's cwd then refers to the old, unlinked inode:
# it still reports the same path, but `lsof <dir>` matches by inode and no longer
# finds it. This was observed in production — the reaper ran, saw nothing, and left
# a second scheduler polling the same durable queue. The database handle is what
# still gives the process away.
DATA_DIR="$TMP_DIR/data"
REBUILT_DIR="$TMP_DIR/rebuilt"
mkdir -p "$DATA_DIR" "$REBUILT_DIR"
: > "$DATA_DIR/mission-control.db"
cat > "$REBUILT_DIR/server.js" <<'EOF'
const fs = require('fs')
fs.openSync(process.env.MC_TEST_DB, 'r')   // hold the database open, as a controller does
process.on('SIGTERM', () => {})            // hung shutdown, as observed in production
setTimeout(() => {}, 60000)
EOF
REBUILT_STALE="$( cd "$REBUILT_DIR" && MC_TEST_DB="$DATA_DIR/mission-control.db" \
  bash -c 'node server.js >/dev/null 2>&1 & echo $!' )"
PIDS+=("$REBUILT_STALE")
sleep 1
kill -0 "$REBUILT_STALE" 2>/dev/null || fail 'the rebuilt-directory stand-in did not start'

# Replace the directory exactly as a build does, then assert the regression
# condition actually holds: a path-based cwd lookup must no longer see it.
rm -rf "$REBUILT_DIR"
mkdir -p "$REBUILT_DIR"
if lsof -t -a -d cwd -c node -- "$REBUILT_DIR" 2>/dev/null | grep -qx "$REBUILT_STALE"; then
  fail 'fixture is wrong: the stand-in is still reachable by directory path after the rebuild'
fi

( STANDALONE_DIR="$REBUILT_DIR" MISSION_CONTROL_DATA_DIR="$DATA_DIR" \
    reap_previous_controller 2>"$TMP_DIR/reap2.err"
  : > "$TMP_DIR/reap2.done" ) || true
[[ -f "$TMP_DIR/reap2.done" ]] || fail "the reaper aborted: $(cat "$TMP_DIR/reap2.err" 2>/dev/null)"

kill -0 "$REBUILT_STALE" 2>/dev/null && fail "a prior controller survived the reaper after the standalone directory was replaced (pid $REBUILT_STALE)"

echo "reap-controller: a prior controller is reaped by working directory or database handle, across a rebuild, and bystanders and ancestors are not"
