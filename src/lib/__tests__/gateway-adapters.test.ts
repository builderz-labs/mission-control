import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getGatewayAdaptersFromEnv, getGatewayAdapterByName } from '../gateway-adapters'

describe('getGatewayAdaptersFromEnv', () => {
  const ORIG = process.env

  beforeEach(() => {
    process.env = { ...ORIG }
  })

  afterEach(() => {
    process.env = ORIG
  })

  it('returns a default openclaw adapter when MC_GATEWAY_ADAPTERS is unset', () => {
    delete process.env.MC_GATEWAY_ADAPTERS
    process.env.OPENCLAW_GATEWAY_HOST = '127.0.0.1'
    process.env.OPENCLAW_GATEWAY_PORT = '18789'

    const adapters = getGatewayAdaptersFromEnv()
    expect(adapters).toHaveLength(1)
    expect(adapters[0].kind).toBe('openclaw')
    expect(adapters[0].wsUrl).toContain('127.0.0.1')
    expect(adapters[0].primary).toBe(true)
  })

  it('parses a JSON array from MC_GATEWAY_ADAPTERS', () => {
    process.env.MC_GATEWAY_ADAPTERS = JSON.stringify([
      { name: 'primary', kind: 'openclaw', wsUrl: 'ws://127.0.0.1:18789', healthUrl: 'http://127.0.0.1:18789/', primary: true },
      { name: 'zeroclaw', kind: 'stub', wsUrl: 'ws://127.0.0.1:19890' },
    ])

    const adapters = getGatewayAdaptersFromEnv()
    expect(adapters).toHaveLength(2)
    expect(adapters[0].name).toBe('primary')
    expect(adapters[0].kind).toBe('openclaw')
    expect(adapters[1].name).toBe('zeroclaw')
    expect(adapters[1].kind).toBe('stub')
  })

  it('falls back to default when MC_GATEWAY_ADAPTERS is invalid JSON', () => {
    process.env.MC_GATEWAY_ADAPTERS = 'not-json'
    const adapters = getGatewayAdaptersFromEnv()
    expect(adapters).toHaveLength(1)
    expect(adapters[0].kind).toBe('openclaw')
  })

  it('assigns primary to first adapter if none is marked', () => {
    process.env.MC_GATEWAY_ADAPTERS = JSON.stringify([
      { name: 'a', kind: 'openclaw', wsUrl: 'ws://127.0.0.1:18789' },
      { name: 'b', kind: 'stub', wsUrl: 'ws://127.0.0.1:19890' },
    ])
    const adapters = getGatewayAdaptersFromEnv()
    expect(adapters[0].primary).toBe(true)
    expect(adapters[1].primary).toBeFalsy()
  })

  it('skips entries with missing required fields', () => {
    process.env.MC_GATEWAY_ADAPTERS = JSON.stringify([
      { name: 'ok', kind: 'openclaw', wsUrl: 'ws://127.0.0.1:18789', primary: true },
      { kind: 'stub' }, // no name, no wsUrl - should be dropped
    ])
    const adapters = getGatewayAdaptersFromEnv()
    expect(adapters).toHaveLength(1)
    expect(adapters[0].name).toBe('ok')
  })
})

describe('getGatewayAdapterByName', () => {
  const ORIG = process.env

  beforeEach(() => {
    process.env = { ...ORIG }
  })

  afterEach(() => {
    process.env = ORIG
  })

  it('returns primary adapter when no name given', () => {
    process.env.MC_GATEWAY_ADAPTERS = JSON.stringify([
      { name: 'secondary', kind: 'stub', wsUrl: 'ws://127.0.0.1:19890' },
      { name: 'main', kind: 'openclaw', wsUrl: 'ws://127.0.0.1:18789', primary: true },
    ])
    const adapter = getGatewayAdapterByName()
    expect(adapter.name).toBe('main')
  })

  it('returns adapter by name', () => {
    process.env.MC_GATEWAY_ADAPTERS = JSON.stringify([
      { name: 'main', kind: 'openclaw', wsUrl: 'ws://127.0.0.1:18789', primary: true },
      { name: 'neobot', kind: 'custom', wsUrl: 'wss://neobot.example/ws' },
    ])
    const adapter = getGatewayAdapterByName('neobot')
    expect(adapter.name).toBe('neobot')
    expect(adapter.kind).toBe('custom')
  })

  it('falls back to primary if name not found', () => {
    process.env.MC_GATEWAY_ADAPTERS = JSON.stringify([
      { name: 'main', kind: 'openclaw', wsUrl: 'ws://127.0.0.1:18789', primary: true },
    ])
    const adapter = getGatewayAdapterByName('missing')
    expect(adapter.name).toBe('main')
  })
})
