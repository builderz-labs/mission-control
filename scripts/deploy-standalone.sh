#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BRANCH="${BRANCH:-$(git -C "$PROJECT_ROOT" branch --show-current)}"
PORT="${PORT:-3000}"
LISTEN_HOST="${MC_HOSTNAME:-0.0.0.0}"
LOG_PATH="${LOG_PATH:-/tmp/mc.log}"
VERIFY_HOST="${VERIFY_HOST:-127.0.0.1}"
PID_FILE="${PID_FILE:-$PROJECT_ROOT/.next/standalone/server.pid}"
SOURCE_DATA_DIR="$PROJECT_ROOT/.data"
BUILD_DATA_DIR="$PROJECT_ROOT/.next/build-runtime"
NODE_VERSION_FILE="$PROJECT_ROOT/.nvmrc"

use_project_node() {
  if [[ ! -f "$NODE_VERSION_FILE" ]]; then
    return
  fi

  if [[ -z "${NVM_DIR:-}" ]]; then
    export NVM_DIR="$HOME/.nvm"
  fi

  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    nvm use >/dev/null
  fi
}

list_listener_pids() {
  local combined=""

  if command -v lsof >/dev/null 2>&1; then
    combined+="$(
      lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
    )"$'\n'
  fi

  if command -v ss >/dev/null 2>&1; then
    combined+="$(
      ss -ltnp 2>/dev/null | awk -v port=":$PORT" '
        index($4, port) || index($5, port) {
          if (match($0, /pid=[0-9]+/)) {
            print substr($0, RSTART + 4, RLENGTH - 4)
          }
        }
      '
    )"$'\n'
  fi

  printf '%s\n' "$combined" | awk -v port="$PORT" '
    /^[0-9]+$/ {
      seen[$0] = 1
    }
    END {
      for (pid in seen) {
        print pid
      }
    }
  ' | sort -u
}

stop_pid() {
  local pid="$1"
  local label="$2"

  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  echo "==> stopping $label (pid=$pid)"
  kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return
    fi
    sleep 1
  done

  echo "==> force stopping $label (pid=$pid)"
  kill -9 "$pid" 2>/dev/null || true
}

stop_existing_server() {
  local -a candidate_pids=()

  if [[ -f "$PID_FILE" ]]; then
    candidate_pids+=("$(cat "$PID_FILE" 2>/dev/null || true)")
  fi

  while IFS= read -r pid; do
    candidate_pids+=("$pid")
  done < <(list_listener_pids)

  if command -v pgrep >/dev/null 2>&1; then
    while IFS= read -r pid; do
      candidate_pids+=("$pid")
    done < <(pgrep -f "$PROJECT_ROOT/.next/standalone/server.js" || true)
  fi

  if [[ ${#candidate_pids[@]} -eq 0 ]]; then
    return
  fi

  declare -A seen=()
  for pid in "${candidate_pids[@]}"; do
    [[ -z "$pid" ]] && continue
    [[ -n "${seen[$pid]:-}" ]] && continue
    seen[$pid]=1
    stop_pid "$pid" "standalone server"
  done

  for _ in $(seq 1 10); do
    if [[ -z "$(list_listener_pids | head -n1)" ]]; then
      rm -f "$PID_FILE"
      return
    fi
    sleep 1
  done

  echo "error: port $PORT is still in use after stopping existing server" >&2
  exit 1
}

load_env() {
  set -a
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    source .env
  fi
  if [[ -f .env.local ]]; then
    # shellcheck disable=SC1091
    source .env.local
  fi
  set +a
}

migrate_runtime_data_dir() {
  local target_data_dir="${MISSION_CONTROL_DATA_DIR:-$SOURCE_DATA_DIR}"

  if [[ "$target_data_dir" == "$SOURCE_DATA_DIR" ]]; then
    return
  fi

  mkdir -p "$target_data_dir"

  local source_db="$SOURCE_DATA_DIR/mission-control.db"
  local target_db="$target_data_dir/mission-control.db"

  if [[ -s "$target_db" || ! -s "$source_db" ]]; then
    return
  fi

  echo "==> migrating runtime data to $target_data_dir"
  if command -v sqlite3 >/dev/null 2>&1; then
    local target_db_tmp="$target_db.tmp"
    rm -f "$target_db_tmp"
    sqlite3 "$source_db" ".backup '$target_db_tmp'"
    mv "$target_db_tmp" "$target_db"

    if [[ -f "$SOURCE_DATA_DIR/mission-control-tokens.json" ]]; then
      cp "$SOURCE_DATA_DIR/mission-control-tokens.json" "$target_data_dir/mission-control-tokens.json"
    fi
    if [[ -d "$SOURCE_DATA_DIR/backups" ]]; then
      rsync -a "$SOURCE_DATA_DIR/backups"/ "$target_data_dir/backups"/
    fi
  else
    rsync -a \
      --exclude 'mission-control.db-shm' \
      --exclude 'mission-control.db-wal' \
      --exclude '*.db-shm' \
      --exclude '*.db-wal' \
      "$SOURCE_DATA_DIR"/ "$target_data_dir"/
  fi
}

cd "$PROJECT_ROOT"
use_project_node

echo "==> fetching branch $BRANCH"
git fetch origin "$BRANCH"
git merge --ff-only FETCH_HEAD

load_env
migrate_runtime_data_dir

echo "==> stopping existing standalone server before rebuild"
stop_existing_server

echo "==> installing dependencies"
pnpm install --frozen-lockfile

echo "==> rebuilding standalone bundle"
rm -rf .next
mkdir -p "$BUILD_DATA_DIR"
MISSION_CONTROL_DATA_DIR="$BUILD_DATA_DIR" \
MISSION_CONTROL_DB_PATH="$BUILD_DATA_DIR/mission-control.db" \
MISSION_CONTROL_TOKENS_PATH="$BUILD_DATA_DIR/mission-control-tokens.json" \
pnpm build

echo "==> starting standalone server"
load_env

PORT="$PORT" HOSTNAME="$LISTEN_HOST" nohup bash "$PROJECT_ROOT/scripts/start-standalone.sh" >"$LOG_PATH" 2>&1 &
new_pid=$!
echo "$new_pid" > "$PID_FILE"

echo "==> verifying process and static assets"
for _ in $(seq 1 20); do
  if curl -fsS "http://$VERIFY_HOST:$PORT/login" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

login_html="$(curl -fsS "http://$VERIFY_HOST:$PORT/login")"
css_path="$(printf '%s\n' "$login_html" | sed -n 's|.*\(/_next/static/chunks/[^"]*\.css\).*|\1|p' | sed -n '1p')"
if [[ -z "${css_path:-}" ]]; then
  echo "error: no css asset found in rendered login HTML" >&2
  exit 1
fi

listener_pid="$(list_listener_pids | head -n1)"
if [[ -z "${listener_pid:-}" ]]; then
  echo "error: no listener detected on port $PORT after startup" >&2
  exit 1
fi
if [[ "$listener_pid" != "$new_pid" ]]; then
  echo "error: port $PORT is owned by pid=$listener_pid, expected new pid=$new_pid" >&2
  exit 1
fi

css_disk_path="$PROJECT_ROOT/.next/standalone/.next${css_path#/_next}"
if [[ ! -f "$css_disk_path" ]]; then
  echo "error: rendered css asset missing on disk: $css_disk_path" >&2
  exit 1
fi

content_type="$(curl -fsSI "http://$VERIFY_HOST:$PORT$css_path" | awk 'BEGIN{IGNORECASE=1} /^content-type:/ {print $2}' | tr -d '\r')"
if [[ "${content_type:-}" != text/css* ]]; then
  echo "error: css asset served with unexpected content-type: ${content_type:-missing}" >&2
  exit 1
fi

echo "==> deployed commit $(git rev-parse --short HEAD)"
echo "    pid=$new_pid port=$PORT css=$css_path"
