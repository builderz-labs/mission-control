import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  memoryDir: '',
}))

vi.mock('@/lib/config', () => ({
  config: {
    get memoryDir() { return state.memoryDir },
    memoryAllowedPrefixes: [],
  },
}))

const requireRoleMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null),
  mutationLimiter: vi.fn(() => null),
}))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
  db_helpers: { logActivity: vi.fn() },
}))
vi.mock('@/lib/workspace-isolation', () => ({
  resolveWorkspaceMemoryAccess: vi.fn(() => ({
    isolation: 'shared',
    root: state.memoryDir,
    scope: 'shared',
  })),
}))

let tempRoot = ''

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mc-exists-test-'))
  state.memoryDir = tempRoot
  mkdirSync(join(tempRoot, 'docs/plans'), { recursive: true })
  writeFileSync(join(tempRoot, 'docs/plans/real.md'), '# real\n')
})

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('GET /api/memory?action=exists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({
      user: { username: 'viewer', role: 'viewer', workspace_id: 1 },
    })
  })

  it('returns exists:true for a file present in the memory root', async () => {
    const { GET } = await import('@/app/api/memory/route')
    const response = await GET(
      new NextRequest('http://localhost/api/memory?action=exists&path=docs/plans/real.md'),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ path: 'docs/plans/real.md', exists: true })
  })

  it('returns exists:false (not 404) for a file that does not exist yet', async () => {
    const { GET } = await import('@/app/api/memory/route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/memory?action=exists&path=products/qr_code_resolvers/fallback.py',
      ),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      path: 'products/qr_code_resolvers/fallback.py',
      exists: false,
    })
  })

  it('rejects path traversal attempts', async () => {
    const { GET } = await import('@/app/api/memory/route')
    const response = await GET(
      new NextRequest('http://localhost/api/memory?action=exists&path=../secret.env'),
    )
    expect(response.status).toBe(403)
  })
})
