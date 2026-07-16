import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  verifyOne: vi.fn(),
  verifyMany: vi.fn(),
  getPublicKey: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/mcp-audit', () => ({
  verifyMcpCallReceipt: mocks.verifyOne,
  verifyMcpCallReceipts: mocks.verifyMany,
}))
vi.mock('@/lib/receipt-signing', () => ({ getPublicKey: mocks.getPublicKey }))

import { GET } from '@/app/api/mcp-audit/verify/route'

describe('MCP audit verification route security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockReturnValue({
      user: { workspace_id: 7 },
    })
    mocks.verifyOne.mockReturnValue({ valid: true, record: {} })
    mocks.verifyMany.mockReturnValue({
      total: 0,
      signed: 0,
      verified: 0,
      failed: 0,
      unsigned: 0,
    })
    mocks.getPublicKey.mockReturnValue('public-key')
  })

  it('uses authenticated workspace scope for batch verification', async () => {
    const response = await GET(new Request(
      'http://localhost/api/mcp-audit/verify?hours=48&workspace_id=999',
    ))

    expect(response.status).toBe(200)
    expect(mocks.verifyMany).toHaveBeenCalledWith(48, 7)
  })

  it('uses authenticated workspace scope for single-record verification', async () => {
    const response = await GET(new Request(
      'http://localhost/api/mcp-audit/verify?id=42&workspace_id=999',
    ))

    expect(response.status).toBe(200)
    expect(mocks.verifyOne).toHaveBeenCalledWith(42, 7)
  })

  it.each([
    ['id=0', 'id'],
    ['id=12junk', 'id'],
    ['hours=0', 'hours'],
    ['hours=169', 'hours'],
    ['hours=Infinity', 'hours'],
  ])('rejects invalid verification selector %s', async (query, field) => {
    const response = await GET(new Request(`http://localhost/api/mcp-audit/verify?${query}`))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining(field) })
    expect(mocks.verifyOne).not.toHaveBeenCalled()
    expect(mocks.verifyMany).not.toHaveBeenCalled()
  })
})
