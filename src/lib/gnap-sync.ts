/**
 * GNAP Sync Engine — push MC tasks to a Git-Native Agent Protocol repo.
 *
 * SQLite remains the primary store. The GNAP repo is an optional sync target
 * following the same pattern as `github-sync-engine.ts`.
 *
 * Phase 1: MC → GNAP only (push). Pull/bidirectional sync is Phase 2.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '@/lib/logger'

// ── Status / priority mapping ──────────────────────────────────

const MC_TO_GNAP_STATUS: Record<string, string> = {
  backlog: 'backlog',
  pending: 'backlog',
  inbox: 'backlog',
  assigned: 'ready',
  ready: 'ready',
  in_progress: 'in_progress',
  review: 'review',
  quality_review: 'review',
  completed: 'done',
  done: 'done',
  awaiting_owner: 'blocked',
  failed: 'blocked',
  blocked: 'blocked',
  cancelled: 'cancelled',
}

const GNAP_TO_MC_STATUS: Record<string, string> = {
  backlog: 'backlog',
  ready: 'assigned',
  in_progress: 'in_progress',
  review: 'review',
  done: 'done',
  blocked: 'blocked',
  cancelled: 'cancelled',
}

const MC_TO_GNAP_PRIORITY: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
  urgent: 'critical',
}

export function mcStatusToGnap(status: string): string {
  return MC_TO_GNAP_STATUS[status] || 'backlog'
}

export function gnapStatusToMc(state: string): string {
  return GNAP_TO_MC_STATUS[state] || 'inbox'
}

export function mcPriorityToGnap(priority: string): string {
  return MC_TO_GNAP_PRIORITY[priority] || 'medium'
}

// ── GNAP task JSON type ────────────────────────────────────────

export interface GnapTask {
  id: string
  title: string
  description: string
  state: string
  assignee: string
  priority: string
  tags: string[]
  created: string
  updated: string
  mc_id: number
  mc_project_id: number | null
}

// ── Git helpers ────────────────────────────────────────────────

function git(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() || ''
    throw new Error(`git ${args[0]} failed: ${stderr || err.message}`)
  }
}

function hasRemote(repoPath: string): boolean {
  try {
    const remotes = git(repoPath, ['remote'])
    return remotes.length > 0
  } catch {
    return false
  }
}

function hasChanges(repoPath: string): boolean {
  try {
    const status = git(repoPath, ['status', '--porcelain'])
    return status.length > 0
  } catch {
    return false
  }
}

// ── Core functions ─────────────────────────────────────────────

export function initGnapRepo(repoPath: string): void {
  fs.mkdirSync(path.join(repoPath, 'tasks'), { recursive: true })

  const versionFile = path.join(repoPath, 'version')
  if (!fs.existsSync(versionFile)) {
    fs.writeFileSync(versionFile, '1\n')
  }

  const agentsFile = path.join(repoPath, 'agents.json')
  if (!fs.existsSync(agentsFile)) {
    fs.writeFileSync(agentsFile, JSON.stringify({ agents: [] }, null, 2) + '\n')
  }

  // Init git if not already a repo
  const gitDir = path.join(repoPath, '.git')
  if (!fs.existsSync(gitDir)) {
    git(repoPath, ['init'])
    git(repoPath, ['add', '.'])
    git(repoPath, ['commit', '-m', 'Initialize GNAP repository'])
  }

  logger.info({ repoPath }, 'GNAP repo initialized')
}

export interface McTask {
  id: number
  title: string
  description?: string | null
  status: string
  priority: string
  assigned_to?: string | null
  tags?: string[] | string | null
  created_at?: number | null
  updated_at?: number | null
  project_id?: number | null
}

function taskToGnapJson(task: McTask): GnapTask {
  const tags = Array.isArray(task.tags)
    ? task.tags
    : (typeof task.tags === 'string' ? JSON.parse(task.tags || '[]') : [])

  return {
    id: `mc-${task.id}`,
    title: task.title,
    description: task.description || '',
    state: mcStatusToGnap(task.status),
    assignee: task.assigned_to || '',
    priority: mcPriorityToGnap(task.priority),
    tags,
    created: task.created_at
      ? new Date(task.created_at * 1000).toISOString()
      : new Date().toISOString(),
    updated: task.updated_at
      ? new Date(task.updated_at * 1000).toISOString()
      : new Date().toISOString(),
    mc_id: task.id,
    mc_project_id: task.project_id ?? null,
  }
}

export function pushTaskToGnap(task: McTask, repoPath: string): void {
  const tasksDir = path.join(repoPath, 'tasks')
  fs.mkdirSync(tasksDir, { recursive: true })

  const gnapTask = taskToGnapJson(task)
  const filePath = path.join(tasksDir, `${gnapTask.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(gnapTask, null, 2) + '\n')

  git(repoPath, ['add', path.relative(repoPath, filePath)])

  if (hasChanges(repoPath)) {
    git(repoPath, ['commit', '-m', `Update task ${gnapTask.id}: ${task.title}`])
  }

  if (hasRemote(repoPath)) {
    try {
      git(repoPath, ['push'])
    } catch (err) {
      logger.warn({ err, repoPath }, 'GNAP push to remote failed (continuing)')
    }
  }
}

export function removeTaskFromGnap(taskId: number, repoPath: string): void {
  const filePath = path.join(repoPath, 'tasks', `mc-${taskId}.json`)

  if (!fs.existsSync(filePath)) return

  git(repoPath, ['rm', path.relative(repoPath, filePath)])

  if (hasChanges(repoPath)) {
    git(repoPath, ['commit', '-m', `Remove task mc-${taskId}`])
  }

  if (hasRemote(repoPath)) {
    try {
      git(repoPath, ['push'])
    } catch (err) {
      logger.warn({ err, repoPath }, 'GNAP push to remote failed (continuing)')
    }
  }
}

export function pullTasksFromGnap(repoPath: string): GnapTask[] {
  const tasksDir = path.join(repoPath, 'tasks')
  if (!fs.existsSync(tasksDir)) return []

  // Pull remote changes first if available
  if (hasRemote(repoPath)) {
    try {
      git(repoPath, ['pull', '--rebase'])
    } catch (err) {
      logger.warn({ err, repoPath }, 'GNAP pull from remote failed (using local)')
    }
  }

  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'))
  const tasks: GnapTask[] = []

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(tasksDir, file), 'utf-8')
      tasks.push(JSON.parse(content))
    } catch (err) {
      logger.warn({ err, file }, 'Failed to parse GNAP task file')
    }
  }

  return tasks
}

export interface SyncResult {
  pushed: number
  pulled: number
  errors: string[]
  lastSync: string
}

export function syncGnap(repoPath: string): SyncResult {
  const result: SyncResult = {
    pushed: 0,
    pulled: 0,
    errors: [],
    lastSync: new Date().toISOString(),
  }

  // Pull remote if available
  if (hasRemote(repoPath)) {
    try {
      git(repoPath, ['pull', '--rebase'])
    } catch (err: any) {
      result.errors.push(`Pull failed: ${err.message}`)
    }
  }

  // Count local tasks
  const tasksDir = path.join(repoPath, 'tasks')
  if (fs.existsSync(tasksDir)) {
    result.pushed = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json')).length
  }

  // Push if remote available
  if (hasRemote(repoPath) && hasChanges(repoPath)) {
    try {
      git(repoPath, ['add', '.'])
      git(repoPath, ['commit', '-m', `Sync from Mission Control at ${result.lastSync}`])
      git(repoPath, ['push'])
    } catch (err: any) {
      result.errors.push(`Push failed: ${err.message}`)
    }
  }

  return result
}

export function getGnapStatus(repoPath: string): {
  initialized: boolean
  taskCount: number
  hasRemote: boolean
  remoteUrl: string
} {
  const tasksDir = path.join(repoPath, 'tasks')
  const initialized = fs.existsSync(path.join(repoPath, 'version'))
  const taskCount = initialized && fs.existsSync(tasksDir)
    ? fs.readdirSync(tasksDir).filter(f => f.endsWith('.json')).length
    : 0

  let remote = false
  let remoteUrl = ''
  if (initialized) {
    try {
      remote = hasRemote(repoPath)
      if (remote) {
        remoteUrl = git(repoPath, ['remote', 'get-url', 'origin'])
      }
    } catch { /* no remote */ }
  }

  return { initialized, taskCount, hasRemote: remote, remoteUrl }
}
