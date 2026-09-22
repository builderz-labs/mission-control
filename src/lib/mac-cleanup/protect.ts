import { homedir } from 'node:os'
import { sep } from 'node:path'

export function normalizePath(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  return trimmed.length > 1 ? trimmed : input.trim() || trimmed
}

export function alwaysProtectedRoots(home = homedir()): string[] {
  return [
    `${home}/Work`,
    `${home}/Dev/mission-control`,
    `${home}/.claude`,
    `${home}/.codex`,
    `${home}/.openclaw`,
    `${home}/.grok`,
    `${home}/.agents`,
    `${home}/.ssh`,
    `${home}/.local/state/ai-agent-leases`,
  ].map(normalizePath)
}

/** Map a cwd under ~/Dev/<project>/... to the project root. `_idle` is not a project root. */
export function devProjectRoot(cwd: string, home = homedir()): string | null {
  const resolved = normalizePath(cwd)
  const prefix = `${normalizePath(home)}/Dev/`
  if (!resolved.startsWith(prefix)) return null
  const parts = resolved.slice(prefix.length).split(sep).filter(Boolean)
  const name = parts[0]
  if (!name || name.startsWith('.')) return null
  if (name === '_idle') {
    const idleProject = parts[1]
    return idleProject ? `${prefix}_idle/${idleProject}` : `${prefix}_idle`
  }
  return `${prefix}${name}`
}

export function isProtectedPath(target: string, protectedRoots: string[]): boolean {
  const resolved = normalizePath(target)
  for (const root of protectedRoots) {
    const base = normalizePath(root)
    if (!base) continue
    if (resolved === base || resolved.startsWith(`${base}/`)) return true
    if (base.startsWith(`${resolved}/`)) return true
  }
  return false
}

export function parseLsofCwds(stdout: string): string[] {
  return [...parseLsofCwdMap(stdout).values()]
}

export function parseLsofCwdMap(stdout: string): Map<number, string> {
  const map = new Map<number, string>()
  let pid = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      const next = Number.parseInt(line.slice(1), 10)
      pid = Number.isFinite(next) ? next : 0
      continue
    }
    if (line.startsWith('n/') && pid > 0) map.set(pid, line.slice(1).trim())
  }
  return map
}

export function parseLeaseProjectRoots(raw: string): string[] {
  const roots: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.startsWith('project_root=')) continue
    const value = line.slice('project_root='.length).trim()
    if (value.startsWith('/')) roots.push(value)
  }
  return roots
}

export function extractDevPathsFromCommand(command: string, home = homedir()): string[] {
  const prefix = `${normalizePath(home)}/Dev/`
  const matches = command.match(new RegExp(`${escapeRegExp(prefix)}[^\\s'"]+`, 'g'))
  return matches ?? []
}

export function uniqueRoots(paths: string[], home = homedir()): string[] {
  const tooBroad = new Set([
    '/',
    normalizePath(home),
    `${normalizePath(home)}/Library`,
    `${normalizePath(home)}/.cache`,
    `${normalizePath(home)}/Dev`,
  ])
  return [...new Set(paths.map(normalizePath).filter((path) => path && !tooBroad.has(path)))].sort()
}

export function isSafeDeleteTarget(
  target: string,
  allowedPrefix: string,
  protectedRoots: string[],
  uid: number,
  stat: { isSymbolicLink(): boolean; uid: number },
): boolean {
  if (stat.isSymbolicLink()) return false
  if (uid >= 0 && stat.uid !== uid) return false
  if (isProtectedPath(target, protectedRoots)) return false
  const resolved = normalizePath(target)
  const prefix = normalizePath(allowedPrefix)
  return resolved === prefix || resolved.startsWith(`${prefix}/`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
