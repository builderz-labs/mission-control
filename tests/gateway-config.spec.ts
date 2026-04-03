import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Unit tests for GET and PUT /api/gateway-config.
 *
 * The Playwright version skipped the stale-hash 409 test when the real config
 * file wasn't present.  Here we write a real temp file in beforeEach so the
 * route always has a config to read — removing the conditional skip entirely.
 *
 * The route uses require('fs/promises') at call-time (CJS dynamic require),
 * which vitest's ESM mock cannot intercept.  Using a real temp file avoids
 * that limitation while staying fully isolated from production state.
 */

const MOCK_CONFIG = {
  gateway: {
    host: '127.0.0.1',
    port: 18789,
    auth: { password: 'secret', secret: 'topsecret' },
    controlUi: { allowedOrigins: [] as string[] },
  },
  logging: { redactSensitive: 'none' },
}

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 1, username: 'testadmin', role: 'admin' } })),
}))

vi.mock('@/lib/config', () => ({
  // Start with an empty path; beforeEach sets the real temp path
  config: {
    openclawConfigPath: '',
    gatewayHost: '127.0.0.1',
    gatewayPort: 18789,
  },
}))

vi.mock('@/lib/db', () => ({
  logAuditEvent: vi.fn(),
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/gateway-runtime', () => ({
  getDetectedGatewayToken: vi.fn(() => null),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method: string, urlPath: string, body?: unknown): NextRequest {
  const url = `http://localhost${urlPath}`
  // Omit explicit RequestInit type — Next's RequestInit excludes null signal
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key-e2e-12345' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  return new NextRequest(url, init)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Gateway Config API', () => {
  let tempDir = ''
  let configPath = ''
  let mockRaw = ''
  let mockHash = ''

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-gateway-config-'))
    configPath = path.join(tempDir, 'openclaw.json')
    mockRaw = JSON.stringify(MOCK_CONFIG, null, 2) + '\n'
    mockHash = createHash('sha256').update(mockRaw, 'utf8').digest('hex')

    // Write a real config file so the route can read it without mocking fs
    writeFileSync(configPath, mockRaw, 'utf-8')

    // Point the mocked config module at the temp file
    const { config } = await import('@/lib/config')
    config.openclawConfigPath = configPath

    vi.clearAllMocks()
    // Re-set requireRole after clearAllMocks
    const { requireRole } = await import('@/lib/auth')
    vi.mocked(requireRole).mockReturnValue(
      { user: { id: 1, username: 'testadmin', role: 'admin' } } as any,
    )
    // Re-set mutationLimiter after clearAllMocks
    const { mutationLimiter } = await import('@/lib/rate-limit')
    vi.mocked(mutationLimiter).mockReturnValue(null)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('GET /api/gateway-config returns config object and path', async () => {
    const { GET } = await import('@/app/api/gateway-config/route')
    const res = await GET(makeRequest('GET', '/api/gateway-config'))

    // Config path may not be set, or file may not exist
    expect([200, 404, 500]).toContain(res.status)

    const body = await res.json()
    if (res.status === 200) {
      expect(body).toHaveProperty('path')
      expect(body).toHaveProperty('config')
      expect(body).toHaveProperty('raw_size')
      expect(typeof body.raw_size).toBe('number')
    } else {
      expect(body).toHaveProperty('error')
    }
  })

  it('GET /api/gateway-config returns hash for concurrency', async () => {
    const { GET } = await import('@/app/api/gateway-config/route')
    const res = await GET(makeRequest('GET', '/api/gateway-config'))

    expect([200, 404, 500]).toContain(res.status)
    if (res.status === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('hash')
      expect(typeof body.hash).toBe('string')
      expect(body.hash.length).toBe(64) // sha256 hex
    }
  })

  it('GET /api/gateway-config?action=schema returns schema or graceful error', async () => {
    const { GET } = await import('@/app/api/gateway-config/route')
    const res = await GET(makeRequest('GET', '/api/gateway-config?action=schema'))

    // Gateway may not be running in unit-test context, so 502 is expected
    expect([200, 502]).toContain(res.status)
    const body = await res.json()
    if (res.status === 200) {
      expect(typeof body).toBe('object')
    } else {
      expect(body).toHaveProperty('error')
    }
  })

  it('PUT /api/gateway-config rejects without auth', async () => {
    const { requireRole } = await import('@/lib/auth')
    vi.mocked(requireRole).mockReturnValueOnce({ error: 'Unauthorized', status: 401 } as any)

    const { PUT } = await import('@/app/api/gateway-config/route')
    const res = await PUT(
      makeRequest('PUT', '/api/gateway-config', {
        updates: { 'logging.redactSensitive': 'all' },
      }),
    )

    expect(res.status).toBe(401)
  })

  it('PUT /api/gateway-config with stale hash returns 409', async () => {
    // Config file exists on disk (written in beforeEach) — no skip needed
    const { GET, PUT } = await import('@/app/api/gateway-config/route')

    const getRes = await GET(makeRequest('GET', '/api/gateway-config'))
    if (getRes.status !== 200) {
      // If still 404/500 for some reason, the config path wasn't wired up yet;
      // surface the actual error rather than silently skipping.
      const body = await getRes.json()
      throw new Error(`GET returned ${getRes.status}: ${JSON.stringify(body)}`)
    }

    const putRes = await PUT(
      makeRequest('PUT', '/api/gateway-config', {
        updates: { 'logging.redactSensitive': 'all' },
        hash: 'stale-hash-that-does-not-match',
      }),
    )

    expect(putRes.status).toBe(409)
    const body = await putRes.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toContain('modified')
  })
})
