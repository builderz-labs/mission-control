import { runCommand } from './command'

/** Probe the data volume, not the macOS read-only system snapshot. */
export async function getDiskHealth(dataDirectory: string) {
  const { stdout } = await runCommand('df', ['-Pk', dataDirectory], { timeoutMs: 3000 })
  const parts = stdout.trim().split('\n').at(-1)?.trim().split(/\s+/) || []
  const percent = parts.find(part => /^\d+%$/.test(part))
  if (!percent) throw new Error('Disk capacity is unavailable')
  const usedPercent = Number(percent.slice(0, -1))
  const availableBytes = Number(parts[3]) * 1024
  if (!Number.isFinite(availableBytes) || availableBytes < 0 || usedPercent > 100) throw new Error('Invalid disk capacity')
  return { usedPercent, availableBytes }
}
