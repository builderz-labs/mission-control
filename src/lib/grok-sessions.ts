import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 15 * 60 * 1000
const DEFAULT_FILE_SCAN_LIMIT = 100
const FUTURE_TOLERANCE_MS = 60 * 1000

export interface GrokSessionStats {
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampTimestamp(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const now = Date.now()
  if (ms > now + FUTURE_TOLERANCE_MS) return now
  return ms
}

function listSummaryFiles(limit: number): Array<{ path: string; mtimeMs: number }> {
  const root = join(config.homeDir, '.grok', 'sessions')
  const files: Array<{ path: string; mtimeMs: number }> = []
  const stack = [root]
  let visited = 0
  while (stack.length > 0 && visited < 4000) {
    const dir = stack.pop()
    if (!dir) continue
    visited += 1
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (!stat.isFile() || entry !== 'summary.json') continue
      files.push({ path: fullPath, mtimeMs: stat.mtimeMs })
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files.slice(0, Math.max(1, limit))
}

function parseSummary(filePath: string, fileMtimeMs: number): GrokSessionStats | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
  const data = asObject(parsed)
  if (!data) return null
  const info = asObject(data.info) || {}
  const sessionId = asString(info.id) || basename(dirname(filePath))
  const projectPath = asString(info.cwd)
  const model = asString(data.current_model_id)
  const userMessages = asNumber(data.num_chat_messages) || 0
  const totalMessages = asNumber(data.num_messages) || 0
  const created = asString(data.created_at)
  const lastActive = asString(data.last_active_at) || asString(data.updated_at)
  const lastUserPrompt = asString(data.last_turn_summary) || asString(data.session_summary)
  const title = asString(data.session_summary) || lastUserPrompt
  const parsedFirstMs = created ? clampTimestamp(new Date(created).getTime()) : 0
  const parsedLastMs = lastActive ? clampTimestamp(new Date(lastActive).getTime()) : 0
  const mtimeMs = clampTimestamp(fileMtimeMs)
  const effectiveLastMs = Math.max(parsedLastMs, mtimeMs)
  const effectiveFirstMs = parsedFirstMs || mtimeMs
  if (!effectiveLastMs && !effectiveFirstMs) return null
  return {
    sessionId,
    projectSlug: projectPath ? basename(projectPath) : 'grok-local',
    projectPath,
    model,
    userMessages,
    assistantMessages: Math.max(0, totalMessages - userMessages),
    inputTokens: 0,
    outputTokens: 0,
    firstMessageAt: effectiveFirstMs ? new Date(effectiveFirstMs).toISOString() : null,
    lastMessageAt: effectiveLastMs ? new Date(effectiveLastMs).toISOString() : null,
    lastUserPrompt,
    title,
    isActive: effectiveLastMs > 0 && (Date.now() - effectiveLastMs) < ACTIVE_THRESHOLD_MS,
  }
}

export function scanGrokSessions(limit = DEFAULT_FILE_SCAN_LIMIT): GrokSessionStats[] {
  try {
    const sessions = listSummaryFiles(limit)
      .map((file) => parseSummary(file.path, file.mtimeMs))
      .filter((row): row is GrokSessionStats => Boolean(row))
    sessions.sort((a, b) => {
      const aTs = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bTs = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bTs - aTs
    })
    return sessions
  } catch (err) {
    logger.warn({ err }, 'Failed to scan Grok sessions')
    return []
  }
}
