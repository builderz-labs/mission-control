import type { ChatMessage, Conversation } from '@/store'

export type ChatSessionKind = 'claude-code' | 'codex-cli' | 'hermes' | 'gateway'

export interface ChatSessionRecord {
  id: string
  key?: string
  agent?: string
  kind?: string
  source?: string
  model?: string
  tokens?: string
  age?: string
  active?: boolean
  startTime?: number
  lastActivity?: number
  workingDir?: string | null
  lastUserPrompt?: string | null
}

export type ChatSessionPrefs = Record<string, { name?: string; color?: string }>

export interface PersistedConversationRecord {
  conversation_id: string
  last_message_at?: number
  unread_count?: number
  last_message?: Partial<ChatMessage> | null
}

export interface ConversationBuckets {
  activeGatewayRows: Conversation[]
  inactiveGatewayRows: Conversation[]
  activeLocalRows: Conversation[]
  inactiveLocalRows: Conversation[]
  otherRows: Conversation[]
}

export interface LimitedConversationBuckets extends ConversationBuckets {
  hiddenInactiveGatewayCount: number
  hiddenInactiveLocalCount: number
  hiddenOtherCount: number
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return Math.floor(Date.now() / 1000)
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
}

function normalizeSessionKind(value: unknown): ChatSessionKind {
  if (value === 'claude-code' || value === 'codex-cli' || value === 'hermes') return value
  return 'gateway'
}

function getKindLabel(kind: ChatSessionKind): string {
  if (kind === 'codex-cli') return 'Codex'
  if (kind === 'claude-code') return 'Claude'
  if (kind === 'hermes') return 'Hermes'
  return 'Gateway'
}

function buildFallbackName(conversationId: string, lastMessage?: Partial<ChatMessage> | null): string {
  if (conversationId.startsWith('agent_')) return conversationId.replace(/^agent_/, '')
  if (conversationId.startsWith('coord:')) return 'Coordinator'
  const sender = typeof lastMessage?.from_agent === 'string' ? lastMessage.from_agent.trim() : ''
  const recipient = typeof lastMessage?.to_agent === 'string' ? lastMessage.to_agent.trim() : ''
  if (sender && sender !== 'human') return sender
  if (recipient && recipient !== 'human') return recipient
  return conversationId
}

function toChatMessage(conversationId: string, value: Partial<ChatMessage> | null | undefined, updatedAt: number): ChatMessage | undefined {
  if (!value) return undefined
  const id = typeof value.id === 'number' ? value.id : updatedAt
  return {
    id,
    conversation_id: conversationId,
    from_agent: typeof value.from_agent === 'string' ? value.from_agent : 'system',
    to_agent: typeof value.to_agent === 'string' ? value.to_agent : null,
    content: typeof value.content === 'string' ? value.content : '',
    message_type: (value.message_type as ChatMessage['message_type']) || 'system',
    metadata: value.metadata,
    attachments: value.attachments,
    read_at: typeof value.read_at === 'number' ? value.read_at : undefined,
    created_at: typeof value.created_at === 'number' ? value.created_at : updatedAt,
    pendingStatus: value.pendingStatus,
  }
}

export function getSessionConversationId(kind: ChatSessionKind, sessionId: string): string {
  return `session:${kind}:${sessionId}`
}

export function filterConversations(conversations: Conversation[], search: string): Conversation[] {
  const normalized = search.trim().toLowerCase()
  if (!normalized) return conversations

  return conversations.filter((conversation) => (
    conversation.id.toLowerCase().includes(normalized) ||
    (conversation.name || '').toLowerCase().includes(normalized) ||
    (conversation.lastMessage?.from_agent || '').toLowerCase().includes(normalized) ||
    (conversation.lastMessage?.content || '').toLowerCase().includes(normalized)
  ))
}

export function bucketConversations(conversations: Conversation[]): ConversationBuckets {
  const gatewayRows = conversations.filter(
    (conversation) => conversation.source === 'session' && conversation.session?.sessionKind === 'gateway',
  )
  const localRows = conversations.filter(
    (conversation) =>
      conversation.source === 'session' &&
      (
        conversation.session?.sessionKind === 'claude-code' ||
        conversation.session?.sessionKind === 'codex-cli' ||
        conversation.session?.sessionKind === 'hermes'
      ),
  )

  return {
    activeGatewayRows: gatewayRows.filter((conversation) => conversation.session?.active),
    inactiveGatewayRows: gatewayRows.filter((conversation) => !conversation.session?.active),
    activeLocalRows: localRows.filter((conversation) => conversation.session?.active),
    inactiveLocalRows: localRows.filter((conversation) => !conversation.session?.active),
    otherRows: conversations.filter((conversation) => conversation.source !== 'session'),
  }
}

export function limitConversationBuckets(
  buckets: ConversationBuckets,
  options: {
    searchActive?: boolean
    expandInactiveGateway?: boolean
    expandInactiveLocal?: boolean
    expandOther?: boolean
    inactiveGatewayLimit?: number
    inactiveLocalLimit?: number
    otherLimit?: number
  } = {},
): LimitedConversationBuckets {
  const searchActive = Boolean(options.searchActive)
  const inactiveGatewayLimit = options.inactiveGatewayLimit ?? 12
  const inactiveLocalLimit = options.inactiveLocalLimit ?? 12
  const otherLimit = options.otherLimit ?? 12

  function limitRows(rows: Conversation[], limit: number, expanded: boolean) {
    if (searchActive || expanded || rows.length <= limit) {
      return { rows, hiddenCount: 0 }
    }
    return {
      rows: rows.slice(0, limit),
      hiddenCount: Math.max(0, rows.length - limit),
    }
  }

  const limitedInactiveGateway = limitRows(buckets.inactiveGatewayRows, inactiveGatewayLimit, Boolean(options.expandInactiveGateway))
  const limitedInactiveLocal = limitRows(buckets.inactiveLocalRows, inactiveLocalLimit, Boolean(options.expandInactiveLocal))
  const limitedOther = limitRows(buckets.otherRows, otherLimit, Boolean(options.expandOther))

  return {
    activeGatewayRows: buckets.activeGatewayRows,
    activeLocalRows: buckets.activeLocalRows,
    inactiveGatewayRows: limitedInactiveGateway.rows,
    inactiveLocalRows: limitedInactiveLocal.rows,
    otherRows: limitedOther.rows,
    hiddenInactiveGatewayCount: limitedInactiveGateway.hiddenCount,
    hiddenInactiveLocalCount: limitedInactiveLocal.hiddenCount,
    hiddenOtherCount: limitedOther.hiddenCount,
  }
}

export function buildConversationIndex(params: {
  sessions: ChatSessionRecord[]
  prefs: ChatSessionPrefs
  persisted: PersistedConversationRecord[]
}): Conversation[] {
  const { sessions, prefs, persisted } = params
  const persistedById = new Map<string, PersistedConversationRecord>()

  for (const row of persisted) {
    if (!row?.conversation_id) continue
    persistedById.set(String(row.conversation_id), row)
  }

  const mergedRows: Conversation[] = sessions.map((session, index) => {
    const sessionKind = normalizeSessionKind(session.kind)
    const conversationId = getSessionConversationId(sessionKind, String(session.id))
    const prefKey = `${sessionKind}:${session.id}`
    const pref = prefs[prefKey] || {}
    const defaultName = session.source === 'local'
      ? `${getKindLabel(sessionKind)} • ${session.key || session.id}`
      : `${session.agent || 'Gateway'} • ${session.key || session.id}`
    const displayName = pref.name || defaultName
    const sessionUpdatedAt = normalizeTimestamp(session.lastActivity || session.startTime || 0)
    const persistedRow = persistedById.get(conversationId)
    const persistedUpdatedAt = normalizeTimestamp(persistedRow?.last_message_at)
    const updatedAt = Math.max(sessionUpdatedAt, persistedUpdatedAt)

    return {
      id: conversationId,
      name: displayName,
      kind: sessionKind,
      source: 'session',
      session: {
        prefKey,
        sessionId: String(session.id),
        sessionKey: session.key || undefined,
        sessionKind,
        agent: session.agent || undefined,
        displayName,
        colorTag: typeof pref.color === 'string' ? pref.color : undefined,
        model: session.model,
        tokens: session.tokens,
        workingDir: session.workingDir || null,
        lastUserPrompt: session.lastUserPrompt || null,
        active: !!session.active,
        age: session.age,
      },
      participants: [],
      lastMessage: toChatMessage(conversationId, persistedRow?.last_message, updatedAt) || {
        id: updatedAt + index,
        conversation_id: conversationId,
        from_agent: 'system',
        to_agent: null,
        content: `${session.model || getKindLabel(sessionKind)} • ${session.tokens || ''}`.trim(),
        message_type: 'system',
        created_at: updatedAt,
      },
      unreadCount: typeof persistedRow?.unread_count === 'number' ? persistedRow.unread_count : 0,
      updatedAt,
    }
  })

  const seenIds = new Set(mergedRows.map((row) => row.id))
  for (const row of persisted) {
    const conversationId = String(row.conversation_id || '')
    if (!conversationId || seenIds.has(conversationId)) continue
    const updatedAt = normalizeTimestamp(row.last_message_at)
    const lastMessage = toChatMessage(conversationId, row.last_message, updatedAt)
    mergedRows.push({
      id: conversationId,
      name: buildFallbackName(conversationId, row.last_message),
      participants: [],
      unreadCount: typeof row.unread_count === 'number' ? row.unread_count : 0,
      updatedAt,
      lastMessage,
    })
  }

  return mergedRows.sort((a, b) => b.updatedAt - a.updatedAt)
}
