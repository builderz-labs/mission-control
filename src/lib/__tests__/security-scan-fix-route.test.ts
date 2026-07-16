import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { requireRoleMock, securityFixLimiterMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  securityFixLimiterMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  securityFixLimiter: securityFixLimiterMock,
}))

vi.mock('@/lib/config', () => ({
  config: { openclawConfigPath: '' },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/security-scan', () => ({
  FIX_SAFETY: {
    gateway_bind: 'safe',
    rate_limiting: 'safe',
    world_writable: 'safe',
  },
  runSecurityScan: vi.fn(() => ({
    categories: {
      runtime: {
        checks: [
          {
            id: 'rate_limiting',
            status: 'fail',
          },
        ],
      },
    },
  })),
}))

describe('security-scan fix route env mutation', () => {
  const originalCwd = process.cwd()
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({ user: { id: 7, username: 'admin', role: 'admin', workspace_id: 3 } })
    securityFixLimiterMock.mockReturnValue(null)
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-security-fix-'))
    process.chdir(tempDir)
    writeFileSync(path.join(tempDir, '.env'), 'MC_DISABLE_RATE_LIMIT=1\n', 'utf-8')
    writeFileSync(path.join(tempDir, '.env.local'), '', 'utf-8')
    process.env = { ...originalEnv }
  })

  function request(body: string) {
    return new NextRequest('http://localhost/api/security-scan/fix', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('authenticates before rate limiting or parsing mutation input', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { POST } = await import('@/app/api/security-scan/fix/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(401)
    expect(securityFixLimiterMock).not.toHaveBeenCalled()
    expect(readFileSync(path.join(tempDir, '.env'), 'utf-8')).toContain('MC_DISABLE_RATE_LIMIT=1')
  })

  it('rate limits by workspace and admin before parsing or mutation', async () => {
    securityFixLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many security fix attempts' }, { status: 429 }),
    )
    const { POST } = await import('@/app/api/security-scan/fix/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(429)
    expect(securityFixLimiterMock).toHaveBeenCalledWith('3:7')
    expect(readFileSync(path.join(tempDir, '.env'), 'utf-8')).toContain('MC_DISABLE_RATE_LIMIT=1')
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['empty ids', JSON.stringify({ ids: [] })],
    ['unknown ids', JSON.stringify({ ids: ['not-a-fix'] })],
    ['extra fields', JSON.stringify({ unexpected: true })],
    ['oversized ids', JSON.stringify({ ids: Array.from({ length: 51 }, () => 'rate_limiting') })],
  ])('rejects %s without applying broad fixes', async (_label, body) => {
    const { POST } = await import('@/app/api/security-scan/fix/route')

    const response = await POST(request(body))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid security fix request' })
    expect(readFileSync(path.join(tempDir, '.env'), 'utf-8')).toContain('MC_DISABLE_RATE_LIMIT=1')
  })

  afterEach(() => {
    process.chdir(originalCwd)
    process.env = { ...originalEnv }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('preserves runtime env overrides in test mode while updating env files', async () => {
    process.env.MISSION_CONTROL_TEST_MODE = '1'
    process.env.MC_DISABLE_RATE_LIMIT = '1'

    const { POST } = await import('@/app/api/security-scan/fix/route')
    const request = new NextRequest('http://localhost/api/security-scan/fix', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(process.env.MC_DISABLE_RATE_LIMIT).toBe('1')
    expect(readFileSync(path.join(tempDir, '.env'), 'utf-8')).not.toContain('MC_DISABLE_RATE_LIMIT=')
  })

  it('mutates runtime env outside test mode so fixes apply immediately', async () => {
    delete process.env.MISSION_CONTROL_TEST_MODE
    process.env.MC_DISABLE_RATE_LIMIT = '1'

    const { POST } = await import('@/app/api/security-scan/fix/route')
    const request = new NextRequest('http://localhost/api/security-scan/fix', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(process.env.MC_DISABLE_RATE_LIMIT).toBeUndefined()
  })

  it('removes only the world-write bit without granting execute permissions', async () => {
    const filePath = path.join(tempDir, 'world-writable.txt')
    writeFileSync(filePath, 'data', 'utf-8')
    chmodSync(filePath, 0o666)

    const { POST } = await import('@/app/api/security-scan/fix/route')
    const response = await POST(request(JSON.stringify({ ids: ['world_writable'] })))

    expect(response.status).toBe(200)
    expect(statSync(filePath).mode & 0o777).toBe(0o664)
  })

  it('reports a busy OpenClaw config without overwriting it', async () => {
    const configPath = path.join(tempDir, 'openclaw.json')
    const original = '{"gateway":{"bind":"lan"}}\n'
    writeFileSync(configPath, original, 'utf8')
    mkdirSync(`${configPath}.mc-lock`, { mode: 0o700 })
    writeFileSync(`${configPath}.mc-lock/owner`, `${process.pid}\n`, { flag: 'wx', mode: 0o600 })
    const { config } = await import('@/lib/config')
    config.openclawConfigPath = configPath

    const { POST } = await import('@/app/api/security-scan/fix/route')
    const response = await POST(request(JSON.stringify({ ids: ['gateway_bind'] })))

    expect(response.status).toBe(200)
    expect(readFileSync(configPath, 'utf8')).toBe(original)
    await expect(response.json()).resolves.toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({ id: 'config_write', fixed: false }),
      ]),
    })
  })
})
