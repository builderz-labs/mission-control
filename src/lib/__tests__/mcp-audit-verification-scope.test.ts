import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ getDatabase: mocks.getDatabase }))
vi.mock('@/lib/receipt-signing', () => ({
  signAuditRecord: vi.fn(),
  verifyAuditRecord: vi.fn(),
}))

import { verifyMcpCallReceipt } from '@/lib/mcp-audit'

describe('MCP audit receipt workspace isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries a single record by both ID and workspace ID', () => {
    const get = vi.fn().mockReturnValue(undefined)
    const prepare = vi.fn().mockReturnValue({ get })
    mocks.getDatabase.mockReturnValue({ prepare })

    const result = verifyMcpCallReceipt(42, 7)

    expect(prepare).toHaveBeenCalledWith(
      'SELECT * FROM mcp_call_log WHERE id = ? AND workspace_id = ?',
    )
    expect(get).toHaveBeenCalledWith(42, 7)
    expect(result).toEqual({ valid: false, record: null, error: 'Record not found' })
  })
})
