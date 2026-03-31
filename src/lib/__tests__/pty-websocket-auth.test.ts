import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireRoleMock = vi.fn()
const wsServers: any[] = []

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('ws', () => {
  class MockWebSocketServer {
    handlers: Record<string, (...args: any[]) => void> = {}
    handleUpgrade = vi.fn()
    emit = vi.fn()

    constructor(_opts: any) {
      wsServers.push(this)
    }

    on(event: string, handler: (...args: any[]) => void) {
      this.handlers[event] = handler
    }
  }

  return {
    WebSocketServer: MockWebSocketServer,
    WebSocket: { OPEN: 1 },
  }
})

vi.mock('@/lib/pty-manager', () => ({
  createPtySession: vi.fn(),
  getPtySession: vi.fn(),
}))

function makeSocket() {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('handlePtyUpgrade auth and validation', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRoleMock.mockReset()
    wsServers.length = 0
  })

  it('returns false for non-PTY paths', async () => {
    const { handlePtyUpgrade } = await import('@/lib/pty-websocket')
    const socket = makeSocket()

    const handled = handlePtyUpgrade(
      { url: '/ws/other', headers: { host: 'localhost:3000' }, method: 'GET', socket: {} } as any,
      socket as any,
      Buffer.alloc(0),
    )

    expect(handled).toBe(false)
    expect(socket.write).not.toHaveBeenCalled()
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported kind before auth', async () => {
    const { handlePtyUpgrade } = await import('@/lib/pty-websocket')
    const socket = makeSocket()

    const handled = handlePtyUpgrade(
      { url: '/ws/pty?session=s1&kind=hermes&mode=readonly', headers: { host: 'localhost:3000' }, method: 'GET', socket: {} } as any,
      socket as any,
      Buffer.alloc(0),
    )

    expect(handled).toBe(true)
    expect(requireRoleMock).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledOnce()
    expect(String(socket.write.mock.calls[0][0])).toContain('400 Bad Request')
    expect(socket.destroy).toHaveBeenCalledOnce()
  })

  it('rejects unauthenticated readonly upgrade with 401', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { handlePtyUpgrade } = await import('@/lib/pty-websocket')
    const socket = makeSocket()

    const handled = handlePtyUpgrade(
      { url: '/ws/pty?session=s1&kind=claude-code&mode=readonly', headers: { host: 'localhost:3000' }, method: 'GET', socket: {} } as any,
      socket as any,
      Buffer.alloc(0),
    )

    expect(handled).toBe(true)
    expect(requireRoleMock).toHaveBeenCalledOnce()
    expect(requireRoleMock.mock.calls[0][1]).toBe('viewer')
    expect(String(socket.write.mock.calls[0][0])).toContain('401 Unauthorized')
    expect(socket.destroy).toHaveBeenCalledOnce()
  })

  it('requires operator role for interactive upgrades', async () => {
    requireRoleMock.mockReturnValue({ error: 'Requires operator role or higher', status: 403 })
    const { handlePtyUpgrade } = await import('@/lib/pty-websocket')
    const socket = makeSocket()

    const handled = handlePtyUpgrade(
      { url: '/ws/pty?session=s1&kind=codex-cli&mode=interactive', headers: { host: 'localhost:3000' }, method: 'GET', socket: {} } as any,
      socket as any,
      Buffer.alloc(0),
    )

    expect(handled).toBe(true)
    expect(requireRoleMock).toHaveBeenCalledOnce()
    expect(requireRoleMock.mock.calls[0][1]).toBe('operator')
    expect(String(socket.write.mock.calls[0][0])).toContain('403 Forbidden')
    expect(socket.destroy).toHaveBeenCalledOnce()
  })

  it('upgrades when auth succeeds and params are valid', async () => {
    requireRoleMock.mockReturnValue({ user: { role: 'admin' } })
    const { handlePtyUpgrade } = await import('@/lib/pty-websocket')
    const socket = makeSocket()

    const handled = handlePtyUpgrade(
      { url: '/ws/pty?session=s1&kind=claude-code&mode=readonly', headers: { host: 'localhost:3000' }, method: 'GET', socket: {} } as any,
      socket as any,
      Buffer.alloc(0),
    )

    expect(handled).toBe(true)
    expect(wsServers).toHaveLength(1)
    expect(wsServers[0].handleUpgrade).toHaveBeenCalledOnce()
    expect(socket.write).not.toHaveBeenCalled()
    expect(socket.destroy).not.toHaveBeenCalled()
  })
})
