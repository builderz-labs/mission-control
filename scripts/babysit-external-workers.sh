#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="$ROOT_DIR/.data/mission-control.db"
WORKSPACE_ID="${WORKSPACE_ID:-1}"

node - "$DB_PATH" "$WORKSPACE_ID" <<'NODE'
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const Database = require('better-sqlite3')
const [dbPath, workspaceId] = process.argv.slice(2)
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
function sh(cmd, cwd) {
  try { return cp.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim() } catch (e) { return String(e.stderr || e.stdout || e.message || '').trim() }
}
function alive(session) {
  try { cp.execSync(`tmux has-session -t ${JSON.stringify(session)}`, { stdio: 'ignore' }); return true } catch { return false }
}
function tail(file) {
  if (!file || !fs.existsSync(file)) return ''
  const text = fs.readFileSync(file, 'utf8')
  return text.length > 4000 ? text.slice(-4000) : text
}
function classify(row, logTail, gitStatus, isAlive) {
  const lower = `${logTail}\n${gitStatus}`.toLowerCase()
  if (/needs steer|question for jim|waiting for input|blocked on/.test(lower)) return 'needs_steer'
  if (/test failed|ci failed|lint failed|merge conflict|permission denied|no such file|command not found/.test(lower)) return 'retryable'
  if (/blocked|cannot continue|waiting on dependency/.test(lower)) return 'blocked'
  if (/done gate passed|ready for review|tests passed/.test(lower) && !isAlive) return 'ready_for_review'
  if (isAlive) return 'running'
  return Number(row.done_gate_passed) === 1 ? 'done' : 'retryable'
}
const rows = db.prepare(`SELECT * FROM external_workers WHERE workspace_id = ? ORDER BY id DESC`).all(Number(workspaceId || 1))
const now = Math.floor(Date.now()/1000)
const out = []
for (const row of rows) {
  if (!['queued','running','blocked','needs_steer','retryable','ready_for_review'].includes(row.status)) continue
  const isAlive = alive(row.tmux_session)
  const gitStatus = sh('git status --short --branch', row.worktree_path)
  const logTail = tail(row.log_path)
  const gatePath = path.join(row.worktree_path, 'DONE_GATE.md')
  const gatePass = fs.existsSync(gatePath) && /pass|passed|green/i.test(fs.readFileSync(gatePath,'utf8')) ? 1 : 0
  let status = classify(row, logTail, gitStatus, isAlive)
  if (!isAlive && gatePass === 1) status = 'done'
  if (status === 'done' && gatePass !== 1) status = 'ready_for_review'
  let note = `tmux:${isAlive ? 'alive' : 'exited'} | git:${(gitStatus.split('\n')[0] || 'clean')}`
  if (status === 'needs_steer') note = 'Worker needs steering from Jim'
  if (status === 'retryable') note = 'Worker requires diagnosis before any retry'
  if (status === 'ready_for_review') note = 'Worker exited and is awaiting review/done gate'
  if (status === 'done') note = 'Done gate passed'
  db.prepare(`UPDATE external_workers SET status = ?, latest_artifact = ?, latest_note = ?, done_gate_passed = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
    .run(status, gatePass ? gatePath : row.latest_artifact, note, gatePass, isAlive ? row.completed_at : (row.completed_at || now), now, row.id)
  out.push({ workerId: row.id, status, note, done_gate_passed: gatePass, tmux_alive: isAlive })
}
console.log(JSON.stringify({ ok: true, results: out }, null, 2))
NODE
