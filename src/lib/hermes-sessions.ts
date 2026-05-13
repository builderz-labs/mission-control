/**
 * Hermes Agent Session Scanner — reads ~/.hermes/state.db (SQLite)
 * to discover hermes-agent sessions and map them to MC's unified session format.
 *
 * Opens the database read-only to avoid locking conflicts with a running agent.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes — hermes sessions are shorter-lived
const DEFAULT_SESSION_LIMIT = 100

export interface HermesSessionStats {
  sessionId: string
  source: string           // 'cli', 'telegram', 'discord', etc.
  model: string | null
  title: string | null
  messageCount: number
  toolCallCount: number
  inputTokens: number
  outputTokens: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  isActive: boolean
}

interface HermesSessionRow {
  id: string
  source: string | null
  user_id: string | null
  model: string | null
  started_at: number | null
  ended_at: number | null
  message_count: number | null
  tool_call_count: number | null
  input_tokens: number | null
  output_tokens: number | null
  title: string | null
}

function getHermesRootPath(): string {
  return join(config.homeDir, '.hermes')
}

function getHermesActiveProfile(): string | null {
  const activeProfilePath = join(getHermesRootPath(), 'active_profile')
  if (!existsSync(activeProfilePath)) return null

  try {
    const profile = readFileSync(activeProfilePath, 'utf8').trim()
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile) ? profile : null
  } catch {
    return null
  }
}

function getHermesHomeCandidates(): string[] {
  const root = getHermesRootPath()
  const seen = new Set<string>()
  const homes: string[] = []

  const addHome = (home: string | null | undefined) => {
    if (!home || seen.has(home)) return
    seen.add(home)
    homes.push(home)
  }

  const activeProfile = getHermesActiveProfile()
  if (activeProfile) {
    addHome(join(root, 'profiles', activeProfile))
  }

  addHome(root)

  const profilesDir = join(root, 'profiles')
  if (existsSync(profilesDir)) {
    try {
      for (const entry of readdirSync(profilesDir)) {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry)) continue
        const profileHome = join(profilesDir, entry)
        try {
          if (statSync(profileHome).isDirectory()) {
            addHome(profileHome)
          }
        } catch {
          // Ignore broken entries
        }
      }
    } catch {
      // Ignore unreadable profiles directory
    }
  }

  return homes
}

function getHermesDbPaths(): string[] {
  return getHermesHomeCandidates().map((home) => join(home, 'state.db'))
}

function getHermesPidPaths(): string[] {
  return getHermesHomeCandidates().map((home) => join(home, 'gateway.pid'))
}

function getHermesGatewayStatePaths(): string[] {
  return getHermesHomeCandidates().map((home) => join(home, 'gateway_state.json'))
}

let hermesBinaryCache: { checkedAt: number; installed: boolean } | null = null

function hasHermesCliBinary(): boolean {
  const now = Date.now()
  if (hermesBinaryCache && now - hermesBinaryCache.checkedAt < 30_000) {
    return hermesBinaryCache.installed
  }

  // Check common install locations including the data directory's local bin.
  // In Docker, HOME=/nonexistent so we also check dataDir as effective HOME.
  const dataDir = require('node:path').resolve(config.dataDir || '.data')
  const homeDir = config.homeDir || process.env.HOME || ''
  const candidates = [
    process.env.HERMES_BIN,
    join(dataDir, '.local', 'bin', 'hermes'),
    join(dataDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
    join(homeDir, '.local', 'bin', 'hermes'),
    join(homeDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
    'hermes-agent',
    'hermes',
  ].filter((v): v is string => Boolean(v && v.trim()))
  const installed = candidates.some((bin) => {
    try {
      // First check if the file exists (fast path for absolute paths)
      if (bin.startsWith('/') && !existsSync(bin)) {
        logger.debug({ bin }, 'hermes candidate not found on disk')
        return false
      }
      // hermes CLI doesn't support --version (exits 2). Use --help as probe.
      const res = spawnSync(bin, ['--help'], { stdio: 'pipe', timeout: 5000 })
      const found = res.status === 0
      if (found) {
        logger.info({ bin, stdout: (res.stdout || '').toString().trim().slice(0, 60) }, 'hermes binary detected')
      }
      return found
    } catch (err) {
      logger.debug({ bin, err }, 'hermes candidate check failed')
      return false
    }
  })

  hermesBinaryCache = { checkedAt: now, installed }
  return installed
}

export function clearHermesDetectionCache(): void {
  hermesBinaryCache = null
}

export function isHermesInstalled(): boolean {
  // Strict detection: show Hermes UI only when Hermes CLI is actually installed on this system.
  return hasHermesCliBinary()
}

function parseGatewayPid(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null

  // Legacy/simple format: file contains only PID text
  if (/^\d+$/.test(text)) {
    const pid = Number.parseInt(text, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  }

  // Current Hermes format: JSON object with pid field
  try {
    const parsed = JSON.parse(text) as { pid?: number | string } | null
    const value = parsed?.pid
    const pid = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function isHermesGatewayRunning(): boolean {
  for (const pidPath of getHermesPidPaths()) {
    if (!existsSync(pidPath)) continue

    try {
      const pidStr = readFileSync(pidPath, 'utf8')
      const pid = parseGatewayPid(pidStr)
      if (!pid) continue
      // Check if process exists (signal 0 doesn't kill, just checks)
      process.kill(pid, 0)
      return true
    } catch {
      // Try the next candidate path
    }
  }

  // In containerized Mission Control deployments, Hermes may run on the host and
  // write profile-aware runtime files into a mounted home directory. In that case
  // process.kill(pid, 0) can fail because the host PID is outside the container's
  // PID namespace. Fall back to Hermes' own gateway_state.json signal.
  for (const statePath of getHermesGatewayStatePaths()) {
    if (!existsSync(statePath)) continue

    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
        gateway_state?: string
      } | null
      if (parsed?.gateway_state === 'running') {
        return true
      }
    } catch {
      // Try the next candidate path
    }
  }

  return false
}

function epochSecondsToISO(epoch: number | null): string | null {
  if (!epoch || !Number.isFinite(epoch) || epoch <= 0) return null
  // Hermes stores timestamps as epoch seconds
  return new Date(epoch * 1000).toISOString()
}

export function scanHermesSessions(limit = DEFAULT_SESSION_LIMIT): HermesSessionStats[] {
  const dbPath = getHermesDbPaths().find((candidate) => existsSync(candidate))
  if (!dbPath) return []

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })

    // Verify the sessions table exists
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).get() as { name?: string } | undefined
    if (!tableCheck?.name) return []

    const rows = db.prepare(`
      SELECT id, source, user_id, model, started_at, ended_at,
             message_count, tool_call_count, input_tokens, output_tokens, title
      FROM sessions
      ORDER BY COALESCE(ended_at, started_at) DESC
      LIMIT ?
    `).all(limit) as HermesSessionRow[]

    const now = Date.now()
    const gatewayRunning = isHermesGatewayRunning()

    return rows.map((row) => {
      const firstMessageAt = epochSecondsToISO(row.started_at)
      let lastMessageAt = epochSecondsToISO(row.ended_at)

      // If session has no end time, try to get latest message timestamp
      if (!lastMessageAt && row.started_at) {
        try {
          const latestMsg = db!.prepare(
            'SELECT MAX(timestamp) as ts FROM messages WHERE session_id = ?'
          ).get(row.id) as { ts: number | null } | undefined
          if (latestMsg?.ts) {
            lastMessageAt = epochSecondsToISO(latestMsg.ts)
          }
        } catch {
          // messages table may not exist or have different schema
        }
      }

      if (!lastMessageAt) lastMessageAt = firstMessageAt

      const lastMs = lastMessageAt ? new Date(lastMessageAt).getTime() : 0
      const isActive = row.ended_at === null
        && lastMs > 0
        && (now - lastMs) < ACTIVE_THRESHOLD_MS
        && gatewayRunning

      return {
        sessionId: row.id,
        source: row.source || 'cli',
        model: row.model || null,
        title: row.title || null,
        messageCount: row.message_count || 0,
        toolCallCount: row.tool_call_count || 0,
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0,
        firstMessageAt,
        lastMessageAt,
        isActive,
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to scan Hermes sessions')
    return []
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}
