import { realpathSync } from 'node:fs'
import path from 'node:path'

export function isInsideDir(candidate: string, root: string): boolean {
  if (!candidate || !root) return false
  const resolved = path.resolve(candidate)
  const base = path.resolve(root)
  return resolved === base || resolved.startsWith(`${base}${path.sep}`)
}

export function isSafeHomePath(candidate: string, homeDir: string): boolean {
  return isInsideDir(candidate, homeDir)
}

export function resolveWithin(root: string, ...segments: string[]): string | null {
  if (!root || segments.some((segment) => segment.includes('\0'))) return null
  const base = path.resolve(root)
  const candidate = path.resolve(base, ...segments)
  return isInsideDir(candidate, base) ? candidate : null
}

export function realpathInside(candidate: string, root: string): string | null {
  try {
    const resolved = realpathSync(candidate)
    const base = realpathSync(root)
    return isInsideDir(resolved, base) ? resolved : null
  } catch {
    return isInsideDir(candidate, root) ? path.resolve(candidate) : null
  }
}
