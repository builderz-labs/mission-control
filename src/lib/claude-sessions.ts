/**
 * Claude Code Local Session Scanner
 *
 * Discovers and tracks local Claude Code sessions by scanning ~/.claude/projects/.
 * Each project directory contains JSONL session transcripts that record every
 * user message, assistant response, and tool call with timestamps and token usage.
 *
 * This module parses those JSONL files to extract:
 * - Session metadata (model, project, git branch, timestamps)
 * - Message counts (user, assistant, tool uses)
 * - Token usage (input, output, estimated cost)
 * - Activity status (active if last message < 5 minutes ago)
 */

import { createReadStream, readdirSync, statSync } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'
import { config } from './config'
import { getDatabase } from './db'
import { logger } from './logger'

// Skip JSONL files larger than this to avoid excessive I/O
const MAX_SESSION_FILE_BYTES = 50 * 1024 * 1024 // 50 MB

// Rough per-token pricing (USD) for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
}

const DEFAULT_PRICING = { input: 3 / 1_000_000, output: 15 / 1_000_000 }

// Session is "active" if last activity was within this window.
// Local CLI sessions can remain interactive without emitting frequent logs.
const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000
const FUTURE_TOLERANCE_MS = 60 * 1000

interface SessionStats {
  sessionId: string
  projectSlug: string
  projectPath: string | null
  model: string | null
  gitBranch: string | null
  userMessages: number
  assistantMessages: number
  toolUses: number
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  lastUserPrompt: string | null
  isActive: boolean
}

interface JSONLEntry {
  type?: string
  sessionId?: string
  timestamp?: string
  isSidechain?: boolean
  gitBranch?: string
  cwd?: string
  message?: {
    role?: string
    content?: string | Array<{ type: string; text?: string; id?: string }>
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

/** Parse a single JSONL file and extract session stats */
function clampTimestamp(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const now = Date.now()
  if (ms > now + FUTURE_TOLERANCE_MS) return now
  return ms
}

async function parseSessionFile(filePath: string, projectSlug: string, fileMtimeMs: number, fileSizeBytes: number): Promise<SessionStats | null> {
  try {
    if (fileSizeBytes > MAX_SESSION_FILE_BYTES) {
      logger.warn({ filePath, fileSizeBytes }, 'Skipping oversized Claude session file')
      return null
    }

    let sessionId: string | null = null
    let model: string | null = null
    let gitBranch: string | null = null
    let projectPath: string | null = null
    let userMessages = 0
    let assistantMessages = 0
    let toolUses = 0
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0
    let firstMessageAt: string | null = null
    let lastMessageAt: string | null = null
    let lastUserPrompt: string | null = null
    let hasLines = false

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    })

    try {
      for await (const line of rl) {
        if (!line) continue
        hasLines = true

        let entry: JSONLEntry
        try {
          entry = JSON.parse(line)
        } catch {
          continue
        }

        if (!sessionId && entry.sessionId) {
          sessionId = entry.sessionId
        }

        if (!gitBranch && entry.gitBranch) {
          gitBranch = entry.gitBranch
        }

        if (!projectPath && entry.cwd) {
          projectPath = entry.cwd
        }

        if (entry.timestamp) {
          if (!firstMessageAt) firstMessageAt = entry.timestamp
          lastMessageAt = entry.timestamp
        }

        if (entry.isSidechain) continue

        if (entry.type === 'user' && entry.message) {
          userMessages++
          const msg = entry.message
          if (typeof msg.content === 'string' && msg.content.length > 0) {
            lastUserPrompt = msg.content.slice(0, 500)
          }
        }

        if (entry.type === 'assistant' && entry.message) {
          assistantMessages++

          if (entry.message.model) {
            model = entry.message.model
          }

          const usage = entry.message.usage
          if (usage) {
            inputTokens += (usage.input_tokens || 0)
            cacheReadTokens += (usage.cache_read_input_tokens || 0)
            cacheCreationTokens += (usage.cache_creation_input_tokens || 0)
            outputTokens += (usage.output_tokens || 0)
          }

          if (Array.isArray(entry.message.content)) {
            for (const block of entry.message.content) {
              if (block.type === 'tool_use') toolUses++
            }
          }
        }
      }
    } finally {
      rl.close()
    }

    if (!hasLines || !sessionId || (userMessages === 0 && assistantMessages === 0)) return null

    const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING
    const estimatedCost =
      inputTokens * pricing.input +
      cacheReadTokens * pricing.input * 0.1 +
      cacheCreationTokens * pricing.input * 1.25 +
      outputTokens * pricing.output

    const parsedFirstMs = firstMessageAt ? clampTimestamp(new Date(firstMessageAt).getTime()) : 0
    const parsedLastMs = lastMessageAt ? clampTimestamp(new Date(lastMessageAt).getTime()) : 0
    const mtimeMs = clampTimestamp(fileMtimeMs)
    const effectiveLastMs = Math.max(parsedLastMs, mtimeMs)
    const effectiveFirstMs = parsedFirstMs || mtimeMs
    const isActive = effectiveLastMs > 0 && (Date.now() - effectiveLastMs) < ACTIVE_THRESHOLD_MS

    const totalInputTokens = inputTokens + cacheReadTokens + cacheCreationTokens

    return {
      sessionId,
      projectSlug,
      projectPath,
      model,
      gitBranch,
      userMessages,
      assistantMessages,
      toolUses,
      inputTokens: totalInputTokens,
      outputTokens,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      firstMessageAt: effectiveFirstMs ? new Date(effectiveFirstMs).toISOString() : null,
      lastMessageAt: effectiveLastMs ? new Date(effectiveLastMs).toISOString() : null,
      lastUserPrompt,
      isActive,
    }
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to parse Claude session file')
    return null
  }
}

/** Scan all Claude Code projects and discover sessions */
export async function scanClaudeSessions(): Promise<SessionStats[]> {
  const claudeHome = config.claudeHome
  if (!claudeHome) return []

  const projectsDir = join(claudeHome, 'projects')
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(projectsDir)
  } catch {
    return [] // No projects directory — Claude Code not installed or never used
  }

  const sessions: SessionStats[] = []

  for (const projectSlug of projectDirs) {
    const projectDir = join(projectsDir, projectSlug)

    let stat
    try {
      stat = statSync(projectDir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue

    let files: string[]
    try {
      files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    for (const file of files) {
      const filePath = join(projectDir, file)
      let fileStat
      try {
        fileStat = statSync(filePath)
      } catch {
        continue // file disappeared between readdir and stat
      }
      const parsed = await parseSessionFile(filePath, projectSlug, fileStat.mtimeMs, fileStat.size)
      if (parsed) sessions.push(parsed)
    }
  }

  return sessions
}

// Throttle full disk scans — at most once per 30 seconds
let lastSyncAt = 0
let lastSyncResult: { ok: boolean; message: string } = { ok: true, message: 'Not yet scanned' }
const SYNC_THROTTLE_MS = 30_000

/** Scan and upsert sessions into the database (throttled to avoid repeated disk scans) */
export async function syncClaudeSessions(force = false): Promise<{ ok: boolean; message: string }> {
  const nowMs = Date.now()
  if (!force && lastSyncAt > 0 && (nowMs - lastSyncAt) < SYNC_THROTTLE_MS) {
    return lastSyncResult
  }
  try {
    const sessions = await scanClaudeSessions()
    if (sessions.length === 0) {
      lastSyncAt = Date.now()
      lastSyncResult = { ok: true, message: 'No Claude sessions found' }
      return lastSyncResult
    }

    const db = getDatabase()
    const nowSec = Math.floor(Date.now() / 1000)

    const upsert = db.prepare(`
      INSERT INTO claude_sessions (
        session_id, project_slug, project_path, model, git_branch,
        user_messages, assistant_messages, tool_uses,
        input_tokens, output_tokens, estimated_cost,
        first_message_at, last_message_at, last_user_prompt,
        is_active, scanned_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        model = excluded.model,
        git_branch = excluded.git_branch,
        user_messages = excluded.user_messages,
        assistant_messages = excluded.assistant_messages,
        tool_uses = excluded.tool_uses,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        estimated_cost = excluded.estimated_cost,
        last_message_at = excluded.last_message_at,
        last_user_prompt = excluded.last_user_prompt,
        is_active = excluded.is_active,
        scanned_at = excluded.scanned_at,
        updated_at = excluded.updated_at
    `)

    let upserted = 0
    db.transaction(() => {
      // Mark all sessions inactive before scanning
      db.prepare('UPDATE claude_sessions SET is_active = 0').run()

      for (const s of sessions) {
        upsert.run(
          s.sessionId, s.projectSlug, s.projectPath, s.model, s.gitBranch,
          s.userMessages, s.assistantMessages, s.toolUses,
          s.inputTokens, s.outputTokens, s.estimatedCost,
          s.firstMessageAt, s.lastMessageAt, s.lastUserPrompt,
          s.isActive ? 1 : 0, nowSec, nowSec,
        )
        upserted++
      }
    })()

    const active = sessions.filter(s => s.isActive).length
    lastSyncAt = Date.now()
    lastSyncResult = { ok: true, message: `Scanned ${upserted} session(s), ${active} active` }
    return lastSyncResult
  } catch (err: any) {
    logger.error({ err }, 'Claude session sync failed')
    lastSyncAt = Date.now()
    lastSyncResult = { ok: false, message: `Scan failed: ${err.message}` }
    return lastSyncResult
  }
}
