import os from 'node:os'
import { runCommand } from '@/lib/command'
import {
  parseDiskFreeGb,
  parseMemoryPressure,
  parsePackageActivity,
  parseSwapUsedPercent,
} from './parsers'
import type { LiveMetrics } from './types'

const PACKAGE_CACHE_MS = 15_000
let packageCache: { at: number; npmActive: boolean; pnpmActive: boolean } | null = null

async function bounded(command: string, args: string[], timeoutMs = 4000): Promise<string | null> {
  try {
    const result = await runCommand(command, args, { timeoutMs })
    return result.stdout
  } catch {
    return null
  }
}

export function cpuLoadPercent(now = os.loadavg(), cores = os.cpus().length || 1): number {
  const load = now[0] ?? 0
  if (!Number.isFinite(load) || cores <= 0) return 0
  return Math.min(100, Math.round((load / cores) * 100))
}

export async function collectLiveMetrics(options: { samplePackages: boolean }): Promise<LiveMetrics> {
  if (process.platform !== 'darwin') {
    return {
      cpuLoadPercent: cpuLoadPercent(),
      ramFreePercent: null,
      swapUsedPercent: null,
      diskFreeGb: null,
      npmActive: null,
      pnpmActive: null,
    }
  }

  const [pressure, disk, swap] = await Promise.all([
    bounded('memory_pressure', ['-Q']),
    bounded('df', ['-Pk', '/System/Volumes/Data']),
    bounded('sysctl', ['-n', 'vm.swapusage']),
  ])

  let npmActive: boolean | null = null
  let pnpmActive: boolean | null = null
  if (options.samplePackages) {
    const sampled = await samplePackageActivity()
    npmActive = sampled?.npmActive ?? null
    pnpmActive = sampled?.pnpmActive ?? null
  }

  return {
    cpuLoadPercent: cpuLoadPercent(),
    ramFreePercent: pressure ? parseMemoryPressure(pressure) : null,
    swapUsedPercent: swap ? parseSwapUsedPercent(swap) : null,
    diskFreeGb: disk ? parseDiskFreeGb(disk) : null,
    npmActive,
    pnpmActive,
  }
}

export async function samplePackageActivity(): Promise<{ npmActive: boolean; pnpmActive: boolean } | null> {
  const now = Date.now()
  if (packageCache && now - packageCache.at < PACKAGE_CACHE_MS) {
    return { npmActive: packageCache.npmActive, pnpmActive: packageCache.pnpmActive }
  }
  let stdout: string
  try {
    const result = await runCommand(
      'pgrep',
      ['-ifl', 'npm|npx|yarn|node-gyp|corepack|pnpm|pnpx'],
      { timeoutMs: 4000 },
    )
    stdout = result.stdout
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code !== 1) return null
    stdout = ''
  }
  const parsed = parsePackageActivity(stdout)
  packageCache = { at: now, ...parsed }
  return parsed
}

export function resetPackageActivityCache(): void {
  packageCache = null
}
