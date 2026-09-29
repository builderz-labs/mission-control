import { createHmac } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/command', () => ({ runOpenClaw: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import {
  countUnread,
  findAgent,
  getThread,
  insertA2AMessage,
  listInbox,
  listThreads,
  markRead,
  newThreadId,
  normalizeThreadId,
  recordDelivery,
  getA2AMessage,
} from '@/lib/a2a'
import {
  buildHermesPayload,
  deliverA2AMessage,
  getHermesWebhookConfig,
  signHermesWebhook,
} from '@/lib/a2a-delivery'
import { runOpenClaw } from '@/lib/command'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      runtime_type TEXT,
      session_key TEXT,
      workspace_id INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      metadata TEXT,
      read_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      workspace_id INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO agents (name, runtime_type, session_key, workspace_id) VALUES
      ('hermes', NULL, NULL, 1),
      ('Builder', 'openclaw', 'agent:builder:main', 1),
      ('other-ws', NULL, NULL, 2);
  `)
  return db
}

function send(db: Database.Database, from: string, to: string, content: string, threadId = newThreadId(), workspaceId = 1) {
  return insertA2AMessage(db, { workspaceId, from, to, content, kind: 'message', threadId })
}

describe('A2A storage', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })
  afterEach(() => { db.close() })

  it('normalizes thread ids and rejects unsafe ones', () => {
    expect(normalizeThreadId('abc-123')).toBe('a2a:abc-123')
    expect(normalizeThreadId('a2a:abc-123')).toBe('a2a:abc-123')
    expect(normalizeThreadId('../etc')).toBeNull()
    expect(normalizeThreadId('')).toBeNull()
    expect(newThreadId()).toMatch(/^a2a:[0-9a-f-]{36}$/)
  })

  it('finds agents case-insensitively within the workspace only', () => {
    expect(findAgent(db, 1, 'builder')?.name).toBe('Builder')
    expect(findAgent(db, 1, 'other-ws')).toBeNull()
    expect(findAgent(db, 2, 'other-ws')?.name).toBe('other-ws')
  })

  it('stores messages with the A2A envelope and exposes them in the inbox', () => {
    const msg = insertA2AMessage(db, {
      workspaceId: 1, from: 'Builder', to: 'hermes', content: 'Can you review PR 12?',
      kind: 'request', threadId: 'a2a:t1', subject: 'Review', taskId: 42,
    })
    expect(msg).toMatchObject({
      thread_id: 'a2a:t1', from: 'Builder', to: 'hermes', kind: 'request',
      subject: 'Review', task_id: 42, read_at: null, delivery: null,
    })
    // The comms feed selects conversation_id LIKE 'a2a:%' — keep that contract.
    const row = db.prepare('SELECT conversation_id, message_type FROM messages WHERE id = ?').get(msg.id) as any
    expect(row).toEqual({ conversation_id: 'a2a:t1', message_type: 'a2a' })

    expect(listInbox(db, 1, 'HERMES').map((m) => m.id)).toEqual([msg.id])
    expect(listInbox(db, 1, 'Builder')).toEqual([])
    expect(countUnread(db, 1, 'hermes')).toBe(1)
  })

  it('ignores non-A2A messages and other workspaces', () => {
    db.prepare(`INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type)
                VALUES ('conv_1', 'admin', 'hermes', 'plain chat', 'text')`).run()
    send(db, 'Builder', 'hermes', 'ws2', 'a2a:ws2', 2)
    expect(listInbox(db, 1, 'hermes')).toEqual([])
  })

  it('marks only the recipient\'s own messages read', () => {
    const a = send(db, 'Builder', 'hermes', 'one', 'a2a:t1')
    const b = send(db, 'hermes', 'Builder', 'two', 'a2a:t1')
    const c = send(db, 'Builder', 'hermes', 'three', 'a2a:t2')

    // hermes cannot mark Builder's message read, even by id
    expect(markRead(db, 1, 'hermes', { ids: [b.id] })).toBe(0)
    expect(markRead(db, 1, 'hermes', { threadId: 'a2a:t1' })).toBe(1)
    expect(getA2AMessage(db, 1, a.id)?.read_at).not.toBeNull()
    expect(getA2AMessage(db, 1, c.id)?.read_at).toBeNull()
    expect(listInbox(db, 1, 'hermes', { unreadOnly: true }).map((m) => m.id)).toEqual([c.id])
    expect(markRead(db, 1, 'hermes')).toBe(1)
    expect(countUnread(db, 1, 'hermes')).toBe(0)
  })

  it('returns threads chronologically and summarizes them', () => {
    const first = send(db, 'Builder', 'hermes', 'first', 'a2a:t1')
    const second = send(db, 'hermes', 'Builder', 'second', 'a2a:t1')
    send(db, 'Builder', 'hermes', 'elsewhere', 'a2a:t2')

    expect(getThread(db, 1, 'a2a:t1').map((m) => m.id)).toEqual([first.id, second.id])

    const threads = listThreads(db, 1, { agent: 'hermes' })
    expect(threads.map((t) => t.thread_id)).toEqual(['a2a:t2', 'a2a:t1'])
    const t1 = threads.find((t) => t.thread_id === 'a2a:t1')!
    expect(t1).toMatchObject({ message_count: 2, unread_count: 1 })
    expect(t1.participants.sort()).toEqual(['Builder', 'hermes'])
    expect(t1.last_message.id).toBe(second.id)
  })

  it('records delivery results in metadata without losing the envelope', () => {
    const msg = insertA2AMessage(db, {
      workspaceId: 1, from: 'Builder', to: 'hermes', content: 'x', kind: 'handoff', threadId: 'a2a:t1', subject: 'S',
    })
    recordDelivery(db, msg.id, { mode: 'hermes', delivered: true, at: 1 })
    expect(getA2AMessage(db, 1, msg.id)).toMatchObject({
      kind: 'handoff', subject: 'S', delivery: { mode: 'hermes', delivered: true, at: 1 },
    })
  })
})

describe('A2A delivery', () => {
  const message = {
    id: 7, thread_id: 'a2a:t1', from: 'Builder', to: 'hermes', content: 'hello', kind: 'request' as const,
    subject: 'Help', reply_to: null, task_id: null, delivery: null, read_at: null, created_at: 1,
  }
  const hermes = { id: 1, name: 'hermes', runtime_type: null, session_key: null }
  const env = { MC_HERMES_A2A_WEBHOOK_URL: 'http://127.0.0.1:8644/webhooks/mc-a2a', MC_HERMES_A2A_WEBHOOK_SECRET: 's3cret' }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(runOpenClaw).mockReset()
  })

  it('only enables the Hermes webhook with a valid http(s) URL and a secret', () => {
    expect(getHermesWebhookConfig(env)).toEqual({ url: env.MC_HERMES_A2A_WEBHOOK_URL, secret: 's3cret' })
    expect(getHermesWebhookConfig({ MC_HERMES_A2A_WEBHOOK_URL: env.MC_HERMES_A2A_WEBHOOK_URL })).toBeNull()
    expect(getHermesWebhookConfig({ ...env, MC_HERMES_A2A_WEBHOOK_URL: 'file:///etc/passwd' })).toBeNull()
  })

  it('signs with Hermes Generic V2: hex HMAC-SHA256 of "<timestamp>.<body>"', () => {
    const expected = createHmac('sha256', 'k').update('1700000000.{"a":1}').digest('hex')
    expect(signHermesWebhook('k', 1700000000, '{"a":1}')).toBe(expected)
  })

  it('posts a signed payload to the Hermes webhook', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deliverA2AMessage(message, hermes, env)
    expect(result).toMatchObject({ mode: 'hermes', delivered: true })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(env.MC_HERMES_A2A_WEBHOOK_URL)
    const headers = init.headers as Record<string, string>
    const body = init.body as string
    expect(headers['X-Webhook-Signature-V2']).toBe(signHermesWebhook('s3cret', Number(headers['X-Webhook-Timestamp']), body))
    expect(JSON.parse(body)).toEqual(buildHermesPayload(message))
    expect(JSON.parse(body).text).toContain('mc_reply tool: message_id=7')
  })

  it('reports webhook failures without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad sig', { status: 401 })))
    expect(await deliverA2AMessage(message, hermes, env)).toMatchObject({ delivered: false, reason: 'webhook_http_401' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('ECONNREFUSED') }))
    expect(await deliverA2AMessage(message, hermes, env)).toMatchObject({ delivered: false, reason: 'webhook_unreachable' })
  })

  it('falls back to the inbox when Hermes push is not configured', async () => {
    expect(await deliverA2AMessage(message, hermes, {})).toMatchObject({
      mode: 'inbox', delivered: false, reason: 'hermes_webhook_not_configured',
    })
  })

  it('uses OpenClaw sessions_send for agents with a session key', async () => {
    const builder = { id: 2, name: 'Builder', runtime_type: 'openclaw', session_key: 'agent:builder:main' }
    expect(await deliverA2AMessage({ ...message, to: 'Builder' }, builder, {})).toMatchObject({ mode: 'openclaw', delivered: true })
    expect(vi.mocked(runOpenClaw).mock.calls[0][0]).toEqual(
      expect.arrayContaining(['gateway', 'sessions_send', '--session', 'agent:builder:main']),
    )
  })

  it('keeps messages for agents with no push channel in the inbox', async () => {
    const plain = { id: 3, name: 'scout', runtime_type: null, session_key: null }
    expect(await deliverA2AMessage(message, plain, env)).toMatchObject({ mode: 'inbox', reason: 'no_push_channel' })
  })
})
