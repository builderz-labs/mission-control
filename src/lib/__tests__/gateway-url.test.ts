import { describe, expect, it } from 'vitest'
import { buildGatewayPathFallbackUrls, buildGatewayWebSocketUrl } from '@/lib/gateway-url'

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
