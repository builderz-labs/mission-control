import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testHomes: string[] = []
const originalArkHome = process.env.MISSION_CONTROL_ARK_HOME

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'mc-god-mode-'))
  testHomes.push(home)
  return home
}

async function importGodModeWithHome(home: string) {
  process.env.MISSION_CONTROL_ARK_HOME = home
  vi.resetModules()
  return import('@/lib/god-mode')
}

function writeLoopStatus(home: string, body: Record<string, unknown>, ageMinutes: number) {
  const root = join(home, '.ark', 'godmode')
  mkdirSync(root, { recursive: true })
  const file = join(root, 'loop_status.json')
  writeFileSync(file, `${JSON.stringify(body)}\n`)
  const mtime = new Date(Date.now() - ageMinutes * 60_000)
  utimesSync(file, mtime, mtime)
}

afterEach(() => {
  if (originalArkHome === undefined) {
    delete process.env.MISSION_CONTROL_ARK_HOME
  } else {
    process.env.MISSION_CONTROL_ARK_HOME = originalArkHome
  }
  vi.resetModules()
  while (testHomes.length) {
    rmSync(testHomes.pop()!, { recursive: true, force: true })
  }
})

describe('getGodModeStatus', () => {
  it('normalizes stale loop_status metadata to stopped at every level', async () => {
    const home = makeHome()
    writeLoopStatus(home, {
      loop_running: true,
      loop_status: 'running',
      current_wave: 'stale-wave',
    }, 31)

    const { getGodModeStatus } = await importGodModeWithHome(home)
    const status = getGodModeStatus()

    expect(status.loop_running).toBe(false)
    expect(status.loop_status).toBe('stopped')
    expect(status.status_file_stale).toBe(true)
    expect(status.status_file_age_minutes).toBeGreaterThanOrEqual(30)
    expect(status.current_wave).toBe('stale-wave')
    expect(status.rich_loop_status.loop_running).toBe(false)
    expect(status.rich_loop_status.loop_status).toBe('stopped')
    expect(status.rich_loop_status.status_file_stale).toBe(true)
  })

  it('keeps fresh loop_status metadata running and non-stale', async () => {
    const home = makeHome()
    writeLoopStatus(home, {
      loop_running: true,
      loop_status: 'running',
      current_wave: 'fresh-wave',
    }, 2)

    const { getGodModeStatus } = await importGodModeWithHome(home)
    const status = getGodModeStatus()

    expect(status.loop_running).toBe(true)
    expect(status.loop_status).toBe('running')
    expect(status.status_file_stale).toBe(false)
    expect(status.status_file_age_minutes).toBeLessThan(30)
    expect(status.current_wave).toBe('fresh-wave')
    expect(status.rich_loop_status.loop_running).toBe(true)
    expect(status.rich_loop_status.loop_status).toBe('running')
    expect(status.rich_loop_status.status_file_stale).toBe(false)
  })
})
