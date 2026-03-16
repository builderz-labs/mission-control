/**
 * Unit tests for utility functions extracted from gateway health route.
 * These functions handle SSRF protection and URL construction.
 */

import { describe, it, expect } from 'vitest'

// --- Copied/extracted utilities (pure functions) for testability ---

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let num = 0
  for (const p of parts) {
    const n = Number(p)
    if (!Number.isFinite(n) || n < 0 || n > 255) return null
    num = (num << 8) | n
  }
  return num >>> 0
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/')
  const mask = ~((1 << (32 - Number(bits))) - 1) >>> 0
  const ipNum = ipv4ToNum(ip)
  const baseNum = ipv4ToNum(base)
  if (ipNum === null || baseNum === null) return false
  return (ipNum & mask) === (baseNum & mask)
}

const BLOCKED_PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '127.0.0.0/8',
]

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
])

function isBlockedUrl(urlStr: string, userConfiguredHosts: Set<string>): boolean {
  try {
    const url = new URL(urlStr)
    const hostname = url.hostname

    if (userConfiguredHosts.has(hostname)) return false
    if (BLOCKED_HOSTNAMES.has(hostname)) return true

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      for (const cidr of BLOCKED_PRIVATE_CIDRS) {
        if (ipv4InCidr(hostname, cidr)) return true
      }
    }

    return false
  } catch {
    return true
  }
}

function buildGatewayProbeUrl(host: string, port: number): string | null {
  const rawHost = String(host || '').trim()
  if (!rawHost) return null

  const hasProtocol =
    rawHost.startsWith('ws://') ||
    rawHost.startsWith('wss://') ||
    rawHost.startsWith('http://') ||
    rawHost.startsWith('https://')

  if (hasProtocol) {
    try {
      const parsed = new URL(rawHost)
      if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
      if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
      if (!parsed.port && Number.isFinite(port) && port > 0) {
        parsed.port = String(port)
      }
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/api/health'
      return parsed.toString()
    } catch {
      return null
    }
  }

  if (!Number.isFinite(port) || port <= 0) return null
  return `http://${rawHost}:${port}/api/health`
}

function parseGatewayVersion(headers: Record<string, string | null>): string | null {
  const direct = headers['x-openclaw-version'] || headers['x-clawdbot-version']
  if (direct) return direct.trim()
  const server = headers['server'] || ''
  const m = server.match(/(\d{4}\.\d+\.\d+)/)
  return m?.[1] || null
}

function hasOpenClaw32ToolsProfileRisk(version: string | null): boolean {
  if (!version) return false
  const m = version.match(/^(\d{4})\.(\d+)\.(\d+)/)
  if (!m) return false
  const year = Number(m[1])
  const major = Number(m[2])
  const minor = Number(m[3])
  if (year > 2026) return true
  if (year < 2026) return false
  if (major > 3) return true
  if (major < 3) return false
  return minor >= 2
}

// --- Tests ---

describe('ipv4InCidr', () => {
  it('matches IP within 10.0.0.0/8', () => {
    expect(ipv4InCidr('10.0.0.1', '10.0.0.0/8')).toBe(true)
    expect(ipv4InCidr('10.255.255.255', '10.0.0.0/8')).toBe(true)
  })

  it('does not match IP outside 10.0.0.0/8', () => {
    expect(ipv4InCidr('11.0.0.1', '10.0.0.0/8')).toBe(false)
  })

  it('matches 192.168.x.x in 192.168.0.0/16', () => {
    expect(ipv4InCidr('192.168.1.1', '192.168.0.0/16')).toBe(true)
    expect(ipv4InCidr('192.169.0.0', '192.168.0.0/16')).toBe(false)
  })

  it('matches loopback 127.0.0.1 in 127.0.0.0/8', () => {
    expect(ipv4InCidr('127.0.0.1', '127.0.0.0/8')).toBe(true)
  })

  it('returns false for invalid IPs', () => {
    expect(ipv4InCidr('not-an-ip', '10.0.0.0/8')).toBe(false)
    expect(ipv4InCidr('256.0.0.1', '10.0.0.0/8')).toBe(false)
  })
})

describe('isBlockedUrl', () => {
  it('blocks private RFC1918 IPs', () => {
    expect(isBlockedUrl('http://192.168.1.100:3000/', new Set())).toBe(true)
    expect(isBlockedUrl('http://10.0.0.1/', new Set())).toBe(true)
    expect(isBlockedUrl('http://172.20.0.1/', new Set())).toBe(true)
  })

  it('blocks loopback', () => {
    expect(isBlockedUrl('http://127.0.0.1:8080/', new Set())).toBe(true)
  })

  it('blocks link-local', () => {
    expect(isBlockedUrl('http://169.254.169.254/', new Set())).toBe(true)
  })

  it('blocks cloud metadata hostnames', () => {
    expect(isBlockedUrl('http://metadata.google.internal/', new Set())).toBe(true)
    expect(isBlockedUrl('http://metadata.internal/', new Set())).toBe(true)
    expect(isBlockedUrl('http://instance-data/', new Set())).toBe(true)
  })

  it('allows user-configured hosts even if private', () => {
    // Operators explicitly configure their own infra
    expect(isBlockedUrl('http://192.168.1.100:3000/', new Set(['192.168.1.100']))).toBe(false)
    expect(isBlockedUrl('http://10.0.0.1/', new Set(['10.0.0.1']))).toBe(false)
  })

  it('allows public external hosts', () => {
    expect(isBlockedUrl('https://example.tailnet.ts.net:4443/', new Set())).toBe(false)
    expect(isBlockedUrl('https://gateway.example.com/', new Set())).toBe(false)
  })

  it('blocks malformed URLs', () => {
    expect(isBlockedUrl('not-a-url', new Set())).toBe(true)
    expect(isBlockedUrl('', new Set())).toBe(true)
  })
})

describe('buildGatewayProbeUrl', () => {
  it('builds URL from bare host + port', () => {
    expect(buildGatewayProbeUrl('example.com', 8080)).toBe('http://example.com:8080/api/health')
  })

  it('preserves https:// protocol', () => {
    const result = buildGatewayProbeUrl('https://gateway.example.com/', 0)
    expect(result).toContain('https://')
  })

  it('converts ws:// to http://', () => {
    const result = buildGatewayProbeUrl('ws://gateway.example.com:4443/', 0)
    expect(result).toContain('http://')
  })

  it('converts wss:// to https://', () => {
    const result = buildGatewayProbeUrl('wss://gateway.example.com:4443/', 0)
    expect(result).toContain('https://')
  })

  it('appends port to URL without port when port is provided', () => {
    const result = buildGatewayProbeUrl('https://gateway.example.com', 18789)
    expect(result).toContain('18789')
  })

  it('does not overwrite existing port in URL', () => {
    const result = buildGatewayProbeUrl('https://gateway.example.com:9000', 18789)
    expect(result).toContain('9000')
    expect(result).not.toContain('18789')
  })

  it('returns null for empty host', () => {
    expect(buildGatewayProbeUrl('', 8080)).toBeNull()
  })

  it('returns null for bare host with no port', () => {
    expect(buildGatewayProbeUrl('example.com', 0)).toBeNull()
    expect(buildGatewayProbeUrl('example.com', -1)).toBeNull()
  })

  it('handles URL with query string token', () => {
    const result = buildGatewayProbeUrl('https://gw.example.com/sessions?token=abc', 0)
    expect(result).toContain('token=abc')
  })
})

describe('parseGatewayVersion', () => {
  it('reads x-openclaw-version header', () => {
    expect(parseGatewayVersion({ 'x-openclaw-version': '2026.3.7', 'server': null, 'x-clawdbot-version': null })).toBe('2026.3.7')
  })

  it('reads x-clawdbot-version header', () => {
    expect(parseGatewayVersion({ 'x-openclaw-version': null, 'x-clawdbot-version': '2026.2.1', 'server': null })).toBe('2026.2.1')
  })

  it('extracts version from server header', () => {
    expect(parseGatewayVersion({ 'x-openclaw-version': null, 'x-clawdbot-version': null, 'server': 'openclaw/2026.3.5' })).toBe('2026.3.5')
  })

  it('returns null when no version headers', () => {
    expect(parseGatewayVersion({ 'x-openclaw-version': null, 'x-clawdbot-version': null, 'server': null })).toBeNull()
  })
})

describe('hasOpenClaw32ToolsProfileRisk', () => {
  it('returns false for null version', () => {
    expect(hasOpenClaw32ToolsProfileRisk(null)).toBe(false)
  })

  it('returns false for versions before 2026.3.2', () => {
    expect(hasOpenClaw32ToolsProfileRisk('2026.3.1')).toBe(false)
    expect(hasOpenClaw32ToolsProfileRisk('2026.2.9')).toBe(false)
    expect(hasOpenClaw32ToolsProfileRisk('2025.10.0')).toBe(false)
  })

  it('returns true for version 2026.3.2', () => {
    expect(hasOpenClaw32ToolsProfileRisk('2026.3.2')).toBe(true)
  })

  it('returns true for versions after 2026.3.2', () => {
    expect(hasOpenClaw32ToolsProfileRisk('2026.3.7')).toBe(true)
    expect(hasOpenClaw32ToolsProfileRisk('2026.4.0')).toBe(true)
    expect(hasOpenClaw32ToolsProfileRisk('2027.1.0')).toBe(true)
  })

  it('returns false for unrecognized version format', () => {
    expect(hasOpenClaw32ToolsProfileRisk('invalid')).toBe(false)
    expect(hasOpenClaw32ToolsProfileRisk('')).toBe(false)
  })
})
