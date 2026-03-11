import { describe, expect, it } from 'vitest'
import { buildGatewayWebSocketUrl } from '@/lib/gateway-url'

describe('buildGatewayWebSocketUrl', () => {
  it('builds ws URL with host and port for local dev', () => {
    expect(buildGatewayWebSocketUrl({
      host: '127.0.0.1',
      port: 18789,
      browserProtocol: 'http:',
    })).toBe('ws://127.0.0.1:18789')
  })

  it('omits 18789 for remote hosts on https browser context', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'cb-vcn.tail47c878.ts.net',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://cb-vcn.tail47c878.ts.net')
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

  it('drops path/query/hash when full dashboard URL is pasted', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'https://bill.tail8b4599.ts.net:4443/sessions?foo=bar#frag',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://bill.tail8b4599.ts.net:4443')
  })

  it('appends a configured websocket path when provided explicitly', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'cb.example.net',
      port: 18789,
      browserProtocol: 'https:',
      path: '/api/gateway/ws',
    })).toBe('wss://cb.example.net/api/gateway/ws')
  })

  it('uses the host path when no explicit path is provided', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'cb.example.net/api/gateway/ws',
      port: 18789,
      browserProtocol: 'https:',
    })).toBe('wss://cb.example.net/api/gateway/ws')
  })

  it('preserves a websocket path when a ws:// URL is supplied', () => {
    expect(buildGatewayWebSocketUrl({
      host: 'ws://gateway.example.com/api/gateway/ws?foo=bar',
      port: 18789,
      browserProtocol: 'http:',
    })).toBe('ws://gateway.example.com/api/gateway/ws')
  })
})
