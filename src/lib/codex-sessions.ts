import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'path'
import { readCodexThreadNames } from './codex-thread-names'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 15 * 60 * 1000
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
  isActive: boolean
  lastUserPrompt: string | null
  title: string | null
  turnState: 'running' | 'idle' | 'unknown'
}

interface ParsedFile {
  path: string
  mtimeMs: number
  size: number
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
      files.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size })
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

function parseCodexSessionFile(filePath: string, fileMtimeMs: number): CodexSessionStats | null {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
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
  let title: string | null = null
  let turnState: CodexSessionStats['turnState'] = 'unknown'

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
      model = asString(payload.model) || model
    }

    if (entryType === 'response_item' && payload) {
      const payloadType = asString(payload.type)
      const role = asString(payload.role)
      if (payloadType === 'message' && role === 'user') {
        userMessages++
        const blocks = Array.isArray(payload.content) ? payload.content : []
        const text = typeof payload.content === 'string' ? payload.content : blocks
          .map((block) => asString(asObject(block)?.text) || '').join('\n')
        if (text.trim()) {
          lastUserPrompt = text.trim().slice(0, 500)
          title ||= text.trim().replace(/\s+/g, ' ').slice(0, 100)
        }
      }
      if (payloadType === 'message' && role === 'assistant') assistantMessages++
      continue
    }

    if (entryType === 'event_msg' && payload) {
      const msgType = asString(payload.type)
      if (msgType === 'task_started') turnState = 'running'
      if (msgType === 'task_complete' || msgType === 'turn_aborted') turnState = 'idle'
      if (msgType === 'user_message') {
        const prompt = asString(payload.message)
        if (prompt) {
          lastUserPrompt = prompt.slice(0, 500)
          title ||= prompt.replace(/\s+/g, ' ').slice(0, 100)
        }
      }
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
  const isActive = turnState !== 'idle' && effectiveLastMs > 0 && (Date.now() - effectiveLastMs) < ACTIVE_THRESHOLD_MS

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
    isActive,
    lastUserPrompt,
    title,
    turnState,
  }
}

// Cache summaries, not transcript contents. Re-evaluate activity on every read.
const parsedFileCache = new Map<string, { mtimeMs: number; size: number; stats: CodexSessionStats | null }>()

export function scanCodexSessions(limit = DEFAULT_FILE_SCAN_LIMIT): CodexSessionStats[] {
  try {
    const files = listRecentCodexSessionFiles(limit)
    const sessions: CodexSessionStats[] = []
    const names = readCodexThreadNames(config.homeDir)
    const livePaths = new Set(files.map((file) => file.path))
    for (const cachedPath of parsedFileCache.keys()) {
      if (!livePaths.has(cachedPath)) parsedFileCache.delete(cachedPath)
    }

    for (const file of files) {
      const cached = parsedFileCache.get(file.path)
      const parsed = cached?.mtimeMs === file.mtimeMs && cached.size === file.size
        ? cached.stats
        : parseCodexSessionFile(file.path, file.mtimeMs)
      parsedFileCache.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, stats: parsed })
      if (parsed) {
        const lastMs = parsed.lastMessageAt ? new Date(parsed.lastMessageAt).getTime() : 0
        sessions.push({ ...parsed, title: names.get(parsed.sessionId) || parsed.title,
          isActive: parsed.turnState !== 'idle' && lastMs > 0 && Date.now() - lastMs < ACTIVE_THRESHOLD_MS })
      }
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
