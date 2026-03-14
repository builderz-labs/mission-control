import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('config', () => {
  it('config has expected top-level keys', async () => {
    const { config } = await import('../config')

    expect(config).toHaveProperty('claudeHome')
    expect(config).toHaveProperty('dataDir')
    expect(config).toHaveProperty('dbPath')
    expect(config).toHaveProperty('homeDir')
    expect(config).toHaveProperty('projects')
    expect(config).toHaveProperty('retention')
  })

  it('config.homeDir matches os.homedir()', async () => {
    const { config } = await import('../config')
    expect(config.homeDir).toBe(os.homedir())
  })

  it('config.retention has numeric values', async () => {
    const { config } = await import('../config')
    expect(typeof config.retention.activities).toBe('number')
    expect(typeof config.retention.auditLog).toBe('number')
    expect(typeof config.retention.logs).toBe('number')
    expect(config.retention.activities).toBeGreaterThan(0)
  })

  it('config.projects has expected project keys', async () => {
    const { config } = await import('../config')
    expect(config.projects).toHaveProperty('adforge')
    expect(config.projects).toHaveProperty('jobforge')
    expect(config.projects).toHaveProperty('maestro')
  })
})

describe('ensureDirExists', () => {
  const testDir = path.join(os.tmpdir(), `mc-test-${Date.now()}`)

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }) } catch {}
  })

  it('creates directory if it does not exist', async () => {
    const { ensureDirExists } = await import('../config')
    expect(fs.existsSync(testDir)).toBe(false)

    ensureDirExists(testDir)

    expect(fs.existsSync(testDir)).toBe(true)
  })

  it('no-ops for empty string', async () => {
    const { ensureDirExists } = await import('../config')
    // Should not throw
    ensureDirExists('')
  })

  it('no-ops if directory already exists', async () => {
    const { ensureDirExists } = await import('../config')
    fs.mkdirSync(testDir, { recursive: true })

    // Should not throw
    ensureDirExists(testDir)
    expect(fs.existsSync(testDir)).toBe(true)
  })
})
