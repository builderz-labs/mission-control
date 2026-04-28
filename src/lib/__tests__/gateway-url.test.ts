import { describe, expect, it } from 'vitest'
import { buildGatewayPathFallbackUrls, buildGatewayWebSocketUrl, resolveGatewayToken, resolveGatewayWebSocketUrl } from '@/lib/gateway-url'

describe('buildGatewayWebSocketUrl', () => {
  it('builds ws URL with host and port for local dev', () => {
    expect(buildGatewayWebSocketUrl({
      host: '127.0.0.1',
      port: 18789,
      browserProtocol: 'http:',
    })).toBe('ws://127.0.0.1:18789')
  })

  it('uses ws:// for localhost even when browser is HTTPS (no TLS on local gateway)', () => {
    expect(buildGatewayWebSocketUrl({
      host: '127.0.0.1',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('ws://127.0.0.1:18789')
  })

  it('uses ws:// for "localhost" hostname even when browser is HTTPS', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'localhost',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('ws://localhost:18789')
  })

  it('uses ws:// for empty host (defaults to 127.0.0.1)', () => {
    expect(buildGatewayWebSocketUrl({
      host: '',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('ws://127.0.0.1:18789')
  })

  it('uses ws:// for prefixed localhost URL even with https scheme', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'https://127.0.0.1:18789',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('ws://127.0.0.1:18789')
  })

  it('omits 18789 for remote hosts on https browser context', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'node-01.tailnet123.ts.net',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://node-01.tailnet123.ts.net')
  })

  it('keeps explicit websocket URL host value unchanged aside from protocol normalization', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'https://gateway.example.com',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://gateway.example.com')
  })

  it('preserves explicit URL port when provided in host', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'https://gateway.example.com:8443',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://gateway.example.com:8443')
  })

  it('preserves token query while dropping unrelated path/query/hash from pasted dashboard URL', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'https://node-02.tailnet456.ts.net:4443/sessions?foo=bar&token=abc123#frag',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://node-02.tailnet456.ts.net:4443?token=abc123')
  })

  it('preserves explicit proxy path when configured', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'https://gateway.example.com/gw',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://gateway.example.com/gw')
  })

  it('uses wss:// for remote Tailscale hosts on HTTPS', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'myhost.tailabcdef.ts.net',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://myhost.tailabcdef.ts.net')
  })

  it('uses ws:// for remote hosts on HTTP', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'gateway.example.com',
      port: 9090,
      browserProtocol: 'http:',
    })).toBe('ws://gateway.example.com:9090')
  })
})

describe('buildGatewayPathFallbackUrls', () => {
  it('suggests common proxy websocket paths for root URLs', () => {
    expect(buildGatewayPathFallbackUrls('wss://gateway.example.com')).toEqual([
      'wss://gateway.example.com/gateway-ws',
      'wss://gateway.example.com/gw',
    ])
  })

  it('keeps token query params when generating fallbacks', () => {
    expect(buildGatewayPathFallbackUrls('wss://gateway.example.com?token=abc')).toEqual([
      'wss://gateway.example.com/gateway-ws?token=abc',
      'wss://gateway.example.com/gw?token=abc',
    ])
  })

  it('returns no fallbacks when URL already has a non-root path', () => {
    expect(buildGatewayPathFallbackUrls('wss://gateway.example.com/gateway-ws')).toEqual([])
  })
})

describe('resolveGatewayWebSocketUrl', () => {
  it('uses localhost and the default gateway port for local http origins', () => {
    expect(resolveGatewayWebSocketUrl({
      locationProtocol: 'http:',
      locationHostname: 'localhost',
      env: {},
    })).toBe('ws://localhost:18789')
  })

  it('does not leak loopback env host when browser is on a non-loopback host', () => {
    expect(resolveGatewayWebSocketUrl({
      locationProtocol: 'http:',
      locationHostname: 'cobran.local',
      env: { NEXT_PUBLIC_GATEWAY_HOST: '127.0.0.1' },
    })).toBe('ws://cobran.local:18789')
  })

  it('uses wss and omits the direct gateway port by default for https remote origins', () => {
    expect(resolveGatewayWebSocketUrl({
      locationProtocol: 'https:',
      locationHostname: 'os.cobran.ai',
      env: {},
    })).toBe('wss://os.cobran.ai')
  })

  it('keeps an explicit non-default https gateway port', () => {
    expect(resolveGatewayWebSocketUrl({
      locationProtocol: 'https:',
      locationHostname: 'os.cobran.ai',
      env: { NEXT_PUBLIC_GATEWAY_PORT: '9443' },
    })).toBe('wss://os.cobran.ai:9443')
  })

  it('prefers an explicit gateway url', () => {
    expect(resolveGatewayWebSocketUrl({
      locationProtocol: 'https:',
      locationHostname: 'os.cobran.ai',
      env: { NEXT_PUBLIC_GATEWAY_URL: 'wss://gateway.example/ws' },
    })).toBe('wss://gateway.example/ws')
  })
})

describe('resolveGatewayToken', () => {
  it('prefers NEXT_PUBLIC_GATEWAY_TOKEN over legacy NEXT_PUBLIC_WS_TOKEN', () => {
    expect(resolveGatewayToken({
      NEXT_PUBLIC_GATEWAY_TOKEN: 'gateway-token',
      NEXT_PUBLIC_WS_TOKEN: 'legacy-token',
    })).toBe('gateway-token')
  })

  it('falls back to NEXT_PUBLIC_WS_TOKEN', () => {
    expect(resolveGatewayToken({ NEXT_PUBLIC_WS_TOKEN: 'legacy-token' })).toBe('legacy-token')
  })
})
