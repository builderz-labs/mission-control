import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { config } from './config'
import { logger } from './logger'
import { isSafeHomePath, realpathInside } from './safe-home-path'

const ACTIVE_THRESHOLD_MS = 15 * 60 * 1000
const DEFAULT_FILE_SCAN_LIMIT = 100
const FUTURE_TOLERANCE_MS = 60 * 1000
const DEFAULT_MODEL = 'kimi-code/k3'

export interface KimiSessionStats {
  sessionId: string
  projectSlug: string
  projectPath: string | null
  model: string | null
  userMessages: number
  assistantMessages: number
  inputTokens: number
  outputTokens: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  lastUserPrompt: string | null
  title: string | null
  isActive: boolean
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function clampTimestamp(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const now = Date.now()
  if (ms > now + FUTURE_TOLERANCE_MS) return now
  return ms
}

function toMs(value: number | null): number {
  if (!value) return 0
  return value < 1e12 ? value * 1000 : value
}

function timestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return clampTimestamp(toMs(value))
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return clampTimestamp(toMs(numeric))
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? clampTimestamp(parsed) : 0
  }
  return 0
}

export function isKimiClawPath(value: string | null): boolean {
  if (!value) return false
  return value.includes('/.kimi/kimi-claw/') || value.includes('kimi-claw')
}

function parseIndexLine(line: string): { sessionId: string; sessionDir: string; workDir: string | null } | null {
  try {
    const row = asObject(JSON.parse(line))
    if (!row) return null
    const sessionId = asString(row.sessionId)
    const sessionDir = asString(row.sessionDir)
    if (!sessionId || !sessionDir || isKimiClawPath(sessionDir)) return null
    if (!isSafeHomePath(sessionDir, config.homeDir) || !realpathInside(sessionDir, config.homeDir)) return null
    return { sessionId, sessionDir, workDir: asString(row.workDir) }
  } catch {
    return null
  }
}

function parseState(sessionDir: string, fallback: { sessionId: string; workDir: string | null }): KimiSessionStats | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(sessionDir, 'state.json'), 'utf-8'))
  } catch {
    return null
  }
  const data = asObject(parsed)
  if (!data) return null
  const projectPath = asString(data.cwd) || asString(data.workDir) || fallback.workDir
  const createdMs = timestampMs(data.createdAt)
  const updatedMs = timestampMs(data.updatedAt)
  const lastMs = updatedMs || createdMs
  if (!lastMs) return null
  const lastUserPrompt = asString(data.lastPrompt) || asString(data.title)
  const title = asString(data.title) || lastUserPrompt
  return {
    sessionId: asString(data.id) || fallback.sessionId,
    projectSlug: projectPath ? basename(projectPath) : 'kimi-local',
    projectPath,
    model: DEFAULT_MODEL,
    userMessages: lastUserPrompt ? 1 : 0,
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    firstMessageAt: createdMs ? new Date(createdMs).toISOString() : null,
    lastMessageAt: new Date(lastMs).toISOString(),
    lastUserPrompt,
    title,
    isActive: (Date.now() - lastMs) < ACTIVE_THRESHOLD_MS,
  }
}

export function scanKimiSessions(limit = DEFAULT_FILE_SCAN_LIMIT): KimiSessionStats[] {
  try {
    const indexPath = join(config.homeDir, '.kimi-code', 'session_index.jsonl')
    let raw: string
    try {
      raw = readFileSync(indexPath, 'utf-8')
    } catch {
      return []
    }
    const sessions: KimiSessionStats[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const entry = parseIndexLine(line)
      if (!entry) continue
      const parsed = parseState(entry.sessionDir, entry)
      if (parsed) sessions.push(parsed)
    }
    sessions.sort((a, b) => {
      const aTs = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bTs = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bTs - aTs
    })
    return sessions.slice(0, Math.max(1, limit))
  } catch (err) {
    logger.warn({ err }, 'Failed to scan Kimi sessions')
    return []
  }
}
