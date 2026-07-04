import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { createWorkspaceSchema, updateWorkspaceSchema } from '@/lib/validation'
import { WORKSPACE_ISOLATION_VALUES } from '@/lib/workspaces'

/**
 * Issue #677 slice 1: native `brand` and `isolation` fields on workspaces.
 *
 * SQLite's ALTER TABLE cannot add CHECK constraints, so migration 052 adds the
 * plain columns and the allowed isolation values ('shared' | 'strict') are
 * enforced by the zod schemas — these tests cover both layers plus the API
 * round-trip through the real route handlers on an in-memory database.
 */

let db: InstanceType<typeof Database>

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
  logAuditEvent: vi.fn(),
}))

const requireRole = vi.fn()
vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  const defaultWs = db.prepare('SELECT tenant_id FROM workspaces WHERE id = 1').get() as { tenant_id: number }
  requireRole.mockReturnValue({
    user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1, tenant_id: defaultWs.tenant_id },
  })
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('migration 052_workspace_brand_isolation', () => {
  it('adds brand and isolation columns to workspaces', () => {
    const cols = db.prepare('PRAGMA table_info(workspaces)').all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('brand')
    expect(names).toContain('isolation')
  })

  it('is recorded in schema_migrations', () => {
    const row = db.prepare("SELECT id FROM schema_migrations WHERE id = '052_workspace_brand_isolation'").get()
    expect(row).toBeDefined()
  })

  it('backfills existing rows with null brand and shared isolation', () => {
    const ws = db.prepare('SELECT brand, isolation FROM workspaces WHERE id = 1').get() as {
      brand: string | null
      isolation: string
    }
    expect(ws.brand).toBeNull()
    expect(ws.isolation).toBe('shared')
  })
})

describe('workspace validation schemas', () => {
  it('accepts every allowed isolation value', () => {
    for (const isolation of WORKSPACE_ISOLATION_VALUES) {
      expect(createWorkspaceSchema.safeParse({ name: 'W', isolation }).success).toBe(true)
      expect(updateWorkspaceSchema.safeParse({ name: 'W', isolation }).success).toBe(true)
    }
  })

  it('rejects isolation values outside the enum', () => {
    for (const isolation of ['isolated', 'open', 'SHARED', '', 42, null]) {
      expect(createWorkspaceSchema.safeParse({ name: 'W', isolation }).success).toBe(false)
      expect(updateWorkspaceSchema.safeParse({ name: 'W', isolation }).success).toBe(false)
    }
  })

  it('accepts optional brand, nullable to clear, capped at 64 chars', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'W' }).success).toBe(true)
    expect(createWorkspaceSchema.safeParse({ name: 'W', brand: 'iaescola' }).success).toBe(true)
    expect(updateWorkspaceSchema.safeParse({ name: 'W', brand: null }).success).toBe(true)
    expect(createWorkspaceSchema.safeParse({ name: 'W', brand: 'x'.repeat(64) }).success).toBe(true)
    expect(createWorkspaceSchema.safeParse({ name: 'W', brand: 'x'.repeat(65) }).success).toBe(false)
    expect(createWorkspaceSchema.safeParse({ name: 'W', brand: 42 }).success).toBe(false)
  })
})

describe('workspaces API round-trip', () => {
  it('POST /api/workspaces persists brand and isolation', async () => {
    const { POST } = await import('@/app/api/workspaces/route')
    const res = await POST(jsonRequest('/api/workspaces', 'POST', {
      name: 'Petit Roig',
      brand: 'petit_roig',
      isolation: 'strict',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.workspace.brand).toBe('petit_roig')
    expect(body.workspace.isolation).toBe('strict')
  })

  it('POST /api/workspaces defaults isolation to shared and brand to null', async () => {
    const { POST } = await import('@/app/api/workspaces/route')
    const res = await POST(jsonRequest('/api/workspaces', 'POST', { name: 'Plain' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.workspace.brand).toBeNull()
    expect(body.workspace.isolation).toBe('shared')
  })

  it('POST /api/workspaces rejects invalid isolation values', async () => {
    const { POST } = await import('@/app/api/workspaces/route')
    const res = await POST(jsonRequest('/api/workspaces', 'POST', {
      name: 'Bad',
      isolation: 'isolated',
    }))
    expect(res.status).toBe(400)
  })

  it('PUT /api/workspaces/[id] updates fields, preserves omitted ones, and clears brand with null', async () => {
    const { POST } = await import('@/app/api/workspaces/route')
    const { PUT } = await import('@/app/api/workspaces/[id]/route')
    const created = await (await POST(jsonRequest('/api/workspaces', 'POST', {
      name: 'IAEscola',
      brand: 'iaescola',
      isolation: 'strict',
    }))).json()
    const id = String(created.workspace.id)
    const params = { params: Promise.resolve({ id }) }

    // Omitting brand/isolation preserves stored values
    let res = await PUT(jsonRequest(`/api/workspaces/${id}`, 'PUT', { name: 'IAEscola 2' }), params)
    expect(res.status).toBe(200)
    let body = await res.json()
    expect(body.workspace.name).toBe('IAEscola 2')
    expect(body.workspace.brand).toBe('iaescola')
    expect(body.workspace.isolation).toBe('strict')

    // Explicit updates apply; brand: null clears
    res = await PUT(jsonRequest(`/api/workspaces/${id}`, 'PUT', {
      name: 'IAEscola 2',
      brand: null,
      isolation: 'shared',
    }), params)
    expect(res.status).toBe(200)
    body = await res.json()
    expect(body.workspace.brand).toBeNull()
    expect(body.workspace.isolation).toBe('shared')
  })

  it('PUT /api/workspaces/[id] rejects invalid isolation values', async () => {
    const { PUT } = await import('@/app/api/workspaces/[id]/route')
    const res = await PUT(
      jsonRequest('/api/workspaces/1', 'PUT', { name: 'Default Workspace', isolation: 'open' }),
      { params: Promise.resolve({ id: '1' }) }
    )
    expect(res.status).toBe(400)
  })

  it('GET /api/workspaces returns brand and isolation for each workspace', async () => {
    const { GET, POST } = await import('@/app/api/workspaces/route')
    await POST(jsonRequest('/api/workspaces', 'POST', { name: 'Branded', brand: 'acme', isolation: 'strict' }))
    const res = await GET(new NextRequest('http://localhost/api/workspaces'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const branded = body.workspaces.find((w: { slug: string }) => w.slug === 'branded')
    expect(branded.brand).toBe('acme')
    expect(branded.isolation).toBe('strict')
    for (const ws of body.workspaces) {
      expect('brand' in ws).toBe(true)
      expect(WORKSPACE_ISOLATION_VALUES).toContain(ws.isolation)
    }
  })
})
