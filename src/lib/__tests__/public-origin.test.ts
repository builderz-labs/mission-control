import { afterEach, describe, expect, it } from 'vitest'
import {
  configuredPublicOrigin,
  isRequestSecureWithTrust,
  isTrustedForwardedRequest,
  publicOriginHostCandidates,
  resolvePublicOrigin,
} from '../public-origin'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('public origin and proxy trust', () => {
  it('uses the direct request origin by default', () => {
    delete process.env.MC_PUBLIC_URL
    delete process.env.MC_TRUSTED_PROXY_IPS
    const request = new Request('http://internal:3000/api/status')
    expect(resolvePublicOrigin(request).origin).toBe('http://internal:3000')
    expect(isRequestSecureWithTrust(request)).toBe(false)
  })

  it('uses an explicit public URL without trusting request headers', () => {
    process.env.MC_PUBLIC_URL = 'https://control.example.test/base/'
    const request = new Request('http://internal:3000', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.test' } })
    expect(configuredPublicOrigin()?.origin).toBe('https://control.example.test')
    expect(resolvePublicOrigin(request).origin).toBe('https://control.example.test')
    expect(publicOriginHostCandidates(request)).toContain('control.example.test')
  })

  it('does not treat the configured public URL as the observed host', () => {
    process.env.MC_PUBLIC_URL = 'https://mc.example.test'
    const request = new Request('https://evil.example.test/login')
    expect(publicOriginHostCandidates(request)).toEqual(['evil.example.test'])
  })

  it('accepts a direct request whose observed host matches the public URL', () => {
    process.env.MC_PUBLIC_URL = 'https://mc.example.test'
    const request = new Request('https://mc.example.test/login')
    expect(publicOriginHostCandidates(request)).toEqual(['mc.example.test'])
  })

  it('accepts standardized and X-Forwarded values only for a trusted nearest proxy', () => {
    process.env.MC_TRUSTED_PROXY_HEADERS = '1'
    process.env.MC_TRUSTED_PROXY_IPS = '10.0.0.2'
    const request = Object.assign(new Request('http://internal:3000', {
      headers: {
        'x-forwarded-for': '203.0.113.8, 10.0.0.2',
        forwarded: 'for=203.0.113.8;proto=https;host=control.example.test',
      },
    }), { ip: '10.0.0.2' })
    expect(isTrustedForwardedRequest(request)).toBe(true)
    expect(resolvePublicOrigin(request).origin).toBe('https://control.example.test')
  })

  it('rejects spoofed forwarded headers when the nearest hop is untrusted', () => {
    process.env.MC_TRUSTED_PROXY_IPS = '10.0.0.2'
    const request = new Request('http://internal:3000', {
      headers: {
        'x-forwarded-for': '10.0.0.2, 198.51.100.7',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example.test',
      },
    })
    expect(isTrustedForwardedRequest(request)).toBe(false)
    expect(resolvePublicOrigin(request).origin).toBe('http://internal:3000')
  })

  it('supports forwarded port for non-default public endpoints', () => {
    process.env.MC_TRUSTED_PROXY_HEADERS = '1'
    process.env.MC_TRUSTED_PROXY_IPS = '127.0.0.1'
    const request = Object.assign(new Request('http://127.0.0.1:3000', {
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'x-forwarded-host': 'control.example.test',
        'x-forwarded-proto': 'https',
        'x-forwarded-port': '8443',
      },
    }), { ip: '127.0.0.1' })
    expect(resolvePublicOrigin(request).origin).toBe('https://control.example.test:8443')
  })

  it('uses the nearest Forwarded element in a proxy chain', () => {
    process.env.MC_TRUSTED_PROXY_HEADERS = '1'
    process.env.MC_TRUSTED_PROXY_IPS = '10.0.0.2'
    const request = Object.assign(new Request('http://internal:3000', {
      headers: {
        'x-forwarded-for': '203.0.113.8, 10.0.0.2',
        forwarded: 'for=203.0.113.8;proto=http;host=spoof.example.test, for=10.0.0.2;proto=https;host=control.example.test',
      },
    }), { ip: '10.0.0.2' })
    expect(resolvePublicOrigin(request).origin).toBe('https://control.example.test')
  })

  it('preserves IPv6 origins', () => {
    process.env.MC_TRUSTED_PROXY_HEADERS = '1'
    process.env.MC_TRUSTED_PROXY_IPS = '::1'
    const request = Object.assign(new Request('http://[::1]:3000', {
      headers: {
        'x-forwarded-for': '::1',
        'x-forwarded-host': '[2001:db8::10]',
        'x-forwarded-proto': 'https',
      },
    }), { ip: '::1' })
    expect(resolvePublicOrigin(request).origin).toBe('https://[2001:db8::10]')
  })

  it('rejects a trusted IP forged only in X-Forwarded-For without peer info', () => {
    process.env.MC_TRUSTED_PROXY_HEADERS = '1'
    process.env.MC_TRUSTED_PROXY_IPS = '10.0.0.2'
    const request = new Request('http://internal:3000', {
      headers: { 'x-forwarded-for': '10.0.0.2', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' },
    })
    expect(isTrustedForwardedRequest(request)).toBe(false)
    expect(resolvePublicOrigin(request).origin).toBe('http://internal:3000')
  })

  it('accepts dynamic forwarded origin with the explicit proxy secret', () => {
    process.env.MC_TRUSTED_PROXY_HEADERS = '1'
    process.env.MC_PROXY_HEADER_SECRET = 'correct-secret'
    const request = new Request('http://internal:3000', {
      headers: { 'x-mission-control-proxy-secret': 'correct-secret', 'x-forwarded-host': 'control.test', 'x-forwarded-proto': 'https' },
    })
    expect(resolvePublicOrigin(request).origin).toBe('https://control.test')
    expect(publicOriginHostCandidates(request)).toContain('control.test')
  })

  it('rejects missing or incorrect proxy secrets', () => {
    process.env.MC_TRUSTED_PROXY_HEADERS = '1'
    process.env.MC_PROXY_HEADER_SECRET = 'correct-secret'
    for (const value of ['', 'wrong-secret']) {
      const request = new Request('http://internal:3000', {
        headers: { 'x-mission-control-proxy-secret': value, 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' },
      })
      expect(resolvePublicOrigin(request).origin).toBe('http://internal:3000')
    }
  })
})
