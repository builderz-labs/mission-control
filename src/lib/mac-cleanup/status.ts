import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '@/lib/command'
import { CATALOG, catalogBinary } from './catalog'
import { parseLaunchctlList, parseStorageLastRun } from './parsers'
import type { AutomationView, LaunchdState, StorageLastRun } from './types'

function readPrivateText(path: string, maxBytes = 4096): string | null {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    if (stat.nlink !== 1 || stat.size > maxBytes) return null
    if ((stat.mode & 0o077) !== 0) return null
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

function parseUnixSeconds(raw: string | null): number | null {
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function readLaunchdMap(): Promise<Map<string, LaunchdState>> {
  if (process.platform !== 'darwin') return new Map()
  try {
    const result = await runCommand('launchctl', ['list'], { timeoutMs: 4000 })
    return parseLaunchctlList(result.stdout)
  } catch {
    return new Map()
  }
}

export function readGuardianCycleAt(home = homedir()): number | null {
  return parseUnixSeconds(readPrivateText(join(home, '.local/state/mac-resource-guardian/last-cycle')))
}

export function readStorageLastRun(home = homedir()): StorageLastRun | null {
  const raw = readPrivateText(join(home, '.local/state/mac-storage-maintenance/last-run.json'))
  return raw ? parseStorageLastRun(raw) : null
}

export function countStaleLocks(home = homedir()): number {
  const dir = join(home, '.local/state/mac-resource-guardian')
  try {
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter((name) => name.startsWith('stale-lock.')).length
  } catch {
    return 0
  }
}

export function listAutomations(
  launchd: Map<string, LaunchdState>,
  home = homedir(),
): AutomationView[] {
  const guardianCycle = readGuardianCycleAt(home)
  const storageRun = readStorageLastRun(home)

  return CATALOG.map((entry) => {
    const job = launchd.get(entry.launchdLabel)
    const lastCycleAt = entry.id === 'resource-guardian' || entry.id === 'clean-ram'
      ? guardianCycle
      : entry.id === 'storage-maintenance' || entry.id === 'clean-mac'
        ? (storageRun?.timestamp ? Date.parse(storageRun.timestamp) / 1000 : null)
        : null
    const lastStatus = entry.id === 'storage-maintenance' || entry.id === 'clean-mac'
      ? storageRun?.code ?? null
      : lastCycleAt
        ? 'cycle'
        : null

    return {
      id: entry.id,
      label: entry.label,
      launchdLabel: entry.launchdLabel,
      binary: catalogBinary(entry, home),
      mutationClass: entry.mutationClass,
      resources: entry.resources,
      intervalSeconds: entry.intervalSeconds,
      triggerable: entry.triggerable,
      loaded: Boolean(job?.loaded),
      pid: job?.pid ?? null,
      lastExit: job?.lastExit ?? null,
      lastCycleAt,
      lastStatus,
      notes: entry.notes,
    }
  })
}
