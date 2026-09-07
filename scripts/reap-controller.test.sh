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

echo "reap-controller: a prior controller is reaped by working directory, bystanders and ancestors are not"
