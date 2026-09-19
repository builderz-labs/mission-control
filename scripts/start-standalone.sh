#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$PROJECT_ROOT/scripts/load-env.sh"
STANDALONE_DIR="$PROJECT_ROOT/.next/standalone"
STANDALONE_NEXT_DIR="$STANDALONE_DIR/.next"
STANDALONE_STATIC_DIR="$STANDALONE_NEXT_DIR/static"
SOURCE_STATIC_DIR="$PROJECT_ROOT/.next/static"
SOURCE_PUBLIC_DIR="$PROJECT_ROOT/public"
STANDALONE_PUBLIC_DIR="$STANDALONE_DIR/public"

if [[ ! -f "$STANDALONE_DIR/server.js" ]]; then
  echo "error: standalone server missing at $STANDALONE_DIR/server.js" >&2
  echo "run 'pnpm build' first" >&2
  exit 1
fi

mkdir -p "$STANDALONE_NEXT_DIR"

if [[ -d "$SOURCE_STATIC_DIR" ]]; then
  rm -rf "$STANDALONE_STATIC_DIR"
  cp -R "$SOURCE_STATIC_DIR" "$STANDALONE_STATIC_DIR"
fi

if [[ -d "$SOURCE_PUBLIC_DIR" ]]; then
  rm -rf "$STANDALONE_PUBLIC_DIR"
  cp -R "$SOURCE_PUBLIC_DIR" "$STANDALONE_PUBLIC_DIR"
fi
if [[ ! -s "$STANDALONE_PUBLIC_DIR/brand/mc-logo-128.png" ]]; then
  echo "error: standalone public brand assets missing at $STANDALONE_PUBLIC_DIR/brand/mc-logo-128.png" >&2
  exit 1
fi

cd "$STANDALONE_DIR"

# Load .env as literal configuration if it exists (consistent with Docker).
# NEXT_PUBLIC_* vars are already baked into the bundle at build time,
# but server-side vars (AUTH_*, OPENCLAW_*, etc.) need this to take effect.
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  load_env_file "$PROJECT_ROOT/.env"
fi

export MISSION_CONTROL_DATA_DIR="${MISSION_CONTROL_DATA_DIR:-$PROJECT_ROOT/.data}"

# `launchctl kickstart -k` replaces the doppler wrapper but not the node server
# doppler forked from it: that server survives, reparented to PID 1, and keeps
# polling this database with the build it was started from. Two builds sharing
# one durable queue mis-attribute rows, so reap a prior controller before binding.
#
# No single signal finds it reliably:
#   - the port and the database handle are both released early in shutdown, so a
#     reaper that samples either can look at exactly the wrong instant, find
#     nothing, and let a process that then fails to exit come back to life;
#   - a redeploy replaces $STANDALONE_DIR, so the prior controller's cwd points at
#     the old, unlinked inode. `lsof <dir>` matches by inode rather than by path
#     and cannot see it, even though the process still reports that same path.
# Both failures were observed in production. So take the union of all three
# signals to find candidates, then confirm each one by the working directory it
# reports, which stays correct even when the inode behind it is gone. That
# confirmation is what keeps an unrelated database client or port holder safe.
reap_previous_controller() {
  command -v lsof >/dev/null 2>&1 || return 0
  # Never signal ourselves or anything that started us.
  local self ancestors=" $$ "
  self="$(ps -o ppid= -p "$$" 2>/dev/null | tr -d '[:space:]')"
  while [[ -n "$self" && "$self" != 0 && "$self" != 1 ]]; do
    ancestors+="$self "
    self="$(ps -o ppid= -p "$self" 2>/dev/null | tr -d '[:space:]')"
  done

  local db="${MISSION_CONTROL_DATA_DIR:-}/mission-control.db"
  local want want_real pid cwd cwd_real comm path
  want="$STANDALONE_DIR"
  want_real="$(cd "$STANDALONE_DIR" 2>/dev/null && pwd -P || printf '%s' "$STANDALONE_DIR")"

  # Collect candidate PIDs into a temp file — never into a $() that also
  # contains `case …)` / complex expansions (bash ends $() at that paren).
  # Linux CI: path-scoped `lsof -- $dir` returns empty when cwd is the only
  # handle, so discover via pgrep / bare -c, then filter by cwd below.
  local cand_file
  cand_file="$(mktemp "${TMPDIR:-/tmp}/mc-reap-cands.XXXXXX")"
  {
    if command -v pgrep >/dev/null 2>&1; then
      pgrep -x node 2>/dev/null || true
      pgrep -x doppler 2>/dev/null || true
    fi
    # ps pads PIDs with spaces on some hosts — strip before recording.
    ps -eo pid=,comm= 2>/dev/null | while read -r pid comm; do
      if [[ "$comm" == "node" || "$comm" == "doppler" ]]; then
        printf '%s\n' "$(printf '%s' "$pid" | tr -d '[:space:]')"
      fi
    done || true
    # Separate -c queries: `lsof -a -c node -c doppler` ANDs the names and
    # matches nothing.
    lsof -t -c node 2>/dev/null || true
    lsof -t -c doppler 2>/dev/null || true
    lsof -t -a -d cwd -c node -- "$want" 2>/dev/null || true
    lsof -t -a -d cwd -c doppler -- "$want" 2>/dev/null || true
    lsof -t -a -d cwd -c node -- "$want_real" 2>/dev/null || true
    lsof -t -a -d cwd -c doppler -- "$want_real" 2>/dev/null || true
    if [[ -f "$db" ]]; then
      lsof -t -- "$db" 2>/dev/null || true
    fi
    lsof -t -nP -iTCP:"${PORT:-3000}" -sTCP:LISTEN 2>/dev/null || true
  } | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;/^$/d' | sort -u > "$cand_file" || true

  # Linux: also walk /proc for node/doppler whose cwd matches.
  if [[ -d /proc ]]; then
    for path in /proc/[0-9]*/cwd; do
      pid="${path%/cwd}"
      pid="${pid#/proc/}"
      if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
        continue
      fi
      comm="$(tr -d '\0\r\n' < "/proc/$pid/comm" 2>/dev/null || true)"
      if [[ "$comm" != "node" && "$comm" != "doppler" ]]; then
        continue
      fi
      cwd="$(readlink "$path" 2>/dev/null || true)"
      # Strip kernel " (deleted)" suffix (rebuild unlinks the inode).
      if [[ "$cwd" == *" (deleted)" ]]; then
        cwd="${cwd% (deleted)}"
      fi
      cwd_real="$(cd "$cwd" 2>/dev/null && pwd -P || printf '%s' "$cwd")"
      if [[ "$cwd" == "$want" || "$cwd" == "$want_real" || "$cwd_real" == "$want" || "$cwd_real" == "$want_real" ]]; then
        printf '%s\n' "$pid" >> "$cand_file"
      fi
    done
    sort -u -o "$cand_file" "$cand_file" 2>/dev/null || true
  fi

  while read -r pid; do
    [[ -n "$pid" ]] || continue
    [[ "$ancestors" == *" $pid "* ]] && continue
    cwd=""
    if [[ -L "/proc/$pid/cwd" ]]; then
      cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    fi
    if [[ -z "$cwd" ]] && command -v pwdx >/dev/null 2>&1; then
      cwd="$(pwdx "$pid" 2>/dev/null | sed 's/^[0-9]*:[[:space:]]*//')" || true
    fi
    if [[ -z "$cwd" ]]; then
      cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)" || true
    fi
    # lsof -Fn and readlink both report "path (deleted)" after a rebuild.
    if [[ "$cwd" == *" (deleted)" ]]; then
      cwd="${cwd% (deleted)}"
    fi
    [[ -n "$cwd" ]] || continue
    cwd_real="$(cd "$cwd" 2>/dev/null && pwd -P || printf '%s' "$cwd")"
    if [[ "$cwd" != "$want" && "$cwd" != "$want_real" && "$cwd_real" != "$want" && "$cwd_real" != "$want_real" ]]; then
      continue
    fi
    echo "reaping previous controller pid $pid" >&2
    kill -TERM "$pid" 2>/dev/null || true
    # A hung controller has been measured ignoring SIGTERM for a full twenty
    # seconds, so give an orderly exit real time before forcing it.
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
      # SIGKILL returns before the kernel has torn the process down, and the
      # descriptors it is about to release are the port and the database this
      # server is seconds away from taking. Returning here would hand the caller
      # a directory that still has an owner, so wait for the pid to actually go.
      for _ in $(seq 1 50); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
    fi
  done < "$cand_file"
  rm -f "$cand_file"
}

reap_previous_controller

# Next.js standalone server reads HOSTNAME to decide bind address.
# Default to 0.0.0.0 so the server is accessible from outside the host.
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
# Next.js overwrites argv[0] with `next-server (vX.Y.Z)`. A bare `node server.js`
# argv is shorter than that title, so the write runs past the end of the argv
# region and `ps` keeps reading into the adjacent environment block, printing
# API_KEY and every other secret to any local user. Reserving a longer argv[0]
# keeps the title inside its own region. Must stay longer than the Next title.
export MC_PROCESS_NAME="mission-control-standalone-server"
# Load Doppler last so approved values override local dotenv defaults.
# Keep disabled until the launchd identity passes a no-fallback preflight.
if [[ "${MC_USE_DOPPLER:-0}" == "1" ]]; then
  if ! command -v doppler >/dev/null 2>&1; then
    echo "error: Doppler CLI is required when MC_USE_DOPPLER=1" >&2
    exit 1
  fi
  exec doppler run --project mission-control --config prd --no-fallback -- \
    bash -c 'exec -a "${MC_PROCESS_NAME}" node server.js'
fi
exec -a "${MC_PROCESS_NAME}" node server.js
