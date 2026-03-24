/**
 * Shared path safety helpers for memory filesystem routes.
 * Extracted from /api/memory/route.ts so all memory routes use the same
 * path traversal protection and prefix allowlist enforcement.
 */

import { lstat, realpath } from 'fs/promises'
import { dirname, sep } from 'path'
import { config } from '@/lib/config'
import { resolveWithin } from '@/lib/paths'

export const MEMORY_PATH = config.memoryDir
export const MEMORY_ALLOWED_PREFIXES = (config.memoryAllowedPrefixes || []).map((p) => p.replace(/\\/g, '/'))

export function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

export function isPathAllowed(relativePath: string): boolean {
  if (!MEMORY_ALLOWED_PREFIXES.length) return true
  const normalized = normalizeRelativePath(relativePath)
  return MEMORY_ALLOWED_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))
}

function isWithinBase(base: string, candidate: string): boolean {
  if (candidate === base) return true
  return candidate.startsWith(base + sep)
}

export async function resolveSafeMemoryPath(baseDir: string, relativePath: string): Promise<string> {
  const baseReal = await realpath(baseDir)
  const fullPath = resolveWithin(baseDir, relativePath)

  // For non-existent targets, validate containment using the nearest existing ancestor.
  // This allows nested creates (mkdir -p) while still blocking symlink escapes.
  let current = dirname(fullPath)
  let parentReal = ''
  while (!parentReal) {
    try {
      parentReal = await realpath(current)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
      const next = dirname(current)
      if (next === current) {
        throw new Error('Parent directory not found')
      }
      current = next
    }
  }
  if (!isWithinBase(baseReal, parentReal)) {
    throw new Error('Path escapes base directory (symlink)')
  }

  // If the file exists, ensure it also resolves within base and is not a symlink.
  try {
    const st = await lstat(fullPath)
    if (st.isSymbolicLink()) {
      throw new Error('Symbolic links are not allowed')
    }
    const fileReal = await realpath(fullPath)
    if (!isWithinBase(baseReal, fileReal)) {
      throw new Error('Path escapes base directory (symlink)')
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw err
    }
  }

  return fullPath
}
