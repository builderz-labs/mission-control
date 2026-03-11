import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'admin', workspace_id: 1 } })),
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
    rate_limiting: 'safe',
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
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-security-fix-'))
    process.chdir(tempDir)
    writeFileSync(path.join(tempDir, '.env'), 'MC_DISABLE_RATE_LIMIT=1\n', 'utf-8')
    writeFileSync(path.join(tempDir, '.env.local'), '', 'utf-8')
    process.env = { ...originalEnv }
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
})
