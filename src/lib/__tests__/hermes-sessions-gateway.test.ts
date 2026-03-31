import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempHome = ''

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return tempHome
    },
    dataDir: '/tmp/test-data',
  },
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}))

describe('isHermesGatewayRunning', () => {
  beforeEach(() => {
    vi.resetModules()
    tempHome = mkdtempSync(join(tmpdir(), 'mc-hermes-test-'))
    mkdirSync(join(tempHome, '.hermes'), { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (tempHome) rmSync(tempHome, { recursive: true, force: true })
  })

  it('returns true when gateway.pid is JSON with a live pid field', async () => {
    writeFileSync(join(tempHome, '.hermes', 'gateway.pid'), '{"pid":2522,"kind":"hermes-gateway"}', 'utf8')

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => undefined) as any)
    const { isHermesGatewayRunning } = await import('@/lib/hermes-sessions')

    expect(isHermesGatewayRunning()).toBe(true)
    expect(killSpy).toHaveBeenCalledWith(2522, 0)
  })

  it('returns false when gateway.pid has no valid pid', async () => {
    writeFileSync(join(tempHome, '.hermes', 'gateway.pid'), '{"kind":"hermes-gateway"}', 'utf8')

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => undefined) as any)
    const { isHermesGatewayRunning } = await import('@/lib/hermes-sessions')

    expect(isHermesGatewayRunning()).toBe(false)
    expect(killSpy).not.toHaveBeenCalled()
  })
})
