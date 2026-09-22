// @vitest-environment node
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { jevSetupSessionMigration } from '@/lib/jev-setup-session-migration'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), assistant: vi.fn(), audit: vi.fn() }))
let db: InstanceType<typeof Database>

vi.mock('@/lib/db', () => ({ getDatabase: () => db, logAuditEvent: mocks.audit }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null), mutationLimiter: vi.fn(() => null),
}))
vi.mock('@/lib/jev-assistant-rate-limit', () => ({ jevAssistantLimiter: vi.fn(() => null) }))
vi.mock('@/lib/jev-assistant-service', () => ({ createJevAssistantDraft: mocks.assistant }))

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  jevSetupSessionMigration.up(db)
  db.prepare(`
    INSERT INTO users (id,username,display_name,password_hash,role,workspace_id)
    VALUES (401,'operator','Operator','unused','operator',1)
  `).run()
  db.prepare(`
    INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix)
    VALUES (481,1,'Owned','owned-route','OWR')
  `).run()
  mocks.auth.mockReturnValue({
    user: { id: 401, username: 'operator', role: 'operator', workspace_id: 1, tenant_id: 1 },
  })
  mocks.assistant.mockReset()
  mocks.audit.mockReset()
})

afterEach(() => db.close())

async function createSession(): Promise<string> {
  const { POST } = await import('@/app/api/jev/sessions/route')
  const response = await POST(new NextRequest('http://localhost/api/jev/sessions', {
    method: 'POST',
    body: JSON.stringify({ projectId: 481, title: 'Plan secret=do-not-store' }),
  }))
  expect(response.status).toBe(201)
  return (await response.json() as { session: { id: string } }).session.id
}

describe('Jev setup-session routes', () => {
  it('creates, lists, updates, reads, and archives an owned session', async () => {
    const id = await createSession()
    const sessionsRoute = await import('@/app/api/jev/sessions/route')
    const listed = await sessionsRoute.GET(new NextRequest('http://localhost/api/jev/sessions'))
    expect((await listed.json() as { sessions: unknown[] }).sessions).toHaveLength(1)

    const itemRoute = await import('@/app/api/jev/sessions/[id]/route')
    const context = { params: Promise.resolve({ id }) }
    const updated = await itemRoute.PATCH(new NextRequest(`http://localhost/api/jev/sessions/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
    }), context)
    expect((await updated.json() as { session: { status: string } }).session.status).toBe('ready')
    expect((await itemRoute.GET(new NextRequest(`http://localhost/${id}`), context)).status).toBe(200)
    expect((await itemRoute.DELETE(new NextRequest(`http://localhost/${id}`), context)).status).toBe(200)
  })

  it('persists a redacted assistant exchange only after provider success', async () => {
    const id = await createSession()
    mocks.assistant.mockResolvedValue({
      draft: { summary: 'Draft', name: 'Policy', description: 'Description', questions: {
        ready: { type: 'noul', instructions: 'Ready?' },
      }, tests: ['test'], risks: ['risk'], observability: ['metric'], warnings: [] },
      configuration: { scope: 'current' },
      provider: { kind: 'claude-cli', model: 'haiku' }, warnings: [],
    })
    const { POST } = await import('@/app/api/jev/assistant/route')
    const response = await POST(new NextRequest('http://localhost/api/jev/assistant', {
      method: 'POST', body: JSON.stringify({
        sessionId: id, action: 'draft', goal: 'Use token=secret-value-123',
        answers: {}, projectIds: [481],
      }),
    }))
    expect(response.status).toBe(200)
    const stored = JSON.stringify(db.prepare('SELECT * FROM jev_setup_messages').all())
    expect(stored).not.toContain('secret-value-123')
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_setup_messages').get()).toEqual({ count: 2 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_setup_revisions').get()).toEqual({ count: 1 })
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ session_id: id, revision_no: 1 }),
    }))
  })

  it('does not persist a partial exchange when the provider fails', async () => {
    const id = await createSession()
    mocks.assistant.mockRejectedValue(new Error('provider failed'))
    const { POST } = await import('@/app/api/jev/assistant/route')
    const response = await POST(new NextRequest('http://localhost/api/jev/assistant', {
      method: 'POST', body: JSON.stringify({
        sessionId: id, action: 'draft', goal: 'Assess readiness',
        answers: {}, projectIds: [481],
      }),
    }))
    expect(response.status).toBe(500)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_setup_messages').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_setup_revisions').get()).toEqual({ count: 0 })
  })

  it('rejects non-owner mutation without changing the session', async () => {
    const id = await createSession()
    mocks.auth.mockReturnValue({
      user: { id: 402, username: 'other', role: 'operator', workspace_id: 1, tenant_id: 1 },
    })
    const { PATCH } = await import('@/app/api/jev/sessions/[id]/route')
    const response = await PATCH(new NextRequest(`http://localhost/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
    }), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(403)
    expect(db.prepare('SELECT status FROM jev_setup_sessions WHERE id=?').get(id))
      .toEqual({ status: 'draft' })
  })

  it('persists and enforces ownership for an agent API principal', async () => {
    mocks.auth.mockReturnValue({
      user: { id: -7, agent_id: 77, username: 'agent:codex', role: 'operator',
        workspace_id: 1, tenant_id: 1 },
    })
    const id = await createSession()
    expect(db.prepare(`SELECT created_by_user_id,created_by_principal
      FROM jev_setup_sessions WHERE id=?`).get(id)).toEqual({
      created_by_user_id: 401, created_by_principal: 'agent:77',
    })

    const { PATCH } = await import('@/app/api/jev/sessions/[id]/route')
    const owned = await PATCH(new NextRequest(`http://localhost/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
    }), { params: Promise.resolve({ id }) })
    expect(owned.status).toBe(200)

    mocks.auth.mockReturnValue({
      user: { id: -8, agent_id: 78, username: 'agent:other', role: 'operator',
        workspace_id: 1, tenant_id: 1 },
    })
    const denied = await PATCH(new NextRequest(`http://localhost/${id}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'Other' }),
    }), { params: Promise.resolve({ id }) })
    expect(denied.status).toBe(403)
  })
})
