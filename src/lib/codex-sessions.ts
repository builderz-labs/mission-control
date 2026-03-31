import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000
const DEFAULT_FILE_SCAN_LIMIT = 120
const FUTURE_TOLERANCE_MS = 60 * 1000
const RECENT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
const SESSION_CACHE_TTL_MS = 30_000
const MAX_SCAN_WALL_MS = 1_500
const MAX_FULL_READ_BYTES = 4 * 1024 * 1024
const SAMPLED_HEAD_BYTES = 128 * 1024
const SAMPLED_TAIL_BYTES = 768 * 1024

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
}

interface ParsedFile {
  path: string
  mtimeMs: number
  size: number
}

type CachedScanResult = {
  ts: number
  data: CodexSessionStats[]
}

let codexSessionCache: CachedScanResult | null = null

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

export function clearCodexSessionCache(): void {
  codexSessionCache = null
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

function trimHeadChunk(chunk: string, isWholeFile: boolean): string {
  if (isWholeFile) return chunk
  const lastNewline = chunk.lastIndexOf('\n')
  return lastNewline >= 0 ? chunk.slice(0, lastNewline) : ''
}

function trimTailChunk(chunk: string, startsAtZero: boolean): string {
  if (startsAtZero) return chunk
  const firstNewline = chunk.indexOf('\n')
  return firstNewline >= 0 ? chunk.slice(firstNewline + 1) : ''
}

function readChunk(fd: number, position: number, length: number): string {
  if (length <= 0) return ''
  const buffer = Buffer.alloc(length)
  const bytesRead = readSync(fd, buffer, 0, length, position)
  return buffer.subarray(0, bytesRead).toString('utf-8')
}

function readSampledCodexSessionFile(filePath: string, fileSize: number): string {
  if (fileSize <= MAX_FULL_READ_BYTES) {
    return readFileSync(filePath, 'utf-8')
  }

  const fd = openSync(filePath, 'r')
  try {
    const headBytes = Math.min(fileSize, SAMPLED_HEAD_BYTES)
    const tailBytes = Math.min(Math.max(fileSize - headBytes, 0), SAMPLED_TAIL_BYTES)
    const tailOffset = Math.max(0, fileSize - tailBytes)

    const head = readChunk(fd, 0, headBytes)
    if (tailBytes <= 0 || tailOffset <= headBytes) {
      return head
    }

    const tail = readChunk(fd, tailOffset, tailBytes)
    const headBlock = trimHeadChunk(head, headBytes >= fileSize)
    const tailBlock = trimTailChunk(tail, tailOffset === 0)
    return [headBlock, tailBlock].filter(Boolean).join('\n')
  } finally {
    closeSync(fd)
  }
}

function parseCodexSessionFile(filePath: string, fileMtimeMs: number, fileSize: number): CodexSessionStats | null {
  const now = Date.now()
  if (fileSize > MAX_FULL_READ_BYTES && (now - fileMtimeMs) > RECENT_LOOKBACK_MS) {
    return null
  }

  let content: string
  try {
    content = readSampledCodexSessionFile(filePath, fileSize)
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

    if (entryType === 'response_item' && payload) {
      const payloadType = asString(payload.type)
      const role = asString(payload.role)
      if (payloadType === 'message' && role === 'user') userMessages++
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
    isActive,
  }
}

export function scanCodexSessions(limit = DEFAULT_FILE_SCAN_LIMIT): CodexSessionStats[] {
  try {
    const now = Date.now()
    if (codexSessionCache && (now - codexSessionCache.ts) < SESSION_CACHE_TTL_MS) {
      return codexSessionCache.data
    }

    const files = listRecentCodexSessionFiles(limit)
    const sessions: CodexSessionStats[] = []
    const scanStartedAt = Date.now()

    for (const file of files) {
      if ((Date.now() - scanStartedAt) > MAX_SCAN_WALL_MS) break
      const parsed = parseCodexSessionFile(file.path, file.mtimeMs, file.size)
      if (parsed) sessions.push(parsed)
    }

    sessions.sort((a, b) => {
      const aTs = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bTs = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bTs - aTs
    })

    codexSessionCache = { data: sessions, ts: Date.now() }
    return sessions
  } catch (err) {
    logger.warn({ err }, 'Failed to scan Codex sessions')
    return []
  }
}
