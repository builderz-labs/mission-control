// @vitest-environment node
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), run: vi.fn(), audit: vi.fn() }))
let db: InstanceType<typeof Database>

vi.mock('@/lib/db', () => ({ getDatabase: () => db, logAuditEvent: mocks.audit }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null), mutationLimiter: vi.fn(() => null), heavyLimiter: vi.fn(() => null),
}))
vi.mock('@/lib/jev-service', () => ({ runJevEvaluation: mocks.run }))

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare("INSERT INTO tenants (id,slug,display_name,linux_user,openclaw_home,workspace_root) VALUES (2,'two','Two','two','/tmp/two','/tmp/two')").run()
  db.prepare("INSERT INTO workspaces (id,slug,name,tenant_id) VALUES (2,'two','Two',2)").run()
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (81,1,'One','one','ONE')").run()
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (82,2,'Two','two','TWO')").run()
  mocks.requireRole.mockReturnValue({ user: { id: 1, username: 'op', role: 'operator', workspace_id: 1, tenant_id: 1 } })
  mocks.run.mockReset()
  mocks.audit.mockReset()
})

afterEach(() => db.close())

describe('Jev API routes', () => {
  it('rejects a project owned by another workspace and tenant', async () => {
    const { GET } = await import('@/app/api/jev/policies/route')
    const response = await GET(new NextRequest('http://localhost/api/jev/policies?projectId=82'))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Project not found' })
  })

  it('validates policy payloads before any database write', async () => {
    const { POST } = await import('@/app/api/jev/policies/route')
    const response = await POST(new NextRequest('http://localhost/api/jev/policies', {
      method: 'POST', body: JSON.stringify({ projectId: 81, name: '', questions: {} }),
    }))
    expect(response.status).toBe(400)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_policies').get()).toEqual({ count: 0 })
  })

  it('passes only the explicitly supplied state to the evaluation service', async () => {
    mocks.run.mockResolvedValue({ id: 'eval', answers: {}, model: 'jev-1.13.0' })
    const { POST } = await import('@/app/api/jev/evaluations/route')
    const response = await POST(new NextRequest('http://localhost/api/jev/evaluations', {
      method: 'POST', body: JSON.stringify({ projectId: 81, policyId: 2, state: { summary: 'explicit' } }),
    }))
    expect(response.status).toBe(201)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 1, projectId: 81, policyId: 2, state: { summary: 'explicit' },
    }))
    expect(JSON.stringify(mocks.run.mock.calls[0])).not.toContain('github_repo')
  })

  it('enforces operator authorization before parsing or running', async () => {
    mocks.requireRole.mockReturnValue({ error: 'Requires operator role or higher', status: 403 })
    const { POST } = await import('@/app/api/jev/evaluations/route')
    const response = await POST(new NextRequest('http://localhost/api/jev/evaluations', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(403)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('returns a client error for a malformed policy identifier', async () => {
    const { PATCH } = await import('@/app/api/jev/policies/[id]/route')
    const response = await PATCH(new NextRequest('http://localhost/api/jev/policies/not-a-number', {
      method: 'PATCH', body: JSON.stringify({ projectId: 81, name: 'Updated' }),
    }), { params: Promise.resolve({ id: 'not-a-number' }) })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Valid policy identifier is required' })
  })

  it('builds metadata-only context without crossing workspace boundaries', async () => {
    const { GET } = await import('@/app/api/jev/context/route')
    const response = await GET(new NextRequest('http://localhost/api/jev/context?projectId=81'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      context: { source: 'project-metadata', state: { repository: { name: 'One' } } },
    })
    const blocked = await GET(new NextRequest('http://localhost/api/jev/context?projectId=82'))
    expect(blocked.status).toBe(404)
  })
})
