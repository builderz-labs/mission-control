/**
 * .env file store — parse, serialize, read, write, and per-variable helpers.
 * Preserves comments, blank lines, and insertion order in the file.
 */
import { config } from '@/lib/config'
import { toError } from '@/lib/types/sql'
import { join } from 'path'
import { readFile, writeFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import type { EnvLine } from './types'
import { BLOCKED_VARS, BLOCKED_PREFIXES } from './types'

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

export function parseEnv(content: string): EnvLine[] {
  const lines: EnvLine[] = []
  for (const raw of content.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      lines.push({ type: 'blank', raw })
    } else if (trimmed.startsWith('#')) {
      lines.push({ type: 'comment', raw })
    } else {
      const eqIdx = raw.indexOf('=')
      if (eqIdx > 0) {
        const key = raw.slice(0, eqIdx).trim()
        const value = raw.slice(eqIdx + 1).trim()
        lines.push({ type: 'var', raw, key, value })
      } else {
        // Malformed line preserved as-is rather than silently dropped
        lines.push({ type: 'comment', raw })
      }
    }
  }
  return lines
}

export function serializeEnv(lines: EnvLine[]): string {
  return lines.map(l => (l.type === 'var' ? `${l.key}=${l.value}` : l.raw)).join('\n')
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export function getEnvPath(): string | null {
  if (!config.openclawStateDir) return null
  return join(config.openclawStateDir, '.env')
}

export async function readEnvFile(): Promise<{ lines: EnvLine[]; raw: string } | null> {
  const envPath = getEnvPath()
  if (!envPath) return null
  try {
    const raw = await readFile(envPath, 'utf-8')
    return { lines: parseEnv(raw), raw }
  } catch (err: unknown) {
    if ((toError(err) as NodeJS.ErrnoException).code === 'ENOENT') {
      return { lines: [], raw: '' }
    }
    throw err
  }
}

/** Atomic write: write to a temp file first, then rename into place. */
export async function writeEnvFile(lines: EnvLine[]): Promise<void> {
  const envPath = getEnvPath()!
  const tmpPath = `${envPath}.tmp`
  const content = serializeEnv(lines)
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, envPath)
}

// ---------------------------------------------------------------------------
// Per-variable helpers
// ---------------------------------------------------------------------------

export function redactValue(value: string): string {
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

export function isVarBlocked(key: string): boolean {
  if (BLOCKED_VARS.has(key)) return true
  return BLOCKED_PREFIXES.some(p => key.startsWith(p))
}

/** Prefer the value from the .env file; fall back to the process environment. */
export function getEffectiveEnvValue(envMap: Map<string, string>, key: string): string {
  const fromFile = envMap.get(key)
  if (typeof fromFile === 'string' && fromFile.length > 0) return fromFile
  const fromProcess = process.env[key]
  if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess
  return ''
}

export function isPathLikeEnvVar(key: string): boolean {
  return key.endsWith('_PATH') || key.endsWith('_FILE')
}

/** A variable is "configured" when it has a value and, for path-like vars, the path exists. */
export function isConfiguredValue(key: string, value: string): boolean {
  if (!value || value.length === 0) return false
  if (isPathLikeEnvVar(key)) {
    try {
      return existsSync(value)
    } catch {
      return false
    }
  }
  return true
}
