import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const runOpenClaw = vi.fn()
const removeAgentFromConfig = vi.fn()
const prepare = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/command', () => ({
  runOpenClaw,
}))

vi.mock('@/lib/agent-sync', () => ({
  writeAgentToConfig: vi.fn(),
  enrichAgentConfigFromWorkspace: vi.fn((value) => value),
  removeAgentFromConfig,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  db_helpers: {
    logActivity: vi.fn(),
  },
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

describe('DELETE /api/agents/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRole.mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1 } })
    runOpenClaw.mockReset()
    removeAgentFromConfig.mockReset()
    prepare.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('removes the agent from OpenClaw config even when workspace deletion is disabled', async () => {
    const agent = { id: 7, name: 'neo', role: 'tester', config: JSON.stringify({ openclawId: 'neo' }) }
    const selectStmt = { get: vi.fn(() => agent) }
    const deleteStmt = { run: vi.fn() }
    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT * FROM agents')) return selectStmt
      if (sql.startsWith('DELETE FROM agents')) return deleteStmt
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { DELETE } = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/7', {
      method: 'DELETE',
      body: JSON.stringify({ remove_workspace: false }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '7' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(removeAgentFromConfig).toHaveBeenCalledWith({ id: 'neo', name: 'neo' })
    expect(deleteStmt.run).toHaveBeenCalledWith(7, 1)
    expect(body.success).toBe(true)
  })

  it('removes workspace via OpenClaw and then removes the config entry', async () => {
    const agent = { id: 8, name: 'adam', role: 'tester', config: JSON.stringify({ openclawId: 'adam' }) }
    const selectStmt = { get: vi.fn(() => agent) }
    const deleteStmt = { run: vi.fn() }
    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT * FROM agents')) return selectStmt
      if (sql.startsWith('DELETE FROM agents')) return deleteStmt
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { DELETE } = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/8', {
      method: 'DELETE',
      body: JSON.stringify({ remove_workspace: true }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '8' }) })

    expect(response.status).toBe(200)
    expect(runOpenClaw).toHaveBeenCalledWith(['agents', 'delete', 'adam', '--force'], { timeoutMs: 30000 })
    expect(removeAgentFromConfig).toHaveBeenCalledWith({ id: 'adam', name: 'adam' })
    expect(deleteStmt.run).toHaveBeenCalledWith(8, 1)
  })

  it('still deletes the Mission Control agent when config cleanup fails', async () => {
    const agent = { id: 9, name: 'trinity', role: 'tester', config: JSON.stringify({ openclawId: 'trinity' }) }
    const selectStmt = { get: vi.fn(() => agent) }
    const deleteStmt = { run: vi.fn() }
    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT * FROM agents')) return selectStmt
      if (sql.startsWith('DELETE FROM agents')) return deleteStmt
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    removeAgentFromConfig.mockRejectedValue(new Error('OPENCLAW_CONFIG_PATH not configured'))

    const { DELETE } = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/9', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '9' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(deleteStmt.run).toHaveBeenCalledWith(9, 1)
    expect(body.success).toBe(true)
    expect(body.warning).toContain('OpenClaw config cleanup skipped')
  })
})
