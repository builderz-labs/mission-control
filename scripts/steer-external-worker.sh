#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="$ROOT_DIR/.data/mission-control.db"
WORKER_ID="${WORKER_ID:-}"
NOTE="${NOTE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker-id) WORKER_ID="$2"; shift 2 ;;
    --note) NOTE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
if [[ -z "$WORKER_ID" || -z "$NOTE" ]]; then
  echo "need --worker-id and --note" >&2
  exit 1
fi
node - "$DB_PATH" "$WORKER_ID" "$NOTE" <<'NODE'
const cp = require('child_process')
const Database = require('better-sqlite3')
const [dbPath, workerId, note] = process.argv.slice(2)
const db = new Database(dbPath)
const row = db.prepare(`SELECT * FROM external_workers WHERE id = ?`).get(Number(workerId))
if (!row) throw new Error(`worker ${workerId} not found`)
cp.execFileSync('tmux', ['send-keys', '-t', row.tmux_session, note, 'Enter'])
const now = Math.floor(Date.now()/1000)
db.prepare(`UPDATE external_workers SET status = 'running', latest_note = ?, updated_at = ? WHERE id = ?`).run(`Steered by Jim: ${note}`, now, Number(workerId))
console.log(JSON.stringify({ ok: true, workerId: Number(workerId), tmux_session: row.tmux_session, note }, null, 2))
NODE
