// ---------------------------------------------------------------------------
// Low-level exec helpers used by all scanner modules
// All exec calls use only hardcoded string literals — no user input.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process'

export function tryExec(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

const execCache = new Map<string, { value: string | null; ts: number }>()

export function cachedExec(key: string, cmd: string, ttlMs = 60000): string | null {
  const cached = execCache.get(key)
  if (cached && Date.now() - cached.ts < ttlMs) return cached.value
  const value = tryExec(cmd)
  execCache.set(key, { value, ts: Date.now() })
  return value
}

/**
 * Runs a multi-line script that outputs KEY=VALUE pairs.
 * Returns a map of key -> value. Used to batch multiple sysctl reads
 * so one exec replaces several sequential calls.
 */
export function tryExecBatch(script: string): Record<string, string> {
  const out = tryExec(script)
  if (!out) return {}
  const result: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return result
}
