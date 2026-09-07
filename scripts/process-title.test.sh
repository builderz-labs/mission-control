#!/usr/bin/env bash
# Next.js overwrites argv[0] with `next-server (vX.Y.Z)`. When the argv region is
# shorter than that title, the write runs past its end and `ps` keeps reading into
# the adjacent environment block, exposing API_KEY and every other secret to any
# local user. `scripts/start-standalone.sh` reserves a longer argv[0] to stop that.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="$ROOT_DIR/scripts/start-standalone.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mc-process-title.XXXXXX")"
SERVER="$TMP_DIR/server.js"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  rm -f "$SERVER"
  rmdir "$TMP_DIR"
}
trap cleanup EXIT

fail() { echo "process-title: $1" >&2; exit 1; }

# Stand in for the Next.js standalone server: claim the same title, then idle.
cat > "$SERVER" <<'EOF'
process.title = 'next-server (v16.2.11)'
setTimeout(() => {}, 30000)
EOF

# The script must reserve the name and use it for both the Doppler and bare paths.
grep -q 'export MC_PROCESS_NAME=' "$START_SCRIPT" || fail 'start-standalone.sh no longer exports MC_PROCESS_NAME'
[[ "$(grep -c 'exec -a "\${MC_PROCESS_NAME}" node server.js' "$START_SCRIPT")" == "2" ]] \
  || fail 'both the Doppler and bare launch paths must exec node under MC_PROCESS_NAME'

NAME="$(sed -n 's/^export MC_PROCESS_NAME="\(.*\)"$/\1/p' "$START_SCRIPT")"
[[ -n "$NAME" ]] || fail 'could not read MC_PROCESS_NAME from start-standalone.sh'
# Anything shorter than the title Next writes leaves the environment exposed again.
(( ${#NAME} >= 22 )) || fail "MC_PROCESS_NAME is ${#NAME} chars; it must stay at least 22"

# Control: a short argv[0] reproduces the leak, proving the check below can detect it.
( cd "$TMP_DIR" && exec -a n node server.js ) &
PIDS+=($!)
# Fixed: the reserved argv[0] keeps the title inside its own region.
( cd "$TMP_DIR" && exec -a "$NAME" node server.js ) &
PIDS+=($!)
sleep 1

leaked="$(ps -p "${PIDS[0]}" -o command= 2>/dev/null || true)"
protected="$(ps -p "${PIDS[1]}" -o command= 2>/dev/null || true)"

# Which environment string lands next to argv is not ours to choose, so the spill is
# detected by its shape: a NAME=value token has no business in a process title.
spills() { [[ "$1" =~ [A-Za-z_][A-Za-z0-9_]*= ]]; }

if ! spills "$leaked"; then
  echo "process-title: skipping, this host's ps does not expose the spill" >&2
  exit 0
fi

! spills "$protected" || fail "the reserved argv[0] still leaks the environment into ps: $protected"
[[ "$protected" == *'next-server (v16.2.11)'* ]] || fail "unexpected protected title: $protected"

echo "process-title: reserved argv[0] keeps the environment out of ps"
