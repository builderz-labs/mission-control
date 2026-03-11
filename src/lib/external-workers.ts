import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getDatabase, db_helpers, logAuditEvent } from './db'
import { runCommand, runOpenClaw } from './command'
import { config, ensureDirExists } from './config'
import { logger } from './logger'

export type ExternalWorkerTool = 'codex' | 'claude'
export type ExternalWorkerStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'needs_steer'
  | 'retryable'
  | 'ready_for_review'
  | 'done'
  | 'failed'
  | 'stopped'

export interface ExternalWorkerRecord {
  id: number
  workspace_id: number
  task_id?: number | null
  role_owner: string
  tool: ExternalWorkerTool
  model?: string | null
  branch: string
  worktree_path: string
  tmux_session: string
  prompt_path?: string | null
  retry_packet_path?: string | null
  latest_artifact?: string | null
  latest_note?: string | null
  started_at: number
  updated_at: number
  completed_at?: number | null
  status: ExternalWorkerStatus
  retry_count: number
  pid?: number | null
  log_path?: string | null
  done_gate_passed: number
  metadata?: string | null
}

export interface SpawnExternalWorkerInput {
  taskId?: number
  roleOwner: string
  tool: ExternalWorkerTool
  model?: string
  branch?: string
  taskTitle: string
  prompt: string
  repoPath?: string
  baseRef?: string
}

const WORKERS_ROOT = path.join(config.dataDir, 'external-workers')
const LOGS_ROOT = path.join(WORKERS_ROOT, 'logs')
const PACKETS_ROOT = path.join(WORKERS_ROOT, 'packets')
const WORKTREES_ROOT = path.join(WORKERS_ROOT, 'worktrees')

function nowUnix() {
  return Math.floor(Date.now() / 1000)
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task'
}

function parseMetadata(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export function ensureExternalWorkerDirs() {
  for (const dir of [WORKERS_ROOT, LOGS_ROOT, PACKETS_ROOT, WORKTREES_ROOT]) ensureDirExists(dir)
}

export async function assertExternalWorkerDependencies() {
  const missing: string[] = []
  for (const bin of ['git', 'tmux']) {
    try {
      await runCommand('bash', ['-lc', `command -v ${bin}`])
    } catch {
      missing.push(bin)
    }
  }
  return { ok: missing.length === 0, missing }
}

export function listExternalWorkers(workspaceId: number = 1): ExternalWorkerRecord[] {
  const db = getDatabase()
  return db.prepare(`SELECT * FROM external_workers WHERE workspace_id = ? ORDER BY started_at DESC, id DESC`).all(workspaceId) as ExternalWorkerRecord[]
}

export function getExternalWorkerById(id: number, workspaceId: number = 1): ExternalWorkerRecord | null {
  const db = getDatabase()
  return (db.prepare(`SELECT * FROM external_workers WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as ExternalWorkerRecord | undefined) || null
}

function insertExternalWorker(row: Omit<ExternalWorkerRecord, 'id'>): ExternalWorkerRecord {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO external_workers (
      workspace_id, task_id, role_owner, tool, model, branch, worktree_path, tmux_session,
      prompt_path, retry_packet_path, latest_artifact, latest_note, started_at, updated_at,
      completed_at, status, retry_count, pid, log_path, done_gate_passed, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.workspace_id,
    row.task_id ?? null,
    row.role_owner,
    row.tool,
    row.model ?? null,
    row.branch,
    row.worktree_path,
    row.tmux_session,
    row.prompt_path ?? null,
    row.retry_packet_path ?? null,
    row.latest_artifact ?? null,
    row.latest_note ?? null,
    row.started_at,
    row.updated_at,
    row.completed_at ?? null,
    row.status,
    row.retry_count,
    row.pid ?? null,
    row.log_path ?? null,
    row.done_gate_passed,
    row.metadata ?? null,
  )
  return getExternalWorkerById(Number(result.lastInsertRowid), row.workspace_id)!
}

export function updateExternalWorker(id: number, updates: Partial<ExternalWorkerRecord>, workspaceId: number = 1) {
  const current = getExternalWorkerById(id, workspaceId)
  if (!current) throw new Error(`External worker ${id} not found`)
  const next = { ...current, ...updates, updated_at: nowUnix() }
  const db = getDatabase()
  db.prepare(`
    UPDATE external_workers SET
      task_id = ?, role_owner = ?, tool = ?, model = ?, branch = ?, worktree_path = ?, tmux_session = ?,
      prompt_path = ?, retry_packet_path = ?, latest_artifact = ?, latest_note = ?,
      updated_at = ?, completed_at = ?, status = ?, retry_count = ?, pid = ?, log_path = ?,
      done_gate_passed = ?, metadata = ?
    WHERE id = ? AND workspace_id = ?
  `).run(
    next.task_id ?? null,
    next.role_owner,
    next.tool,
    next.model ?? null,
    next.branch,
    next.worktree_path,
    next.tmux_session,
    next.prompt_path ?? null,
    next.retry_packet_path ?? null,
    next.latest_artifact ?? null,
    next.latest_note ?? null,
    next.updated_at,
    next.completed_at ?? null,
    next.status,
    next.retry_count,
    next.pid ?? null,
    next.log_path ?? null,
    next.done_gate_passed,
    next.metadata ?? null,
    id,
    workspaceId,
  )
  return getExternalWorkerById(id, workspaceId)!
}

function buildWorkerCommand(tool: ExternalWorkerTool, promptFile: string, model?: string) {
  const escapedPromptFile = `'${promptFile.replace(/'/g, `'\\''`)}'`
  if (tool === 'claude') {
    const modelArg = model ? ` --model ${JSON.stringify(model)}` : ''
    return `claude --permission-mode bypassPermissions --print${modelArg} "$(cat ${escapedPromptFile})"`
  }
  const modelArg = model ? ` --model ${JSON.stringify(model)}` : ''
  return `codex exec --full-auto${modelArg} "$(cat ${escapedPromptFile})"`
}

export async function spawnExternalWorker(input: SpawnExternalWorkerInput, workspaceId: number = 1) {
  ensureExternalWorkerDirs()
  const deps = await assertExternalWorkerDependencies()
  if (!deps.ok) {
    throw new Error(`Missing required dependencies: ${deps.missing.join(', ')}`)
  }

  const taskSlug = slugify(input.taskTitle)
  const taskRef = input.taskId ? `task-${input.taskId}` : `adhoc-${Date.now()}`
  const branch = input.branch || `worker/${taskRef}-${taskSlug}`
  const sessionName = `mc-${taskRef}-${Date.now().toString(36)}`.slice(0, 64)
  const worktreePath = path.join(WORKTREES_ROOT, `${taskRef}-${Date.now()}`)
  const packetDir = path.join(PACKETS_ROOT, taskRef)
  const logPath = path.join(LOGS_ROOT, `${sessionName}.log`)
  const promptPath = path.join(packetDir, 'prompt.txt')
  const repoPath = input.repoPath || process.cwd()
  const baseRef = input.baseRef || 'HEAD'

  ensureDirExists(packetDir)
  fs.writeFileSync(promptPath, input.prompt)

  await runCommand('git', ['worktree', 'add', '-b', branch, worktreePath, baseRef], { cwd: repoPath, timeoutMs: 120_000 })

  const workerCmd = buildWorkerCommand(input.tool, promptPath, input.model)
  const shellCommand = [
    `cd ${JSON.stringify(worktreePath)}`,
    `mkdir -p ${JSON.stringify(path.dirname(logPath))}`,
    `printf "[%s] worker-start\\n" "$(date -Is)" | tee -a ${JSON.stringify(logPath)}`,
    `(${workerCmd}) 2>&1 | tee -a ${JSON.stringify(logPath)}`,
    `status=$?`,
    `printf "[%s] worker-exit status=%s\\n" "$(date -Is)" "$status" | tee -a ${JSON.stringify(logPath)}`,
    `exit $status`,
  ].join(' && ')

  await runCommand('tmux', ['new-session', '-d', '-s', sessionName, 'bash', '-lc', shellCommand], { timeoutMs: 30_000 })

  const record = insertExternalWorker({
    workspace_id: workspaceId,
    task_id: input.taskId ?? null,
    role_owner: input.roleOwner,
    tool: input.tool,
    model: input.model ?? null,
    branch,
    worktree_path: worktreePath,
    tmux_session: sessionName,
    prompt_path: promptPath,
    retry_packet_path: null,
    latest_artifact: null,
    latest_note: 'Spawned worker',
    started_at: nowUnix(),
    updated_at: nowUnix(),
    completed_at: null,
    status: 'running',
    retry_count: 0,
    pid: null,
    log_path: logPath,
    done_gate_passed: 0,
    metadata: JSON.stringify({ baseRef, repoPath, taskTitle: input.taskTitle }),
  })

  db_helpers.logActivity('external_worker_spawned', 'task', input.taskId || 0, input.roleOwner, `Spawned ${input.tool} worker ${record.tmux_session}`, { workerId: record.id, branch, worktreePath }, workspaceId)
  logAuditEvent({ action: 'external_worker_spawned', actor: input.roleOwner, target_type: 'external_worker', target_id: record.id, detail: { tool: input.tool, branch, task_id: input.taskId ?? null } })
  return record
}

async function tmuxSessionAlive(session: string) {
  try {
    await runCommand('tmux', ['has-session', '-t', session], { timeoutMs: 10_000 })
    return true
  } catch {
    return false
  }
}

async function readFileTail(filePath?: string | null, maxChars: number = 4000) {
  if (!filePath || !fs.existsSync(filePath)) return ''
  const text = fs.readFileSync(filePath, 'utf8')
  return text.length > maxChars ? text.slice(-maxChars) : text
}

async function getGitStatus(worktreePath: string) {
  try {
    const status = await runCommand('git', ['status', '--short', '--branch'], { cwd: worktreePath, timeoutMs: 20_000 })
    return status.stdout.trim()
  } catch (err: any) {
    return `git status failed: ${err.message}`
  }
}

function classifyFromSignals(worker: ExternalWorkerRecord, tail: string, alive: boolean, gitStatus: string) {
  const lower = `${tail}\n${gitStatus}`.toLowerCase()
  if (/done gate passed|ready for review|qa passed|tests passed/.test(lower) && !alive) return 'ready_for_review' as const
  if (/done gate passed/.test(lower) && /merged|complete|done/.test(lower)) return 'done' as const
  if (/needs steer|question for jim|waiting for input|blocked on/.test(lower)) return 'needs_steer' as const
  if (/test failed|ci failed|lint failed|merge conflict|permission denied|missing required dependencies/.test(lower)) return 'retryable' as const
  if (/blocked|cannot continue|waiting on dependency/.test(lower)) return 'blocked' as const
  if (alive) return 'running' as const
  return worker.done_gate_passed ? 'done' as const : 'retryable' as const
}

export async function babysitExternalWorkers(workspaceId: number = 1) {
  ensureExternalWorkerDirs()
  const rows = listExternalWorkers(workspaceId).filter((row) => ['queued', 'running', 'blocked', 'needs_steer', 'retryable', 'ready_for_review'].includes(row.status))
  const results: Array<{ workerId: number; status: ExternalWorkerStatus; note: string }> = []

  for (const row of rows) {
    const alive = await tmuxSessionAlive(row.tmux_session)
    const gitStatus = await getGitStatus(row.worktree_path)
    const tail = await readFileTail(row.log_path)
    const nextStatus = classifyFromSignals(row, tail, alive, gitStatus)

    let latestArtifact = row.latest_artifact
    const reviewPath = path.join(row.worktree_path, 'DONE_GATE.md')
    const doneGatePassed = fs.existsSync(reviewPath) && /pass|passed|green/i.test(fs.readFileSync(reviewPath, 'utf8')) ? 1 : row.done_gate_passed
    if (doneGatePassed) latestArtifact = reviewPath

    let note = `tmux:${alive ? 'alive' : 'exited'} | git:${gitStatus.split('\n')[0] || 'clean'}`
    if (nextStatus === 'needs_steer') note = 'Worker needs steering from Jim'
    if (nextStatus === 'retryable') note = 'Worker requires diagnosis before any retry'
    if (nextStatus === 'ready_for_review') note = 'Worker exited and appears ready for review'
    if (nextStatus === 'done' && !doneGatePassed) note = 'Done signal ignored until done gate passes'

    const finalStatus = nextStatus === 'done' && !doneGatePassed ? 'ready_for_review' : nextStatus
    updateExternalWorker(row.id, {
      status: finalStatus,
      latest_artifact: latestArtifact,
      latest_note: note,
      done_gate_passed: doneGatePassed,
      completed_at: !alive ? nowUnix() : row.completed_at,
      metadata: JSON.stringify({ ...parseMetadata(row.metadata), babysat_at: nowUnix(), gitStatus }),
    }, workspaceId)

    results.push({ workerId: row.id, status: finalStatus, note })

    if (['needs_steer', 'retryable', 'blocked'].includes(finalStatus)) {
      db_helpers.createNotification(
        'system',
        'external_worker_attention',
        `External worker ${finalStatus}`,
        `Worker #${row.id} (${row.tool}/${row.role_owner}) is ${finalStatus}: ${note}`,
        'task',
        row.task_id || undefined,
        workspaceId,
      )
    }
  }

  return { ok: true, message: `Babysat ${results.length} external worker(s)`, results }
}

export async function steerExternalWorker(workerId: number, note: string, workspaceId: number = 1) {
  const worker = getExternalWorkerById(workerId, workspaceId)
  if (!worker) throw new Error(`Worker ${workerId} not found`)
  await runCommand('tmux', ['send-keys', '-t', worker.tmux_session, note, 'Enter'], { timeoutMs: 10_000 })
  updateExternalWorker(workerId, { status: 'running', latest_note: `Steered by Jim: ${note}` }, workspaceId)
  db_helpers.logActivity('external_worker_steered', 'task', worker.task_id || 0, worker.role_owner, `Steered external worker ${worker.tmux_session}`, { workerId, note }, workspaceId)
  return getExternalWorkerById(workerId, workspaceId)!
}

export function buildRetryPacket(workerId: number, diagnosis: string, correctedContext: string, narrowedScope: string, doNotRepeat: string[], workspaceId: number = 1) {
  const worker = getExternalWorkerById(workerId, workspaceId)
  if (!worker) throw new Error(`Worker ${workerId} not found`)
  ensureExternalWorkerDirs()
  const packetPath = path.join(PACKETS_ROOT, `worker-${workerId}-retry-${worker.retry_count + 1}.md`)
  const body = `# Ralph Loop V2 Retry Packet\n\n- Worker ID: ${workerId}\n- Tool: ${worker.tool}\n- Model: ${worker.model || 'default'}\n- Branch: ${worker.branch}\n- Worktree: ${worker.worktree_path}\n- Retry Count: ${worker.retry_count + 1}\n\n## Diagnosis\n${diagnosis}\n\n## Corrected Context\n${correctedContext}\n\n## Narrowed Scope\n${narrowedScope}\n\n## Do Not Repeat\n${doNotRepeat.map((item) => `- ${item}`).join('\n')}\n\n## Required Finish Condition\nDo not claim success until the done gate passes. If blocked, say exactly why and what missing input is required.\n`
  fs.writeFileSync(packetPath, body)
  updateExternalWorker(workerId, { retry_packet_path: packetPath, retry_count: worker.retry_count + 1, latest_note: 'Retry packet prepared; awaiting explicit respawn' }, workspaceId)
  return { path: packetPath, content: body }
}

export async function notifyWake(text: string) {
  try {
    await runOpenClaw(['system', 'event', '--text', text, '--mode', 'now'], { timeoutMs: 20_000 })
  } catch (err) {
    logger.warn({ err }, 'Failed to send wake notification for external worker event')
  }
}
