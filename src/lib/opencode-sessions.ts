import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000

export interface OpenCodeSessionStats {
  sessionId: string
  projectId: string | null
  projectSlug: string
  projectPath: string | null
  title: string | null
  provider: string | null
  model: string | null
  version: string | null
  userMessages: number
  assistantMessages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  isActive: boolean
}

interface OpenCodeSessionRow {
  id: string
  project_id: string | null
  directory: string | null
  title: string | null
  provider: string | null
  model: string | null
  version: string | null
  time_created: number | null
  time_updated: number | null
}

interface OpenCodeProjectRow {
  id: string
  worktree: string | null
}

interface OpenCodeMessageRow {
  data: string | null
  time_created: number | null
  time_updated: number | null
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
    return new Set(rows.map((row) => row.name).filter((name): name is string => typeof name === 'string'))
  } catch {
    return new Set()
  }
}

export function getOpenCodeDbCandidates(): string[] {
  const base = join(config.homeDir, '.local', 'share', 'opencode')
  if (process.env.OPENCODE_DB_PATH) {
    return [process.env.OPENCODE_DB_PATH]
  }

  const discovered = existsSync(base)
    ? readdirSync(base)
        .filter((entry) => entry.endsWith('.db'))
        .map((entry) => join(base, entry))
    : []

  return discovered.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs
    } catch {
      return 0
    }
  })
}

function openDatabase(path: string): Database.Database | null {
  try {
    return new Database(path, { readonly: true, fileMustExist: true })
  } catch (err) {
    logger.warn({ err, path }, 'Failed to open OpenCode database')
    return null
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name) as { name?: string } | undefined
    return row?.name === name
  } catch {
    return false
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function epochMsToIso(value: number | null): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null
  return new Date(value).toISOString()
}

export function isOpenCodeInstalled(): boolean {
  const candidates = getOpenCodeBinaryCandidates()

  return candidates.some((bin) => {
    try {
      if (bin.startsWith('/') && !existsSync(bin)) return false
      const result = spawnSync(bin, ['--version'], { stdio: 'pipe', timeout: 5000 })
      return result.status === 0
    } catch {
      return false
    }
  })
}

export function getOpenCodeVersion(): string | null {
  const candidates = getOpenCodeBinaryCandidates()

  for (const bin of candidates) {
    try {
      if (bin.startsWith('/') && !existsSync(bin)) continue
      const result = spawnSync(bin, ['--version'], { stdio: 'pipe', timeout: 5000 })
      if (result.status === 0) {
        const line = (result.stdout?.toString() || '').trim().split('\n')[0]?.trim()
        if (line) return line
      }
    } catch {
      continue
    }
  }

  return null
}

export function getOpenCodeBinaryCandidates(): string[] {
  return [
    process.env.OPENCODE_BIN,
    join('/opt/homebrew/bin', 'opencode'),
    join(config.homeDir, '.local', 'bin', 'opencode'),
    'opencode',
  ].filter((v): v is string => Boolean(v && v.trim()))
}

export function getOpenCodeExecutable(): string {
  const candidates = getOpenCodeBinaryCandidates()
  for (const bin of candidates) {
    if (!bin.startsWith('/') || existsSync(bin)) return bin
  }
  return 'opencode'
}

export function scanOpenCodeSessions(limit = 100): OpenCodeSessionStats[] {
  const sessionMap = new Map<string, OpenCodeSessionStats>()
  const dbPaths = getOpenCodeDbCandidates()
  if (dbPaths.length === 0) return []

  for (const dbPath of dbPaths) {
    if (!existsSync(dbPath)) continue
    const db = openDatabase(dbPath)
    if (!db) continue

    try {
      if (!tableExists(db, 'session') || !tableExists(db, 'project')) continue

      const sessionColumns = tableColumns(db, 'session')
      const whereClauses = ['1=1']
      if (sessionColumns.has('deleted_at')) whereClauses.push('deleted_at IS NULL')
      if (sessionColumns.has('archived_at')) whereClauses.push('archived_at IS NULL')
      if (sessionColumns.has('time_archived')) whereClauses.push('time_archived IS NULL')

      const sessions = db.prepare(
        `SELECT id,
                project_id,
                directory,
                title,
                ${sessionColumns.has('provider') ? 'provider' : 'NULL AS provider'},
                ${sessionColumns.has('model') ? 'model' : 'NULL AS model'},
                ${sessionColumns.has('version') ? 'version' : 'NULL AS version'},
                time_created,
                time_updated
         FROM session
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY COALESCE(time_updated, time_created) DESC
         LIMIT ?`
      ).all(limit) as OpenCodeSessionRow[]

      const projectStmt = db.prepare('SELECT id, worktree FROM project WHERE id = ?')
      const messageStmt = tableExists(db, 'message')
        ? db.prepare('SELECT data, time_created, time_updated FROM message WHERE session_id = ? ORDER BY COALESCE(time_updated, time_created) ASC')
        : null

      for (const session of sessions) {
        const project = session.project_id
          ? (projectStmt.get(session.project_id) as OpenCodeProjectRow | undefined)
          : undefined

        const projectPath = project?.worktree || session.directory || null
        const projectSlug = projectPath ? projectPath.split('/').filter(Boolean).pop() || 'opencode' : 'opencode'

        let userMessages = 0
        let assistantMessages = 0
        let inputTokens = 0
        let outputTokens = 0
        let inferredProvider = session.provider
        let inferredModel = session.model
        let firstMessageAt = epochMsToIso(session.time_created)
        let lastMessageAt = epochMsToIso(session.time_updated)

        if (messageStmt) {
          const messages = messageStmt.all(session.id) as OpenCodeMessageRow[]
          for (const msg of messages) {
            if (!firstMessageAt && msg.time_created) firstMessageAt = epochMsToIso(msg.time_created)
            if (msg.time_updated) lastMessageAt = epochMsToIso(msg.time_updated)

            if (!msg.data) continue
            try {
              const parsed = JSON.parse(msg.data)
              const data = asObject(parsed)
              if (!data) continue
              const role = asString(data.role)
              if (role === 'user') userMessages += 1
              if (role === 'assistant') assistantMessages += 1

              if (!inferredProvider) {
                inferredProvider = asString(data.providerID)
                  || asString(asObject(data.model)?.providerID)
                  || inferredProvider
              }
              if (!inferredModel) {
                inferredModel = asString(data.modelID)
                  || asString(asObject(data.model)?.modelID)
                  || inferredModel
              }

              const tokens = asObject(data.tokens)
              if (tokens) {
                inputTokens += asNumber(tokens.input) || 0
                outputTokens += asNumber(tokens.output) || 0
              }
            } catch {
              continue
            }
          }
        }

        const lastMs = lastMessageAt ? new Date(lastMessageAt).getTime() : 0
        const isActive = lastMs > 0 && (Date.now() - lastMs) < ACTIVE_THRESHOLD_MS

        const candidate: OpenCodeSessionStats = {
          sessionId: session.id,
          projectId: session.project_id,
          projectSlug,
          projectPath,
          title: session.title,
          provider: inferredProvider,
          model: inferredModel,
          version: session.version,
          userMessages,
          assistantMessages,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          firstMessageAt,
          lastMessageAt,
          isActive,
        }

        const existing = sessionMap.get(session.id)
        const existingLast = existing?.lastMessageAt ? new Date(existing.lastMessageAt).getTime() : 0
        if (!existing || lastMs >= existingLast) {
          sessionMap.set(session.id, candidate)
        }
      }
    } catch (err) {
      logger.warn({ err, dbPath }, 'Failed to scan OpenCode sessions')
    } finally {
      try { db.close() } catch {}
    }
  }

  return Array.from(sessionMap.values())
    .sort((a, b) => {
      const aLast = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bLast = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bLast - aLast
    })
    .slice(0, limit)
}
