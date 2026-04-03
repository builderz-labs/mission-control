import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: { openclawConfigPath: '' },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

describe('registerMcAsDashboard', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''
  let configPath = ''

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-gateway-runtime-'))
    configPath = path.join(tempDir, 'openclaw.json')
    process.env = { ...originalEnv }

    const { config } = await import('@/lib/config')
    config.openclawConfigPath = configPath
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('adds the Mission Control origin without disabling device auth', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: {
        controlUi: {
          allowedOrigins: ['https://existing.example.com'],
          dangerouslyDisableDeviceAuth: false,
        },
      },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('https://mc.example.com/dashboard')

    expect(result).toEqual({ registered: true, alreadySet: false })

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'https://existing.example.com',
      'https://mc.example.com',
    ])
    expect(updated.gateway.controlUi.dangerouslyDisableDeviceAuth).toBe(false)
  })

  it('does not rewrite config when the origin is already present', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: {
        controlUi: {
          allowedOrigins: ['https://mc.example.com'],
          dangerouslyDisableDeviceAuth: false,
        },
      },
    }, null, 2) + '\n', 'utf-8')

    const before = readFileSync(configPath, 'utf-8')
    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('https://mc.example.com/sessions')
    const after = readFileSync(configPath, 'utf-8')

    expect(result).toEqual({ registered: false, alreadySet: true })
    expect(after).toBe(before)
  })
})
