import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000

const SESSION_ID_RE = /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ZcodeLaunch {
  /** Executable to spawn: the native `zcode` launcher, or a Node binary for a bundle. */
  bin: string
  /** Args that must precede ZCode's own flags (the bundle path when launched through Node). */
  prefixArgs: string[]
  /** Extra environment needed because the bundle is launched outside the desktop shell. */
  env: Record<string, string>
}

export interface ZcodeSessionStats {
  sessionId: string
  workingDir: string | null
  model: string | null
  userMessages: number
  assistantMessages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastMessageAt: string | null
  isActive: boolean
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** ZCode ships its CLI as an Electron-bundled `zcode.cjs`; provider config sits two levels up. */
function bundleEnv(bundlePath: string): Record<string, string> {
  const env: Record<string, string> = {}
  const resourcesDir = path.dirname(path.dirname(bundlePath))
  const builtinProvider = path.join(resourcesDir, 'config', 'provider', 'zcode-builtin.json')
  if (existsSync(builtinProvider)) {
    env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtinProvider
  }
  return env
}

function bundleLaunch(bundlePath: string): ZcodeLaunch | null {
  if (!existsSync(bundlePath)) return null
  return { bin: process.execPath, prefixArgs: [bundlePath], env: bundleEnv(bundlePath) }
}

function installedRoots(): string[] {
  const roots: string[] = []
  if (process.env.ZCODE_HOME) roots.push(process.env.ZCODE_HOME)
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env.ProgramFilesx86 || 'C:\\Program Files (x86)'
    roots.push(
      path.join(local, 'Programs', 'ZCode'),
      path.join(programFiles, 'ZCode'),
      path.join(programFilesX86, 'ZCode'),
    )
  } else if (process.platform === 'darwin') {
    roots.push('/Applications/ZCode.app/Contents/Resources', path.join(os.homedir(), 'Applications', 'ZCode.app', 'Contents', 'Resources'))
  } else {
    roots.push('/opt/ZCode', '/usr/lib/ZCode', '/usr/local/lib/ZCode')
  }
  return roots.filter(Boolean)
}

function fromPathEnv(): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.com', ''] : ['']
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `zcode${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Resolve how to run the ZCode CLI. Explicit override wins so operators can point at a
 * dev build; the bundle branch exists because the desktop installer does not always put a
 * `zcode` launcher on PATH.
 */
export function getZcodeLaunch(): ZcodeLaunch | null {
  const override = (process.env.ZCODE_CLI_BIN || '').trim()
  if (override) {
    if (!existsSync(override)) return null
    if (override.endsWith('.cjs') || override.endsWith('.js')) return bundleLaunch(override)
    return { bin: override, prefixArgs: [], env: {} }
  }

  const onPath = fromPathEnv()
  if (onPath) return { bin: onPath, prefixArgs: [], env: {} }

  for (const root of installedRoots()) {
    const bundle = path.join(root, 'resources', 'glm', 'zcode.cjs')
    const launch = bundleLaunch(bundle)
    if (launch) return launch
  }
  return null
}

let cachedVersion: string | null | undefined

export function clearZcodeDetectionCache(): void {
  cachedVersion = undefined
}

export function isZcodeInstalled(): boolean {
  return getZcodeLaunch() !== null
}

export function getZcodeVersion(): string | null {
  if (cachedVersion !== undefined) return cachedVersion
  const launch = getZcodeLaunch()
  if (!launch) {
    cachedVersion = null
    return null
  }
  try {
    const result = spawnSync(launch.bin, [...launch.prefixArgs, 'version'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, ...launch.env, CI: '1' },
    })
    const output = `${result.stdout || ''}`.trim()
    const match = output.match(/(\d+\.\d+\.\d+[\w.-]*)/)
    cachedVersion = match ? match[1] : (output.split(/\s+/)[1] || null)
  } catch (err) {
    logger.warn({ err }, 'Failed to probe ZCode CLI version')
    cachedVersion = null
  }
  return cachedVersion
}

/**
 * ZCode keeps its sessions in one SQLite database under its CLI state dir: `session`
 * rows are the inventory, `message`/`part` hold the conversation, `turn_usage` and
 * `model_usage` hold tokens and model selection. The `cli/rollout/model-io-*.jsonl`
 * captures only cover raw model traffic for the sessions that had capture enabled, so
 * they are a transcript fallback rather than an inventory.
 */
export function getZcodeDbPath(homeDir: string = config.homeDir): string {
  const override = (process.env.ZCODE_DB_PATH || '').trim()
  if (override) return override
  return path.join(homeDir, '.zcode', 'cli', 'db', 'db.sqlite')
}

export function getZcodeRolloutDir(homeDir: string = config.homeDir): string {
  if (process.env.ZCODE_ROLLOUT_DIR) return process.env.ZCODE_ROLLOUT_DIR
  return path.join(homeDir, '.zcode', 'cli', 'rollout')
}

export function getZcodeRolloutFilePath(sessionId: string, homeDir: string = config.homeDir): string {
  return path.join(getZcodeRolloutDir(homeDir), `model-io-${sessionId}.jsonl`)
}

export function isZcodeSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

interface SessionRow {
  sessionId: string
  workingDir: string | null
  updatedMs: number
}

interface UsageRow {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastActivityMs: number
}

const NO_USAGE: UsageRow = { inputTokens: 0, outputTokens: 0, totalTokens: 0, lastActivityMs: 0 }
const NO_MESSAGES = { userMessages: 0, assistantMessages: 0 }

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name?: string }>
  return new Set(rows.map((row) => row.name).filter((name): name is string => typeof name === 'string'))
}

/**
 * Newest session state wins over `time_updated` alone: a session still streaming has a
 * later request row than its last written row, and a half-written row has no completion.
 */
function readSessions(db: Database.Database, limit: number): SessionRow[] {
  if (!tableExists(db, 'session')) return []
  const columns = columnNames(db, 'session')
  if (!columns.has('id') || !columns.has('time_updated')) return []

  const select = [
    'id AS sessionId',
    'time_updated AS updatedMs',
    columns.has('directory') ? 'directory AS workingDir' : 'NULL AS workingDir',
  ]
  // Sub-agent runs and side chats are children of the session that spawned them and are
  // not resumable entry points, so the inventory stays at the top level.
  const where = ["(parent_id IS NULL OR parent_id = '')"]
  if (columns.has('task_type')) where.push("COALESCE(task_type, '') <> 'subagent_child'")
  if (columns.has('time_archived')) where.push('(time_archived IS NULL OR time_archived = 0)')

  return db.prepare(
    `SELECT ${select.join(', ')} FROM session WHERE ${where.join(' AND ')}
     ORDER BY time_updated DESC LIMIT @limit`,
  ).all({ limit: Math.max(0, limit) }) as SessionRow[]
}

/** Latest model per session, by insert order so a NULL `completed_at` cannot outrank a finished request. */
function readLatestModels(db: Database.Database, ids: string[], table: string): Map<string, string> {
  const models = new Map<string, string>()
  if (!tableExists(db, table)) return models
  const columns = columnNames(db, table)
  const modelColumn = columns.has('model_id') ? 'model_id' : columns.has('resolved_model') ? 'resolved_model' : null
  if (!columns.has('session_id') || !modelColumn) return models

  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT session_id AS sessionId, ${modelColumn} AS model FROM ${table}
     WHERE id IN (SELECT MAX(id) FROM ${table} WHERE session_id IN (${placeholders}) GROUP BY session_id)`,
  ).all(...ids) as Array<{ sessionId?: string; model?: string }>
  for (const row of rows) {
    if (typeof row.sessionId === 'string' && typeof row.model === 'string' && row.model) models.set(row.sessionId, row.model)
  }
  return models
}

function readUsage(db: Database.Database, ids: string[]): Map<string, UsageRow> {
  const usage = new Map<string, UsageRow>()
  if (!tableExists(db, 'turn_usage')) return usage
  const columns = columnNames(db, 'turn_usage')
  const activityParts = [
    columns.has('completed_at') ? 'COALESCE(completed_at, 0)' : null,
    columns.has('started_at') ? 'COALESCE(started_at, 0)' : null,
  ].filter((part): part is string => !!part)
  const lastActivity = activityParts.length > 0 ? `MAX(max(${activityParts.join(', ')}))` : '0'
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT session_id AS sessionId,
            ${columns.has('input_tokens') ? 'SUM(input_tokens)' : '0'} AS inputTokens,
            ${columns.has('output_tokens') ? 'SUM(output_tokens)' : '0'} AS outputTokens,
            ${columns.has('computed_total_tokens') ? 'SUM(computed_total_tokens)' : '0'} AS totalTokens,
            ${lastActivity} AS lastActivityMs
     FROM turn_usage WHERE session_id IN (${placeholders}) GROUP BY session_id`,
  ).all(...ids) as Array<Record<string, unknown>>

  for (const row of rows) {
    if (typeof row.sessionId !== 'string') continue
    const inputTokens = toCount(row.inputTokens)
    const outputTokens = toCount(row.outputTokens)
    usage.set(row.sessionId, {
      inputTokens,
      outputTokens,
      totalTokens: toCount(row.totalTokens) || inputTokens + outputTokens,
      lastActivityMs: toCount(row.lastActivityMs),
    })
  }
  return usage
}

function readMessageCounts(db: Database.Database, ids: string[]): Map<string, { userMessages: number; assistantMessages: number }> {
  const counts = new Map<string, { userMessages: number; assistantMessages: number }>()
  if (!tableExists(db, 'message')) return counts
  const columns = columnNames(db, 'message')
  if (!columns.has('data') || !columns.has('session_id')) return counts
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT session_id AS sessionId,
            SUM(CASE WHEN json_extract(data, '$.role') = 'user' THEN 1 ELSE 0 END) AS userMessages,
            SUM(CASE WHEN json_extract(data, '$.role') = 'assistant' THEN 1 ELSE 0 END) AS assistantMessages
     FROM message WHERE session_id IN (${placeholders}) GROUP BY session_id`,
  ).all(...ids) as Array<Record<string, unknown>>

  for (const row of rows) {
    if (typeof row.sessionId !== 'string') continue
    counts.set(row.sessionId, {
      userMessages: toCount(row.userMessages),
      assistantMessages: toCount(row.assistantMessages),
    })
  }
  return counts
}

export function scanZcodeSessions(limit = 100, homeDir: string = config.homeDir): ZcodeSessionStats[] {
  const dbPath = getZcodeDbPath(homeDir)
  if (!existsSync(dbPath)) return []

  let db: Database.Database | null = null
  try {
    // Read-only: ZCode owns this file and may be writing to it right now.
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    db.pragma('busy_timeout = 2000')

    const sessions = readSessions(db, limit)
    if (sessions.length === 0) return []
    const ids = sessions.map((session) => session.sessionId)
    const usage = readUsage(db, ids)
    const messages = readMessageCounts(db, ids)
    const models = readLatestModels(db, ids, 'model_usage')
    const now = Date.now()

    return sessions.map((session) => {
      const u = usage.get(session.sessionId) ?? NO_USAGE
      const m = messages.get(session.sessionId) ?? NO_MESSAGES
      const lastMs = Math.max(session.updatedMs, u.lastActivityMs)
      return {
        sessionId: session.sessionId,
        workingDir: session.workingDir ?? null,
        model: models.get(session.sessionId) ?? null,
        userMessages: m.userMessages,
        assistantMessages: m.assistantMessages,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.totalTokens,
        lastMessageAt: lastMs > 0 ? new Date(lastMs).toISOString() : null,
        isActive: lastMs > 0 && now - lastMs < ACTIVE_THRESHOLD_MS,
      }
    })
  } catch (err) {
    logger.warn({ err, dbPath }, 'Failed to read ZCode session database')
    return []
  } finally {
    try { db?.close() } catch { /* noop */ }
  }
}

export function isZcodeAuthenticated(homeDir: string = config.homeDir): boolean {
  // Existence only — the file holds OAuth material and is never read here.
  return existsSync(path.join(homeDir, '.zcode', 'v2', 'credentials.json'))
    || existsSync(path.join(homeDir, '.zcode', 'credentials.json'))
}
