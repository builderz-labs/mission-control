import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

/**
 * Agent-to-agent (A2A) messaging.
 *
 * Messages live in the shared `messages` table under `a2a:<id>` conversation
 * ids, so the existing comms feed (/api/agents/comms) picks them up. Metadata
 * carries the A2A envelope: kind, subject, reply_to, task_id and the delivery
 * outcome. `read_at` tracks inbox state for the recipient.
 */

export const A2A_THREAD_PREFIX = 'a2a:'
export const A2A_MESSAGE_TYPE = 'a2a'
export const A2A_MAX_CONTENT_LENGTH = 20_000

export const A2A_KINDS = ['message', 'request', 'handoff', 'reply'] as const
export type A2AKind = (typeof A2A_KINDS)[number]

export type A2ADeliveryMode = 'inbox' | 'hermes' | 'openclaw'

export interface A2ADelivery {
  mode: A2ADeliveryMode
  delivered: boolean
  reason?: string
  at: number
}

export interface A2AMessage {
  id: number
  thread_id: string
  from: string
  to: string
  content: string
  kind: A2AKind
  subject: string | null
  reply_to: number | null
  task_id: number | null
  delivery: A2ADelivery | null
  read_at: number | null
  created_at: number
}

export interface A2AThreadSummary {
  thread_id: string
  subject: string | null
  participants: string[]
  message_count: number
  unread_count: number
  last_message: A2AMessage
}

export interface A2AAgentRow {
  id: number
  name: string
  runtime_type: string | null
  session_key: string | null
}

interface MessageRow {
  id: number
  conversation_id: string
  from_agent: string
  to_agent: string | null
  content: string
  metadata: string | null
  read_at: number | null
  created_at: number
}

interface A2AMetadata {
  a2a?: boolean
  kind?: A2AKind
  subject?: string | null
  reply_to?: number | null
  task_id?: number | null
  delivery?: A2ADelivery | null
}

export function newThreadId(): string {
  return `${A2A_THREAD_PREFIX}${randomUUID()}`
}

/** Accepts `a2a:<id>` or the bare `<id>` (URL-friendly) and returns the prefixed form. */
export function normalizeThreadId(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const id = value.startsWith(A2A_THREAD_PREFIX) ? value.slice(A2A_THREAD_PREFIX.length) : value
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  return `${A2A_THREAD_PREFIX}${id}`
}

function parseMetadata(raw: string | null): A2AMetadata {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as A2AMetadata : {}
  } catch {
    return {}
  }
}

function toMessage(row: MessageRow): A2AMessage {
  const meta = parseMetadata(row.metadata)
  return {
    id: row.id,
    thread_id: row.conversation_id,
    from: row.from_agent,
    to: row.to_agent || '',
    content: row.content,
    kind: meta.kind && (A2A_KINDS as readonly string[]).includes(meta.kind) ? meta.kind : 'message',
    subject: meta.subject ?? null,
    reply_to: meta.reply_to ?? null,
    task_id: meta.task_id ?? null,
    delivery: meta.delivery ?? null,
    read_at: row.read_at ?? null,
    created_at: row.created_at,
  }
}

const MESSAGE_COLUMNS = 'id, conversation_id, from_agent, to_agent, content, metadata, read_at, created_at'
const A2A_SCOPE = `workspace_id = ? AND message_type = '${A2A_MESSAGE_TYPE}'`

/** Case-insensitive agent lookup; returns the canonical row. */
export function findAgent(db: Database.Database, workspaceId: number, name: string): A2AAgentRow | null {
  const row = db.prepare(`
    SELECT id, name, runtime_type, session_key
    FROM agents
    WHERE workspace_id = ? AND lower(name) = lower(?)
    LIMIT 1
  `).get(workspaceId, name.trim()) as A2AAgentRow | undefined
  return row ?? null
}

export interface InsertA2AMessageInput {
  workspaceId: number
  from: string
  to: string
  content: string
  kind: A2AKind
  threadId: string
  subject?: string | null
  replyTo?: number | null
  taskId?: number | null
}

export function insertA2AMessage(db: Database.Database, input: InsertA2AMessageInput): A2AMessage {
  const metadata: A2AMetadata = {
    a2a: true,
    kind: input.kind,
    subject: input.subject ?? null,
    reply_to: input.replyTo ?? null,
    task_id: input.taskId ?? null,
    delivery: null,
  }
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.threadId,
    input.from,
    input.to,
    input.content,
    A2A_MESSAGE_TYPE,
    JSON.stringify(metadata),
    input.workspaceId,
  )
  return getA2AMessage(db, input.workspaceId, Number(result.lastInsertRowid))!
}

export function getA2AMessage(db: Database.Database, workspaceId: number, id: number): A2AMessage | null {
  const row = db.prepare(`
    SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ? AND ${A2A_SCOPE}
  `).get(id, workspaceId) as MessageRow | undefined
  return row ? toMessage(row) : null
}

export function recordDelivery(db: Database.Database, id: number, delivery: A2ADelivery): void {
  db.prepare(`
    UPDATE messages
    SET metadata = json_set(COALESCE(metadata, '{}'), '$.delivery', json(?))
    WHERE id = ?
  `).run(JSON.stringify(delivery), id)
}

export interface InboxQuery {
  unreadOnly?: boolean
  since?: number
  limit?: number
}

/** Messages addressed to `agent`, newest first. */
export function listInbox(
  db: Database.Database,
  workspaceId: number,
  agent: string,
  query: InboxQuery = {},
): A2AMessage[] {
  const params: unknown[] = [workspaceId, agent]
  let where = `${A2A_SCOPE} AND lower(to_agent) = lower(?)`
  if (query.unreadOnly) where += ' AND read_at IS NULL'
  if (query.since) {
    where += ' AND created_at > ?'
    params.push(query.since)
  }
  params.push(clampLimit(query.limit))
  const rows = db.prepare(`
    SELECT ${MESSAGE_COLUMNS} FROM messages
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params) as MessageRow[]
  return rows.map(toMessage)
}

export function countUnread(db: Database.Database, workspaceId: number, agent: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE ${A2A_SCOPE} AND lower(to_agent) = lower(?) AND read_at IS NULL
  `).get(workspaceId, agent) as { c: number }
  return row.c
}

/**
 * Marks messages addressed to `agent` as read. Pass `ids`, a `threadId`, or
 * neither (whole inbox). Messages addressed to other agents are never touched.
 */
export function markRead(
  db: Database.Database,
  workspaceId: number,
  agent: string,
  target: { ids?: number[]; threadId?: string } = {},
): number {
  const params: unknown[] = [Math.floor(Date.now() / 1000), workspaceId, agent]
  let where = `${A2A_SCOPE} AND lower(to_agent) = lower(?) AND read_at IS NULL`
  if (target.ids?.length) {
    where += ` AND id IN (${target.ids.map(() => '?').join(',')})`
    params.push(...target.ids)
  }
  if (target.threadId) {
    where += ' AND conversation_id = ?'
    params.push(target.threadId)
  }
  return db.prepare(`UPDATE messages SET read_at = ? WHERE ${where}`).run(...params).changes
}

/** Thread messages in chronological order. */
export function getThread(db: Database.Database, workspaceId: number, threadId: string, limit?: number): A2AMessage[] {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT ${MESSAGE_COLUMNS} FROM messages
      WHERE ${A2A_SCOPE} AND conversation_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    ) ORDER BY created_at ASC, id ASC
  `).all(workspaceId, threadId, clampLimit(limit, 500, 500)) as MessageRow[]
  return rows.map(toMessage)
}

/** Threads (optionally only those `agent` takes part in), most recently active first. */
export function listThreads(
  db: Database.Database,
  workspaceId: number,
  options: { agent?: string; limit?: number } = {},
): A2AThreadSummary[] {
  const params: unknown[] = [workspaceId]
  let where = A2A_SCOPE
  if (options.agent) {
    where += ' AND (lower(from_agent) = lower(?) OR lower(to_agent) = lower(?))'
    params.push(options.agent, options.agent)
  }
  params.push(clampLimit(options.limit))
  const threads = db.prepare(`
    SELECT conversation_id, MAX(id) AS last_id, COUNT(*) AS message_count
    FROM messages
    WHERE ${where}
    GROUP BY conversation_id
    ORDER BY MAX(created_at) DESC, last_id DESC
    LIMIT ?
  `).all(...params) as Array<{ conversation_id: string; last_id: number; message_count: number }>

  return threads.map((thread) => {
    const messages = getThread(db, workspaceId, thread.conversation_id)
    const participants = new Set<string>()
    for (const m of messages) {
      participants.add(m.from)
      if (m.to) participants.add(m.to)
    }
    const unread = options.agent
      ? messages.filter((m) => !m.read_at && m.to.toLowerCase() === options.agent!.toLowerCase()).length
      : messages.filter((m) => !m.read_at).length
    return {
      thread_id: thread.conversation_id,
      subject: messages.find((m) => m.subject)?.subject ?? null,
      participants: [...participants],
      message_count: thread.message_count,
      unread_count: unread,
      last_message: messages[messages.length - 1],
    }
  })
}

function clampLimit(limit: number | undefined, max = 200, fallback = 50): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return fallback
  return Math.min(Math.floor(limit), max)
}
