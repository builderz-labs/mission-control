import { describe, expect, it } from 'vitest'
import {
  __test_isNonBrowserReachableHost as isNonBrowserReachableHost,
  __test_deriveHolaluminaGatewayUrl as deriveHolaluminaGatewayUrl,
} from './route'

describe('isNonBrowserReachableHost', () => {
  it('flags localhost', () => {
    expect(isNonBrowserReachableHost('127.0.0.1')).toBe(true)
    expect(isNonBrowserReachableHost('localhost')).toBe(true)
    expect(isNonBrowserReachableHost('::1')).toBe(true)
  })

  it('flags docker special hostnames', () => {
    expect(isNonBrowserReachableHost('host.docker.internal')).toBe(true)
    expect(isNonBrowserReachableHost('host-gateway')).toBe(true)
  })

  it('flags docker bridge network IPs', () => {
    expect(isNonBrowserReachableHost('172.17.0.1')).toBe(true)
    expect(isNonBrowserReachableHost('172.20.5.42')).toBe(true)
    expect(isNonBrowserReachableHost('172.31.255.255')).toBe(true)
  })

  it('flags docker DNS gateway aliases', () => {
    // Per harden-tenants.sh + Caddyfile, each tenant gateway runs as
    // <prefix>-gateway on the openclaw docker network. Browser cannot
    // resolve these names — they must be rewritten before being sent
    // back as a ws_url.
    expect(isNonBrowserReachableHost('ceremonia-gateway')).toBe(true)
    expect(isNonBrowserReachableHost('lumina-gateway')).toBe(true)
    expect(isNonBrowserReachableHost('ericedmeades-gateway')).toBe(true)
    expect(isNonBrowserReachableHost('canary-a-gateway')).toBe(true)
  })

  it('does not flag browser-reachable hosts', () => {
    expect(isNonBrowserReachableHost('ceremonia.holalumina.com')).toBe(false)
    expect(isNonBrowserReachableHost('mc-ceremonia.holalumina.com')).toBe(false)
    expect(isNonBrowserReachableHost('app.holalumina.com')).toBe(false)
    expect(isNonBrowserReachableHost('203.0.113.42')).toBe(false)
  })

  it('does not flag bare "gateway" (no prefix)', () => {
    expect(isNonBrowserReachableHost('gateway')).toBe(false)
    expect(isNonBrowserReachableHost('-gateway')).toBe(false)
  })
})

describe('deriveHolaluminaGatewayUrl', () => {
  it('rewrites docker DNS gateway to public holalumina.com domain', () => {
    // Bug: WS handshake fail on mc-ceremonia.holalumina.com (2026-05-25).
    // Root cause: gateway.host=ceremonia-gateway (docker DNS) → browser
    // unresolvable. Fix: rewrite to wss://ceremonia.holalumina.com/, the
    // public domain Caddy already routes to ceremonia-gateway:18789.
    expect(deriveHolaluminaGatewayUrl('ceremonia-gateway', 'mc-ceremonia.holalumina.com'))
      .toBe('wss://ceremonia.holalumina.com/')
  })

  it('handles slug asymmetry — MC slug != gateway prefix', () => {
    // mc-eric satellite uses ericedmeades-gateway → ericedmeades.holalumina.com.
    // The public domain is ALWAYS derived from gateway.host, never from
    // the MC subdomain slug.
    expect(deriveHolaluminaGatewayUrl('ericedmeades-gateway', 'mc-eric.holalumina.com'))
      .toBe('wss://ericedmeades.holalumina.com/')
  })

  it('handles compound prefixes like canary-a-gateway', () => {
    expect(deriveHolaluminaGatewayUrl('canary-a-gateway', 'mc-canary-a.holalumina.com'))
      .toBe('wss://canary-a.holalumina.com/')
  })

  it('returns null when browser host is not on holalumina.com', () => {
    expect(deriveHolaluminaGatewayUrl('ceremonia-gateway', 'localhost')).toBe(null)
    expect(deriveHolaluminaGatewayUrl('ceremonia-gateway', 'example.com')).toBe(null)
    expect(deriveHolaluminaGatewayUrl('ceremonia-gateway', 'mc-ceremonia.vercel.app')).toBe(null)
  })

  it('returns null when gateway host is not docker DNS pattern', () => {
    expect(deriveHolaluminaGatewayUrl('127.0.0.1', 'mc-ceremonia.holalumina.com')).toBe(null)
    expect(deriveHolaluminaGatewayUrl('ceremonia.holalumina.com', 'mc-ceremonia.holalumina.com')).toBe(null)
    expect(deriveHolaluminaGatewayUrl('host.docker.internal', 'mc-ceremonia.holalumina.com')).toBe(null)
  })

  it('is case-insensitive on inputs but emits lowercase output', () => {
    expect(deriveHolaluminaGatewayUrl('Ceremonia-Gateway', 'MC-CEREMONIA.holalumina.com'))
      .toBe('wss://ceremonia.holalumina.com/')
  })
})
