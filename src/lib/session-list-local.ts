import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { scanCodexSessions } from '@/lib/codex-sessions'
import { scanHermesSessions } from '@/lib/hermes-sessions'
import { scanOpenCodeSessions } from '@/lib/opencode-sessions'
import { activityFields, formatTokens } from '@/lib/session-list-format'
import { ttlGet } from '@/lib/session-ttl-cache'
import { CLI_SESSION_SCAN_LIMIT, isForeignPrefixedSessionId } from '@/lib/cli-session-kinds'

const SCAN_TTL_MS = 2500
const LOCAL_SESSION_ACTIVE_WINDOW_MS = 15 * 60 * 1000

export type SessionListItem = {
  id: string
  key: string
  agent: string
  kind: string
  age: string
  model: string
  tokens: string
  channel: string
  flags: string[]
  active: boolean
  startTime: number
  lastActivity: number
  source: 'local' | 'gateway'
  title?: string | null
  lastUserPrompt?: string | null
  workingDir?: string | null
  userMessages?: number
  assistantMessages?: number
  toolUses?: number
  estimatedCost?: number
  totalTokens?: number
}

export function getLocalClaudeSessions(): SessionListItem[] {
  try {
    const rows = getDatabase().prepare(
      `SELECT * FROM claude_sessions
       WHERE session_id NOT LIKE 'grok:%'
         AND session_id NOT LIKE 'kimi:%'
         AND session_id NOT LIKE 'codex:%'
         AND session_id NOT LIKE 'hermes:%'
         AND session_id NOT LIKE 'opencode:%'
       ORDER BY last_message_at DESC LIMIT 2000`,
    ).all() as Array<Record<string, unknown>>
    return rows.flatMap((s) => {
      const sessionId = String(s.session_id || '')
      if (isForeignPrefixedSessionId(sessionId)) return []
      const lastMsg = s.last_message_at ? new Date(String(s.last_message_at)).getTime() : 0
      const derivedActive = lastMsg > 0 && (Date.now() - lastMsg) < LOCAL_SESSION_ACTIVE_WINDOW_MS
      const isActive = s.is_active === 1 || derivedActive
      const title = typeof s.custom_title === 'string' && s.custom_title ? s.custom_title : null
      return [{
        id: sessionId,
        key: String(s.project_slug || s.session_id || ''),
        agent: String(s.project_slug || 'local'),
        kind: 'claude-code',
        model: String(s.model || 'unknown'),
        tokens: `${formatTokens(Number(s.input_tokens || 0))}/${formatTokens(Number(s.output_tokens || 0))}`,
        channel: 'local',
        flags: typeof s.git_branch === 'string' && s.git_branch ? [s.git_branch] : [],
        startTime: s.first_message_at ? new Date(String(s.first_message_at)).getTime() : 0,
        source: 'local',
        userMessages: Number(s.user_messages || 0),
        assistantMessages: Number(s.assistant_messages || 0),
        toolUses: Number(s.tool_uses || 0),
        estimatedCost: Number(s.estimated_cost || 0),
        lastUserPrompt: typeof s.last_user_prompt === 'string' ? s.last_user_prompt : null,
        title,
        workingDir: typeof s.project_path === 'string' ? s.project_path : null,
        ...activityFields(isActive, lastMsg),
      }]
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to read local Claude sessions')
    return []
  }
}

export function getLocalCodexSessions(): SessionListItem[] {
  try {
    return ttlGet('codex-sessions', SCAN_TTL_MS, () => scanCodexSessions(CLI_SESSION_SCAN_LIMIT)).map((s) => {
      const lastMsg = s.lastMessageAt ? new Date(s.lastMessageAt).getTime() : 0
      const firstMsg = s.firstMessageAt ? new Date(s.firstMessageAt).getTime() : 0
      const title = s.lastUserPrompt || null
      return {
        id: s.sessionId,
        key: s.projectSlug || s.sessionId,
        agent: s.projectSlug || 'codex-local',
        kind: 'codex-cli',
        model: s.model || 'codex',
        tokens: `${formatTokens(s.inputTokens || 0)}/${formatTokens(s.outputTokens || 0)}`,
        channel: 'local',
        flags: [],
        startTime: firstMsg,
        source: 'local',
        userMessages: s.userMessages || 0,
        assistantMessages: s.assistantMessages || 0,
        toolUses: 0,
        estimatedCost: 0,
        lastUserPrompt: s.lastUserPrompt || null,
        title,
        totalTokens: s.totalTokens || (s.inputTokens + s.outputTokens),
        workingDir: s.projectPath || null,
        ...activityFields(s.isActive, lastMsg),
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to read local Codex sessions')
    return []
  }
}

export function getLocalHermesSessions(): SessionListItem[] {
  try {
    return ttlGet('hermes-sessions', SCAN_TTL_MS, () => scanHermesSessions(CLI_SESSION_SCAN_LIMIT)).map((s) => {
      const lastMsg = s.lastMessageAt ? new Date(s.lastMessageAt).getTime() : 0
      const firstMsg = s.firstMessageAt ? new Date(s.firstMessageAt).getTime() : 0
      return {
        id: s.sessionId,
        key: s.title || s.sessionId,
        agent: 'hermes',
        kind: 'hermes',
        model: s.model || 'hermes',
        tokens: `${formatTokens(s.inputTokens)}/${formatTokens(s.outputTokens)}`,
        channel: s.source || 'cli',
        flags: s.source && s.source !== 'cli' ? [s.source] : [],
        startTime: firstMsg,
        source: 'local',
        userMessages: s.messageCount,
        assistantMessages: 0,
        toolUses: s.toolCallCount,
        estimatedCost: 0,
        lastUserPrompt: s.title || null,
        totalTokens: s.inputTokens + s.outputTokens,
        workingDir: null,
        ...activityFields(s.isActive, lastMsg),
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to read local Hermes sessions')
    return []
  }
}

export function getLocalOpenCodeSessions(): SessionListItem[] {
  try {
    return ttlGet('opencode-sessions', SCAN_TTL_MS, () => scanOpenCodeSessions(CLI_SESSION_SCAN_LIMIT)).map((s) => {
      const lastMsg = s.lastMessageAt ? new Date(s.lastMessageAt).getTime() : 0
      return {
        id: s.sessionId,
        key: s.projectSlug || s.sessionId,
        agent: s.projectSlug || 'opencode',
        kind: 'opencode',
        model: s.model || s.version || 'opencode',
        tokens: `${formatTokens(s.inputTokens)}/${formatTokens(s.outputTokens)}`,
        channel: 'local',
        flags: s.provider ? [s.provider] : [],
        startTime: s.firstMessageAt ? new Date(s.firstMessageAt).getTime() : 0,
        source: 'local',
        userMessages: s.userMessages,
        assistantMessages: s.assistantMessages,
        toolUses: 0,
        estimatedCost: 0,
        lastUserPrompt: s.title || null,
        title: s.title || null,
        totalTokens: s.totalTokens,
        workingDir: s.projectPath || null,
        ...activityFields(s.isActive && !!s.lastMessageAt, lastMsg),
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to read local OpenCode sessions')
    return []
  }
}


