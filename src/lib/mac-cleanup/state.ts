import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, ensureDirExists } from '@/lib/config'

interface WatchState {
  lastAutoAt: number | null
  lastId: string | null
  lastCode: string | null
}

const EMPTY: WatchState = { lastAutoAt: null, lastId: null, lastCode: null }

function statePath(): string {
  return join(config.dataDir, 'mac-cleanup-watch.json')
}

export function readWatchState(): WatchState {
  try {
    const raw = readFileSync(statePath(), 'utf8')
    const data = JSON.parse(raw) as Record<string, unknown>
    const lastAutoAt = typeof data.lastAutoAt === 'number' && Number.isFinite(data.lastAutoAt)
      ? data.lastAutoAt
      : null
    return {
      lastAutoAt,
      lastId: typeof data.lastId === 'string' ? data.lastId : null,
      lastCode: typeof data.lastCode === 'string' ? data.lastCode : null,
    }
  } catch {
    return { ...EMPTY }
  }
}

export function writeWatchState(update: WatchState): void {
  ensureDirExists(config.dataDir)
  writeFileSync(statePath(), `${JSON.stringify(update)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function watchStateExists(): boolean {
  return existsSync(statePath())
}
