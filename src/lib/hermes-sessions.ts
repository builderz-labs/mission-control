/**
 * Hermes Agent Session Scanner — reads ~/.hermes/state.db (SQLite)
 * to discover hermes-agent sessions and map them to MC's unified session format.
 *
 * Opens the database read-only to avoid locking conflicts with a running agent.
 */

import { existsSync, readFileSync } from 'node:fs'
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

function getHermesDbPath(profile?: string): string {
  if (profile && profile !== 'default') {
    return join(config.homeDir, '.hermes', 'profiles', profile, 'state.db')
  }
  return join(config.homeDir, '.hermes', 'state.db')
}

function getHermesPidPath(): string {
  return join(config.homeDir, '.hermes', 'gateway.pid')
}

let hermesBinaryCache: { checkedAt: number; installed: boolean } | null = null

function hasHermesCliBinary(): boolean {
  const now = Date.now()
  if (hermesBinaryCache && now - hermesBinaryCache.checkedAt < 30_000) {
    return hermesBinaryCache.installed
  }

  const candidates = [
    process.env.HERMES_BIN,
    join(config.homeDir, '.hermes', 'hermes-agent', 'hermes'),
    '/usr/local/bin/hermes',
    'hermes-agent',
    'hermes'
  ].filter((v): v is string => Boolean(v && v.trim()))

  console.log('[Hermes Detection] Checking candidates:', candidates);

  const installed = candidates.some((bin) => {
    try {
      const res = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 2000 })
      const ok = res.status === 0
      if (ok) console.log(`[Hermes Detection] Found valid binary: ${bin}`);
      return ok
    } catch (err) {
      console.log(`[Hermes Detection] Failed to execute ${bin}:`, err);
      return false
    }
  })

  if (!installed) console.log('[Hermes Detection] No valid Hermes binary found in candidates');

  hermesBinaryCache = { checkedAt: now, installed }
  return installed
}

export function clearHermesDetectionCache(): void {
  hermesBinaryCache = null
}

export function isHermesInstalled(): boolean {
  // Fallback check: if the database exists, Hermes must have been installed.
  const dbPath = getHermesDbPath()
  const exists = existsSync(dbPath)
  if (exists) return true

  // Standard binary check
  return hasHermesCliBinary()
}

export function isHermesGatewayRunning(): boolean {
  const pidPath = getHermesPidPath()
  if (!existsSync(pidPath)) return false

  try {
    const pidStr = readFileSync(pidPath, 'utf8').trim()
    const pid = parseInt(pidStr, 10)
    if (!Number.isFinite(pid) || pid <= 0) return false
    // Check if process exists (signal 0 doesn't kill, just checks)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function epochSecondsToISO(epoch: number | null): string | null {
  if (!epoch || !Number.isFinite(epoch) || epoch <= 0) return null
  // Hermes stores timestamps as epoch seconds
  return new Date(epoch * 1000).toISOString()
}

export function listHermesProfiles(): string[] {
  const profilesDir = join(config.homeDir, '.hermes', 'profiles')
  if (!existsSync(profilesDir)) return []

  try {
    const { readdirSync, statSync } = require('node:fs')
    return readdirSync(profilesDir).filter((name: string) => {
      try {
        return statSync(join(profilesDir, name)).isDirectory() && 
               existsSync(join(profilesDir, name, 'state.db'))
      } catch {
        return false
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to list Hermes profiles')
    return []
  }
}

export function scanHermesSessions(limit = DEFAULT_SESSION_LIMIT, profile?: string): HermesSessionStats[] {
  const dbPath = getHermesDbPath(profile)
  if (!existsSync(dbPath)) return []

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
