import { runCommand } from './command'

type ProcessInfo = {
  pid: string
  command: string
}

const PROCESS_PATTERNS = ['openclaw', 'clawdbot']

export function parsePgrepOutput(stdout: string): ProcessInfo[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(' ')
      if (firstSpace <= 0) return null
      const pid = line.slice(0, firstSpace).trim()
      const command = line.slice(firstSpace + 1).trim()
      if (!pid || !command) return null
      return { pid, command }
    })
    .filter((item): item is ProcessInfo => Boolean(item))
}

export async function listOpenClawProcesses(): Promise<ProcessInfo[]> {
  const deduped = new Map<string, ProcessInfo>()

  for (const pattern of PROCESS_PATTERNS) {
    try {
      const { stdout } = await runCommand('pgrep', ['-fal', pattern], { timeoutMs: 1500 })
      for (const proc of parsePgrepOutput(stdout)) {
        deduped.set(proc.pid, proc)
      }
    } catch {
      // Ignore no-match and transient probe failures; this is best-effort status data.
    }
  }

  return [...deduped.values()]
}
