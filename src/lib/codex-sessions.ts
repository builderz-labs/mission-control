import { closeSync, openSync, readSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000
const DEFAULT_FILE_SCAN_LIMIT = 120
const FUTURE_TOLERANCE_MS = 60 * 1000

export interface CodexSessionStats {
  sessionId: string
  projectSlug: string
  projectPath: string | null
  model: string | null
  userMessages: number
  assistantMessages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  lastUserPrompt: string | null
  isActive: boolean
}

interface ParsedFile {
  path: string
  mtimeMs: number
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

function deriveSessionId(filePath: string): string {
  const name = basename(filePath, '.jsonl')
  const match = name.match(/([0-9a-f]{8,}-[0-9a-f-]{8,})$/i)
  return match?.[1] || name
}

function listRecentCodexSessionFiles(limit: number): ParsedFile[] {
  const root = join(config.homeDir, '.codex', 'sessions')
  const files: ParsedFile[] = []
  const stack = [root]

  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue

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

      if (!stat.isFile() || !fullPath.endsWith('.jsonl')) continue
      files.push({ path: fullPath, mtimeMs: stat.mtimeMs })
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files.slice(0, Math.max(1, limit))
}

function clampTimestamp(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const now = Date.now()
  // Guard against timezone/clock skew in session logs.
  if (ms > now + FUTURE_TOLERANCE_MS) return now
  return ms
}

function readHead(filePath: string, maxBytes = 48_000): string {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    const n = readSync(fd, buf, 0, maxBytes, 0)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function parseCodexSessionFile(filePath: string, fileMtimeMs: number): CodexSessionStats | null {
  let content: string
  try {
    content = readHead(filePath)
  } catch {
    return null
  }

  const lines = content.split('\n').filter(Boolean)
  if (lines.length === 0) return null

  let sessionId = deriveSessionId(filePath)
  let projectPath: string | null = null
  let model: string | null = null
  let userMessages = 0
  let assistantMessages = 0
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let firstMessageAt: string | null = null
  let lastMessageAt: string | null = null
  let lastUserPrompt: string | null = null

  for (const line of lines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const entry = asObject(parsed)
    if (!entry) continue

    const timestamp = asString(entry.timestamp)
    if (timestamp) {
      if (!firstMessageAt) firstMessageAt = timestamp
      lastMessageAt = timestamp
    }

    const entryType = asString(entry.type)
    const payload = asObject(entry.payload)

    if (entryType === 'session_meta' && payload) {
      const metaId = asString(payload.id)
      if (metaId) sessionId = metaId

      const cwd = asString(payload.cwd)
      if (cwd) projectPath = cwd

      const metaModel = asString(payload.model)
      if (metaModel) model = metaModel

      const startedAt = asString(payload.timestamp)
      if (startedAt && !firstMessageAt) firstMessageAt = startedAt
      continue
    }

    if (entryType === 'turn_context' && payload) {
      const cwd = asString(payload.cwd)
      if (cwd) projectPath = cwd
    }

    if (entryType === 'response_item' && payload) {
      const payloadType = asString(payload.type)
      const role = asString(payload.role)
      if (payloadType === 'message' && role === 'user') {
        userMessages++
        const text = extractCodexUserText(payload)
        if (text && !lastUserPrompt) lastUserPrompt = text.slice(0, 200)
      }
      if (payloadType === 'message' && role === 'assistant') assistantMessages++
      continue
    }

    if (entryType === 'event_msg' && payload) {
      const msgType = asString(payload.type)
      if (msgType !== 'token_count') continue

      const info = asObject(payload.info)
      const totals = info ? asObject(info.total_token_usage) : null
      if (totals) {
        const inTokens = asNumber(totals.input_tokens) || 0
        const cached = asNumber(totals.cached_input_tokens) || 0
        const outTokens = asNumber(totals.output_tokens) || 0
        const allTokens = asNumber(totals.total_tokens) || (inTokens + cached + outTokens)
        inputTokens = Math.max(inputTokens, inTokens + cached)
        outputTokens = Math.max(outputTokens, outTokens)
        totalTokens = Math.max(totalTokens, allTokens)
      }

      const limits = asObject(payload.rate_limits)
      const limitName = limits ? asString(limits.limit_name) : null
      if (!model && limitName) model = limitName
    }
  }

  if (!lastMessageAt && !firstMessageAt) return null

  const projectSlug = projectPath
    ? basename(projectPath)
    : 'codex-local'
  const parsedFirstMs = firstMessageAt ? clampTimestamp(new Date(firstMessageAt).getTime()) : 0
  const parsedLastMs = lastMessageAt ? clampTimestamp(new Date(lastMessageAt).getTime()) : 0
  const mtimeMs = clampTimestamp(fileMtimeMs)
  const effectiveLastMs = Math.max(parsedLastMs, mtimeMs)
  const effectiveFirstMs = parsedFirstMs || mtimeMs
  const isActive = effectiveLastMs > 0 && (Date.now() - effectiveLastMs) < ACTIVE_THRESHOLD_MS

  return {
    sessionId,
    projectSlug,
    projectPath,
    model,
    userMessages,
    assistantMessages,
    inputTokens,
    outputTokens,
    totalTokens,
    firstMessageAt: effectiveFirstMs ? new Date(effectiveFirstMs).toISOString() : null,
    lastMessageAt: effectiveLastMs ? new Date(effectiveLastMs).toISOString() : null,
    lastUserPrompt,
    isActive,
  }
}

function extractCodexUserText(payload: Record<string, unknown>): string | null {
  const direct = asString(payload.content)
  if (direct) return direct
  const content = payload.content
  if (!Array.isArray(content)) return null
  const parts = content.flatMap((item) => {
    const rec = asObject(item)
    return rec ? [asString(rec.text) || asString(rec.input_text)] : []
  })
  const text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return text || null
}

export function scanCodexSessions(limit = DEFAULT_FILE_SCAN_LIMIT): CodexSessionStats[] {
  try {
    const files = listRecentCodexSessionFiles(limit)
    const sessions: CodexSessionStats[] = []

    for (const file of files) {
      const parsed = parseCodexSessionFile(file.path, file.mtimeMs)
      if (parsed) sessions.push(parsed)
    }

    sessions.sort((a, b) => {
      const aTs = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bTs = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bTs - aTs
    })

    return sessions
  } catch (err) {
    logger.warn({ err }, 'Failed to scan Codex sessions')
    return []
  }
}
