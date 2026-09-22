import type { LaunchdState, StorageLastRun } from './types'

export function parseLaunchctlList(stdout: string): Map<string, LaunchdState> {
  const map = new Map<string, LaunchdState>()
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const pidRaw = parts[0]
    const exitRaw = parts[1]
    const label = parts.slice(2).join(' ')
    if (!label.startsWith('com.')) continue
    const pid = pidRaw === '-' ? null : Number.parseInt(pidRaw, 10)
    const lastExit = Number.parseInt(exitRaw, 10)
    map.set(label, {
      loaded: true,
      pid: Number.isFinite(pid) ? pid : null,
      lastExit: Number.isFinite(lastExit) ? lastExit : null,
    })
  }
  return map
}

export function parseMemoryPressure(stdout: string): number | null {
  const match = stdout.match(/System-wide memory free percentage:\s*(\d+)/i)
  if (!match) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

export function parseDiskFreeGb(stdout: string): number | null {
  const line = stdout.trim().split('\n').find((row, index) => index > 0 && row.includes('/'))
  if (!line) return null
  const parts = line.trim().split(/\s+/)
  const availableKb = Number.parseInt(parts[3] ?? '', 10)
  if (!Number.isFinite(availableKb) || availableKb < 0) return null
  return Math.floor(availableKb / 1_048_576)
}

export function parseSwapUsedPercent(stdout: string): number | null {
  const totalMatch = stdout.match(/total\s*=\s*([\d.]+)M/i)
  const usedMatch = stdout.match(/used\s*=\s*([\d.]+)M/i)
  if (!totalMatch || !usedMatch) return null
  const total = Number.parseFloat(totalMatch[1])
  const used = Number.parseFloat(usedMatch[1])
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used) || used < 0) return null
  return Math.min(100, Math.round((used / total) * 100))
}

export function parseStorageLastRun(raw: string): StorageLastRun | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const code = typeof data.code === 'string' ? data.code : null
    const timestamp = typeof data.timestamp === 'string' ? data.timestamp : null
    return {
      timestamp,
      code,
      diskFreeBeforeGb: asInt(data.disk_free_before_gb),
      diskFreeAfterGb: asInt(data.disk_free_after_gb),
      attemptedTools: asInt(data.attempted_tools) ?? 0,
      deferredTools: asInt(data.deferred_tools) ?? 0,
      failedTools: asInt(data.failed_tools) ?? 0,
    }
  } catch {
    return null
  }
}

export function parsePackageActivity(stdout: string): { npmActive: boolean; pnpmActive: boolean } {
  const lines = stdout.toLowerCase()
  const npmActive = /(^|[\s/])(npm|npx|yarn|node-gyp|corepack)([\s/]|$)/.test(lines)
    || lines.includes('/.npm/_npx/')
  const pnpmActive = /(^|[\s/])(pnpm|pnpx|node-gyp|corepack)([\s/]|$)/.test(lines)
  return { npmActive, pnpmActive }
}

function asInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.trunc(value)
}
