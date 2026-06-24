import { afterEach, describe, expect, it, vi } from 'vitest'

const { getDatabaseMock } = vi.hoisted(() => ({ getDatabaseMock: vi.fn() }))

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}))

import { GET } from '@/app/api/health/route'

describe('GET /api/health — public, minimal-disclosure health probe (#698)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 + status ok when the DB is reachable', async () => {
    getDatabaseMock.mockReturnValue({ prepare: () => ({ get: () => ({ 1: 1 }) }) })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.db).toBe('ok')
  })

  it('returns 503 + status degraded when the DB throws', async () => {
    getDatabaseMock.mockImplementation(() => {
      throw new Error('SQLITE_CANTOPEN: unable to open /var/secret/path/mc.db')
    })
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(body.db).toBe('error')
  })

  it('does NOT leak row counts or raw error detail to anonymous callers', async () => {
    // Success path: must not expose task_count or any row data.
    getDatabaseMock.mockReturnValue({ prepare: () => ({ get: () => ({ 1: 1 }) }) })
    const okBody = await (await GET()).json()
    expect(okBody).not.toHaveProperty('task_count')
    expect(JSON.stringify(okBody)).not.toMatch(/count|user|path|secret/i)

    // Error path: must not echo the exception message (file paths / schema hints).
    getDatabaseMock.mockImplementation(() => {
      throw new Error('SQLITE_CANTOPEN: unable to open /var/secret/path/mc.db')
    })
    const errBody = await (await GET()).json()
    expect(errBody).not.toHaveProperty('error')
    expect(JSON.stringify(errBody)).not.toMatch(/SQLITE|secret|\.db|unable to open/)
  })
})
