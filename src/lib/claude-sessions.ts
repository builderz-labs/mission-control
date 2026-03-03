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

import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { config } from './config'
import { getDatabase } from './db'
import { logger } from './logger'

// Rough per-token pricing (USD) for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
}

const DEFAULT_PRICING = { input: 3 / 1_000_000, output: 15 / 1_000_000 }

// Session is "active" if last message was within this window
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000

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
function parseSessionFile(filePath: string, projectSlug: string): SessionStats | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)

    if (lines.length === 0) return null

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

    for (const line of lines) {
      let entry: JSONLEntry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      // Extract session ID from first entry that has one
      if (!sessionId && entry.sessionId) {
        sessionId = entry.sessionId
      }

      // Extract git branch
      if (!gitBranch && entry.gitBranch) {
        gitBranch = entry.gitBranch
      }

      // Extract project working directory
      if (!projectPath && entry.cwd) {
        projectPath = entry.cwd
      }

      // Track timestamps
      if (entry.timestamp) {
        if (!firstMessageAt) firstMessageAt = entry.timestamp
        lastMessageAt = entry.timestamp
      }

      // Skip sidechain messages (subagent work) for counts
      if (entry.isSidechain) continue

      if (entry.type === 'user' && entry.message) {
        userMessages++
        // Extract last user prompt text
        const msg = entry.message
        if (typeof msg.content === 'string' && msg.content.length > 0) {
          lastUserPrompt = msg.content.slice(0, 500)
        }
      }

      if (entry.type === 'assistant' && entry.message) {
        assistantMessages++

        // Extract model
        if (entry.message.model) {
          model = entry.message.model
        }

        // Extract token usage
        const usage = entry.message.usage
        if (usage) {
          inputTokens += (usage.input_tokens || 0)
          cacheReadTokens += (usage.cache_read_input_tokens || 0)
          cacheCreationTokens += (usage.cache_creation_input_tokens || 0)
          outputTokens += (usage.output_tokens || 0)
        }

        // Count tool uses in assistant content
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_use') toolUses++
          }
        }
      }
    }

    if (!sessionId) return null

    // Estimate cost (cache reads = 10% of input, cache creation = 125% of input)
    const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING
    const estimatedCost =
      inputTokens * pricing.input +
      cacheReadTokens * pricing.input * 0.1 +
      cacheCreationTokens * pricing.input * 1.25 +
      outputTokens * pricing.output

    // Determine if active
    const isActive = lastMessageAt
      ? (Date.now() - new Date(lastMessageAt).getTime()) < ACTIVE_THRESHOLD_MS
      : false

    // Store total input tokens (including cache) for display
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
      firstMessageAt,
      lastMessageAt,
      lastUserPrompt,
      isActive,
    }
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to parse Claude session file')
    return null
  }
}

/** Scan all Claude Code projects and discover sessions */
export function scanClaudeSessions(): SessionStats[] {
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

    // Find JSONL files in this project
    let files: string[]
    try {
      files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    for (const file of files) {
      const filePath = join(projectDir, file)
      const parsed = parseSessionFile(filePath, projectSlug)
      if (parsed) sessions.push(parsed)
    }
  }

  return sessions
}

/** Scan and upsert sessions into the database */
export async function syncClaudeSessions(): Promise<{ ok: boolean; message: string }> {
  try {
    const sessions = scanClaudeSessions()
    if (sessions.length === 0) {
      return { ok: true, message: 'No Claude sessions found' }
    }

    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)

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
          s.isActive ? 1 : 0, now, now,
        )
        upserted++
      }
    })()

    const active = sessions.filter(s => s.isActive).length
    return {
      ok: true,
      message: `Scanned ${upserted} session(s), ${active} active`,
    }
  } catch (err: any) {
    logger.error({ err }, 'Claude session sync failed')
    return { ok: false, message: `Scan failed: ${err.message}` }
  }
}
