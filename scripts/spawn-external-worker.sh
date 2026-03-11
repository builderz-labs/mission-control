#!/usr/bin/env bash
set -euo pipefail

ROLE_OWNER="${ROLE_OWNER:-jim}"
TOOL="${TOOL:-codex}"
MODEL="${MODEL:-}"
TASK_ID="${TASK_ID:-}"
TASK_TITLE="${TASK_TITLE:-ad hoc external worker task}"
PROMPT_FILE="${PROMPT_FILE:-}"
PROMPT_TEXT="${PROMPT_TEXT:-}"
REPO_PATH="${REPO_PATH:-$(pwd)}"
BASE_REF="${BASE_REF:-HEAD}"
WORKSPACE_ID="${WORKSPACE_ID:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role-owner) ROLE_OWNER="$2"; shift 2 ;;
    --tool) TOOL="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --task-title) TASK_TITLE="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    --prompt-text) PROMPT_TEXT="$2"; shift 2 ;;
    --repo-path) REPO_PATH="$2"; shift 2 ;;
    --base-ref) BASE_REF="$2"; shift 2 ;;
    --workspace-id) WORKSPACE_ID="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROMPT_FILE" && -z "$PROMPT_TEXT" ]]; then
  echo "need --prompt-file or --prompt-text" >&2
  exit 1
fi

command -v tmux >/dev/null
command -v git >/dev/null
command -v "$TOOL" >/dev/null

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/.data/external-workers"
DB_PATH="$ROOT_DIR/.data/mission-control.db"
LOGS_DIR="$DATA_DIR/logs"
PACKETS_DIR="$DATA_DIR/packets"
WORKTREES_DIR="$DATA_DIR/worktrees"
mkdir -p "$LOGS_DIR" "$PACKETS_DIR" "$WORKTREES_DIR"

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-48
}

TASK_SLUG="$(slugify "$TASK_TITLE")"
TASK_REF="${TASK_ID:+task-$TASK_ID}"
if [[ -z "$TASK_REF" ]]; then TASK_REF="adhoc-$(date +%s)"; fi
STAMP="$(date +%s)"
BRANCH="worker/${TASK_REF}-${TASK_SLUG}"
SESSION="mc-${TASK_REF}-${STAMP}"
SESSION="${SESSION:0:60}"
WORKTREE_PATH="$WORKTREES_DIR/${TASK_REF}-${STAMP}"
PACKET_DIR="$PACKETS_DIR/$TASK_REF"
PROMPT_PATH="$PACKET_DIR/prompt.txt"
LOG_PATH="$LOGS_DIR/$SESSION.log"
mkdir -p "$PACKET_DIR"

if [[ -n "$PROMPT_FILE" ]]; then
  cp "$PROMPT_FILE" "$PROMPT_PATH"
else
  printf "%s\n" "$PROMPT_TEXT" > "$PROMPT_PATH"
fi

git -C "$REPO_PATH" worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_REF"

if [[ "$TOOL" == "claude" ]]; then
  RUNNER="claude --permission-mode bypassPermissions --print"
  if [[ -n "$MODEL" ]]; then RUNNER+=" --model $(printf %q "$MODEL")"; fi
else
  RUNNER="codex exec --full-auto"
  if [[ -n "$MODEL" ]]; then RUNNER+=" --model $(printf %q "$MODEL")"; fi
fi

TMUX_CMD="cd $(printf %q "$WORKTREE_PATH"); prompt=\$(cat $(printf %q "$PROMPT_PATH")); printf '[%s] worker-start\n' \"\$(date -Is)\" | tee -a $(printf %q "$LOG_PATH"); ${RUNNER} \"\$prompt\" 2>&1 | tee -a $(printf %q "$LOG_PATH"); worker_status=\${PIPESTATUS[0]}; printf '[%s] worker-exit status=%s\n' \"\$(date -Is)\" \"\$worker_status\" | tee -a $(printf %q "$LOG_PATH"); exit \$worker_status"

tmux new-session -d -s "$SESSION" "bash -lc $(printf %q "$TMUX_CMD")"

node - "$DB_PATH" "$WORKSPACE_ID" "$TASK_ID" "$ROLE_OWNER" "$TOOL" "$MODEL" "$WORKTREE_PATH" "$SESSION" "$BRANCH" "$PROMPT_PATH" "$LOG_PATH" "$TASK_TITLE" "$REPO_PATH" "$BASE_REF" <<'NODE'
const Database = require('better-sqlite3')
const [dbPath, workspaceId, taskId, roleOwner, tool, model, worktreePath, tmuxSession, branch, promptPath, logPath, taskTitle, repoPath, baseRef] = process.argv.slice(2)
const db = new Database(dbPath)
db.exec(`CREATE TABLE IF NOT EXISTS external_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  task_id INTEGER,
  role_owner TEXT NOT NULL,
  tool TEXT NOT NULL,
  model TEXT,
  worktree_path TEXT NOT NULL,
  tmux_session TEXT NOT NULL,
  branch TEXT NOT NULL,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  retry_count INTEGER NOT NULL DEFAULT 0,
  latest_artifact TEXT,
  latest_note TEXT,
  prompt_path TEXT,
  retry_packet_path TEXT,
  pid INTEGER,
  log_path TEXT,
  done_gate_passed INTEGER NOT NULL DEFAULT 0,
  metadata TEXT
);`)
const now = Math.floor(Date.now()/1000)
const info = { taskTitle, repoPath, baseRef }
const result = db.prepare(`INSERT INTO external_workers (
  workspace_id, task_id, role_owner, tool, model, worktree_path, tmux_session, branch,
  started_at, updated_at, status, retry_count, latest_note, prompt_path, log_path, done_gate_passed, metadata
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 0, 'Spawned worker', ?, ?, 0, ?)`)
.run(Number(workspaceId || 1), taskId ? Number(taskId) : null, roleOwner, tool, model || null, worktreePath, tmuxSession, branch, now, now, promptPath, logPath, JSON.stringify(info))
const row = db.prepare(`SELECT * FROM external_workers WHERE id = ?`).get(Number(result.lastInsertRowid))
console.log(JSON.stringify(row, null, 2))
NODE
