import type { Conversation } from '@/store'
import { ENGINE_LABELS, inferTreeKind, isTreeKind, sessionTitle } from './chat-session-identity'

export type SessionKind = 'claude-code' | 'codex-cli' | 'hermes' | 'opencode' | 'grok' | 'kimi' | 'gateway'

export type SessionRecord = {
  id: string
  key?: string
  agent?: string
  kind?: string
  model?: string
  tokens?: string
  age?: string
  active?: boolean
  startTime?: number
  lastActivity?: number
  workingDir?: string | null
  lastUserPrompt?: string | null
  title?: string | null
}

export type SessionPrefs = Record<string, { name?: string; color?: string }>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function readSessionPrefs(payload: unknown): SessionPrefs {
  const record = asRecord(payload)
  const prefsRecord = asRecord(record?.prefs)
  if (!prefsRecord) return {}
  return Object.fromEntries(
    Object.entries(prefsRecord).map(([key, value]) => {
      const pref = asRecord(value)
      return [key, { name: readString(pref?.name), color: readString(pref?.color) }]
    }),
  )
}

export function readSessions(payload: unknown): SessionRecord[] {
  const record = asRecord(payload)
  const sessions = Array.isArray(record?.sessions) ? record.sessions : []
  return sessions.flatMap((value) => {
    const session = asRecord(value)
    const id = readString(session?.id)
    if (!id) return []
    return [{
      id,
      key: readString(session?.key),
      agent: readString(session?.agent),
      kind: readString(session?.kind),
      model: readString(session?.model),
      tokens: readString(session?.tokens),
      age: readString(session?.age),
      active: typeof session?.active === 'boolean' ? session.active : undefined,
      startTime: readNumber(session?.startTime),
      lastActivity: readNumber(session?.lastActivity),
      workingDir: typeof session?.workingDir === 'string' || session?.workingDir === null
        ? session.workingDir
        : undefined,
      lastUserPrompt: typeof session?.lastUserPrompt === 'string' || session?.lastUserPrompt === null
        ? session.lastUserPrompt
        : undefined,
      title: typeof session?.title === 'string' || session?.title === null ? session.title : undefined,
    }]
  })
}

function asKind(kind: string | undefined, model?: string): SessionKind {
  const inferred = inferTreeKind(kind, model)
  if (inferred) return inferred
  if (kind === 'hermes' || kind === 'opencode' || kind === 'claude-code' || kind === 'codex-cli' || kind === 'grok' || kind === 'kimi') {
    return kind
  }
  return 'gateway'
}

function kindLabel(kind: SessionKind): string {
  if (isTreeKind(kind)) return ENGINE_LABELS[kind]
  if (kind === 'hermes') return 'Hermes'
  if (kind === 'opencode') return 'OpenCode'
  return 'Gateway'
}

export function mapProviderSessions(
  sessions: SessionRecord[],
  prefs: SessionPrefs,
): Conversation[] {
  return sessions
    .map((s, idx) => {
      const lastActivityMs = Number(s.lastActivity || s.startTime || 0)
      const updatedAt = lastActivityMs > 1_000_000_000_000
        ? Math.floor(lastActivityMs / 1000)
        : lastActivityMs
      const sessionKind = asKind(s.kind, s.model)
      const prefKey = `${sessionKind}:${s.id}`
      const pref = prefs[prefKey] || {}
      const defaultName = sessionTitle({
        customTitle: s.title,
        lastUserPrompt: s.lastUserPrompt,
        prefName: pref.name,
        kind: sessionKind,
        id: s.id,
      })
      return {
        id: `session:${sessionKind}:${s.id}`,
        name: defaultName,
        kind: sessionKind,
        source: 'session' as const,
        session: {
          prefKey,
          sessionId: String(s.id),
          sessionKey: s.key || undefined,
          sessionKind,
          agent: s.agent || undefined,
          displayName: defaultName,
          colorTag: typeof pref.color === 'string' ? pref.color : undefined,
          model: s.model,
          tokens: s.tokens,
          workingDir: s.workingDir || null,
          lastUserPrompt: s.lastUserPrompt || null,
          customTitle: s.title || undefined,
          active: !!s.active,
          age: s.age,
          startTime: s.startTime,
          lastActivity: s.lastActivity,
        },
        participants: [] as string[],
        lastMessage: {
          id: Date.now() + idx,
          conversation_id: `session:${sessionKind}:${s.id}`,
          from_agent: 'system',
          to_agent: null,
          content: `${s.model || kindLabel(sessionKind)} • ${s.tokens || ''}`.trim(),
          message_type: 'system' as const,
          created_at: updatedAt || Math.floor(Date.now() / 1000),
        },
        unreadCount: 0,
        updatedAt,
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
