import { describe, expect, it, afterEach, vi } from 'vitest'

// Mock heavy dependencies so the module can be imported in unit-test context
// without a real WebSocket or config file.
vi.mock('ws', () => ({ default: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { gatewayHost: '127.0.0.1', gatewayPort: 18789 } }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { buildGatewayWsUrl } from '@/lib/gateway-proxy'

// buildGatewayWsUrl reads OPENCLAW_GATEWAY_PROTOCOL from process.env; clean up after tests.
afterEach(() => {
  delete process.env.OPENCLAW_GATEWAY_PROTOCOL
})

describe('buildGatewayWsUrl — protocol selection', () => {
  it('uses ws:// for 127.0.0.1 (loopback)', () => {
    expect(buildGatewayWsUrl('127.0.0.1', 18789)).toBe('ws://127.0.0.1:18789')
  })

  it('uses ws:// for ::1 (IPv6 loopback)', () => {
    expect(buildGatewayWsUrl('::1', 18789)).toBe('ws://::1:18789')
  })

  it('uses ws:// for localhost', () => {
    expect(buildGatewayWsUrl('localhost', 18789)).toBe('ws://localhost:18789')
  })

  it('uses ws:// for *.local hosts', () => {
    expect(buildGatewayWsUrl('gateway.local', 18789)).toBe('ws://gateway.local:18789')
  })

  it('uses ws:// for 0.0.0.0 (bind-wildcard treated as local)', () => {
    // Regression: previously picked wss:// causing EPROTO SSL crash
    expect(buildGatewayWsUrl('0.0.0.0', 18789)).toBe('ws://0.0.0.0:18789')
  })

  it('uses ws:// for :: (IPv6 bind-wildcard treated as local)', () => {
    expect(buildGatewayWsUrl('::', 18789)).toBe('ws://:::18789')
  })

  it('uses wss:// for a remote hostname', () => {
    expect(buildGatewayWsUrl('gateway.example.com', 18789)).toBe('wss://gateway.example.com:18789')
  })

  it('uses wss:// for a Tailscale hostname', () => {
    expect(buildGatewayWsUrl('cb-vcn.tail47c878.ts.net', 18789)).toBe('wss://cb-vcn.tail47c878.ts.net:18789')
  })
})

describe('buildGatewayWsUrl — OPENCLAW_GATEWAY_PROTOCOL override', () => {
  it('forces wss:// when OPENCLAW_GATEWAY_PROTOCOL=wss even for loopback', () => {
    process.env.OPENCLAW_GATEWAY_PROTOCOL = 'wss'
    expect(buildGatewayWsUrl('127.0.0.1', 18789)).toBe('wss://127.0.0.1:18789')
  })

  it('forces wss:// when OPENCLAW_GATEWAY_PROTOCOL=https', () => {
    process.env.OPENCLAW_GATEWAY_PROTOCOL = 'https'
    expect(buildGatewayWsUrl('127.0.0.1', 18789)).toBe('wss://127.0.0.1:18789')
  })

  it('forces wss:// for 0.0.0.0 when explicitly set to wss', () => {
    process.env.OPENCLAW_GATEWAY_PROTOCOL = 'wss'
    expect(buildGatewayWsUrl('0.0.0.0', 18789)).toBe('wss://0.0.0.0:18789')
  })
})
