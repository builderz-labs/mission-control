import { getDatabase } from '@/lib/db'
import { scanCodexSessions } from '@/lib/codex-sessions'
import { scanGrokSessions } from '@/lib/grok-sessions'
import { scanKimiSessions } from '@/lib/kimi-sessions'
import { logger } from '@/lib/logger'
import {
  attachProject,
  fleetAgentForSession,
  matchesSessionFilters,
  sessionEnvironment,
  type NormalizedSession,
} from '@/lib/session-record'

const LOCAL_SESSION_ACTIVE_WINDOW_MS = 15 * 60 * 1000
const SCAN_LIMIT = 200
const PER_KIND_LIMIT = 120

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function flagsFor(kind: string, slug: string | null, workingDir: string | null): string[] {
  const flags = slug ? [slug] : []
  if (kind === 'claude-code' && workingDir && !workingDir.includes('workspace-claude-')) {
    flags.push('shared-claude-home')
  }
  return flags
}

function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

function fromScanner(row: {
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
  isActive: boolean
  lastUserPrompt?: string | null
}, kind: string): NormalizedSession {
  const lastMsg = row.lastMessageAt ? new Date(row.lastMessageAt).getTime() : 0
  const firstMsg = row.firstMessageAt ? new Date(row.firstMessageAt).getTime() : 0
  const workingDir = row.projectPath
  const project = attachProject(workingDir)
  const prefix = kind === 'codex-cli' ? 'codex' : kind === 'claude-code' ? 'claude' : kind
  const sessionId = row.sessionId.startsWith(`${prefix}:`) ? row.sessionId : `${prefix}:${row.sessionId}`
  const agent = fleetAgentForSession({ kind, sessionId, workingDir })
  return {
    id: sessionId,
    key: project.projectSlug || row.projectSlug || row.sessionId,
    agent,
    kind,
    project: project.project,
    projectSlug: project.projectSlug,
    environment: sessionEnvironment({ source: 'local', workingDir }),
    age: row.isActive ? 'now' : formatAge(lastMsg),
    model: row.model || kind,
    tokens: `${formatTokens(row.inputTokens || 0)}/${formatTokens(row.outputTokens || 0)}`,
    channel: 'local',
    flags: flagsFor(kind, project.projectSlug, workingDir),
    active: row.isActive,
    startTime: firstMsg,
    lastActivity: row.isActive ? Date.now() : lastMsg,
    source: 'local',
    workingDir,
    lastUserPrompt: row.lastUserPrompt ?? null,
    userMessages: row.userMessages,
    assistantMessages: row.assistantMessages,
  }
}

function fromClaudeRow(s: Record<string, unknown>): NormalizedSession {
  const lastMsg = s.last_message_at ? new Date(String(s.last_message_at)).getTime() : 0
  const derivedActive = lastMsg > 0 && Date.now() - lastMsg < LOCAL_SESSION_ACTIVE_WINDOW_MS
  const isActive = s.is_active === 1 || derivedActive
  const workingDir = typeof s.project_path === 'string' ? s.project_path : null
  const sessionId = String(s.session_id || '')
  const kind = sessionId.startsWith('grok:')
    ? 'grok'
    : sessionId.startsWith('kimi:')
      ? 'kimi'
      : sessionId.startsWith('codex:')
        ? 'codex-cli'
        : 'claude-code'
  const project = attachProject(workingDir)
  const agent = fleetAgentForSession({ kind, sessionId, workingDir })
  return {
    id: sessionId,
    key: project.projectSlug || String(s.project_slug || sessionId),
    agent,
    kind,
    project: project.project,
    projectSlug: project.projectSlug,
    environment: sessionEnvironment({ source: 'local', workingDir }),
    age: isActive ? 'now' : formatAge(lastMsg),
    model: String(s.model || 'unknown'),
    tokens: `${formatTokens(Number(s.input_tokens || 0))}/${formatTokens(Number(s.output_tokens || 0))}`,
    channel: 'local',
    flags: flagsFor(kind, project.projectSlug, workingDir),
    active: isActive,
    startTime: s.first_message_at ? new Date(String(s.first_message_at)).getTime() : 0,
    lastActivity: isActive ? Date.now() : lastMsg,
    source: 'local',
    workingDir,
    lastUserPrompt: typeof s.last_user_prompt === 'string' ? s.last_user_prompt : null,
    userMessages: Number(s.user_messages || 0),
    assistantMessages: Number(s.assistant_messages || 0),
    toolUses: Number(s.tool_uses || 0),
    estimatedCost: Number(s.estimated_cost || 0),
  }
}

export function listNormalizedLocalSessions(filters: {
  agent?: string
  project?: string
  active?: string
  environment?: string
} = {}): NormalizedSession[] {
  const rows: NormalizedSession[] = []
  try {
    const db = getDatabase()
    const claudeRows = db.prepare(
      'SELECT * FROM claude_sessions ORDER BY last_message_at DESC LIMIT ?',
    ).all(SCAN_LIMIT) as Array<Record<string, unknown>>
    rows.push(...claudeRows.map(fromClaudeRow))
  } catch (err) {
    logger.warn({ err }, 'Failed to read local Claude sessions')
  }
  try {
    rows.push(...scanCodexSessions(SCAN_LIMIT).map((row) => fromScanner(row, 'codex-cli')))
    rows.push(...scanGrokSessions(SCAN_LIMIT).map((row) => fromScanner(row, 'grok')))
    rows.push(...scanKimiSessions(SCAN_LIMIT).map((row) => fromScanner(row, 'kimi')))
  } catch (err) {
    logger.warn({ err }, 'Failed to scan engine sessions')
  }
  const deduped = new Map<string, NormalizedSession>()
  for (const session of rows) {
    if (!session.id) continue
    const key = `${session.kind}:${session.id}`
    const existing = deduped.get(key)
    if (!existing || session.lastActivity > existing.lastActivity) deduped.set(key, session)
  }
  const ranked = Array.from(deduped.values())
    .filter((session) => matchesSessionFilters(session, filters))
    .sort((a, b) => b.lastActivity - a.lastActivity)
  const perKind = new Map<string, number>()
  const capped: NormalizedSession[] = []
  for (const session of ranked) {
    const used = perKind.get(session.kind) || 0
    if (used >= PER_KIND_LIMIT) continue
    perKind.set(session.kind, used + 1)
    capped.push(session)
  }
  return capped
}
