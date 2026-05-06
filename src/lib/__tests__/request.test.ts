import { describe, it, expect } from 'vitest'
import { extractClientIpFromTrusted } from '@/lib/request'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    headers: new Headers(headers),
  })
}

describe('extractClientIpFromTrusted', () => {
  const trusted = new Set(['10.0.0.1', '10.0.0.2'])

  it('returns rightmost untrusted IP from X-Forwarded-For', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.50, 10.0.0.1' })
    expect(extractClientIpFromTrusted(req, trusted)).toBe('203.0.113.50')
  })

  it('skips multiple trusted proxies at the end of the chain', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.50, 10.0.0.2, 10.0.0.1' })
    expect(extractClientIpFromTrusted(req, trusted)).toBe('203.0.113.50')
  })

  it('returns rightmost untrusted when attacker prepends a trusted IP', () => {
    // Attack: client injects trusted IP at the start to spoof identity
    const req = makeRequest({ 'x-forwarded-for': '10.0.0.1, 198.51.100.99, 10.0.0.2' })
    // Should return 198.51.100.99 (rightmost untrusted), NOT 10.0.0.1 (leftmost)
    expect(extractClientIpFromTrusted(req, trusted)).toBe('198.51.100.99')
  })

  it('falls back to x-real-ip when all XFF IPs are trusted', () => {
    const req = makeRequest({
      'x-forwarded-for': '10.0.0.1, 10.0.0.2',
      'x-real-ip': '192.168.1.100',
    })
    expect(extractClientIpFromTrusted(req, trusted)).toBe('192.168.1.100')
  })

  it('falls back to x-real-ip when no X-Forwarded-For header', () => {
    const req = makeRequest({ 'x-real-ip': '192.168.1.100' })
    expect(extractClientIpFromTrusted(req, trusted)).toBe('192.168.1.100')
  })

  it('returns fallback when no XFF and no x-real-ip', () => {
    const req = makeRequest({})
    expect(extractClientIpFromTrusted(req, trusted)).toBe('unknown')
  })

  it('returns custom fallback when provided', () => {
    const req = makeRequest({})
    expect(extractClientIpFromTrusted(req, trusted, '')).toBe('')
  })

  it('ignores XFF when trusted set is empty', () => {
    const req = makeRequest({
      'x-forwarded-for': '203.0.113.50, 10.0.0.1',
      'x-real-ip': '172.16.0.1',
    })
    expect(extractClientIpFromTrusted(req, new Set(), '')).toBe('172.16.0.1')
  })

  it('trims whitespace from XFF entries', () => {
    const req = makeRequest({ 'x-forwarded-for': ' 203.0.113.50 , 10.0.0.1 ' })
    expect(extractClientIpFromTrusted(req, trusted)).toBe('203.0.113.50')
  })

  it('handles single IP in XFF that is untrusted', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.50' })
    expect(extractClientIpFromTrusted(req, trusted)).toBe('203.0.113.50')
  })

  it('handles single IP in XFF that is trusted', () => {
    const req = makeRequest({ 'x-forwarded-for': '10.0.0.1' })
    expect(extractClientIpFromTrusted(req, trusted)).toBe('unknown')
  })
})
