import { CLI_SESSION_SCAN_LIMIT } from './cli-session-kinds'
import { scanGrokSessions } from './grok-sessions'
import { scanKimiSessions } from './kimi-sessions'
import { logger } from './logger'
import { activityFields, formatTokens } from './session-list-format'

function mapEngineRow(kind: 'grok' | 'kimi', row: {
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
  title?: string | null
  isActive: boolean
}) {
  const lastMsg = row.lastMessageAt ? new Date(row.lastMessageAt).getTime() : 0
  const firstMsg = row.firstMessageAt ? new Date(row.firstMessageAt).getTime() : 0
  return {
    id: row.sessionId,
    key: row.projectSlug || row.sessionId,
    agent: kind,
    kind,
    model: row.model || kind,
    tokens: `${formatTokens(row.inputTokens || 0)}/${formatTokens(row.outputTokens || 0)}`,
    channel: 'local',
    flags: [],
    startTime: firstMsg,
    ...activityFields(row.isActive, lastMsg),
    source: 'local' as const,
    userMessages: row.userMessages,
    assistantMessages: row.assistantMessages,
    lastUserPrompt: row.lastUserPrompt,
    title: row.title || row.lastUserPrompt,
    workingDir: row.projectPath,
  }
}

export function getLocalGrokSessions() {
  try {
    return scanGrokSessions(CLI_SESSION_SCAN_LIMIT).map((row) => mapEngineRow('grok', row))
  } catch (err) {
    logger.warn({ err }, 'Failed to read local Grok sessions')
    return []
  }
}

export function getLocalKimiSessions() {
  try {
    return scanKimiSessions(CLI_SESSION_SCAN_LIMIT).map((row) => mapEngineRow('kimi', row))
  } catch (err) {
    logger.warn({ err }, 'Failed to read local Kimi sessions')
    return []
  }
}
