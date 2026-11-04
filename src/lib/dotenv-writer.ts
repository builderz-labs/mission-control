/**
 * Helpers for writing KEY=value lines into dotenv-style files.
 *
 * A value is a single line. CR, LF, or NUL in a value would end the
 * assignment early and let the caller inject extra KEY=value lines, so
 * every writer must reject them.
 */

import { randomBytes } from 'node:crypto'
import { closeSync, fchmodSync, fsyncSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const FORBIDDEN_ENV_VALUE_CHARS = /[\r\n\0]/

export const UNSAFE_ENV_VALUE_MESSAGE = 'value must not contain line breaks or NUL characters'

export function isSafeEnvValue(value: string): boolean {
  return !FORBIDDEN_ENV_VALUE_CHARS.test(value)
}

export class UnsafeEnvValueError extends Error {
  constructor(readonly key: string) {
    super(`Refusing to write ${key}: ${UNSAFE_ENV_VALUE_MESSAGE}`)
    this.name = 'UnsafeEnvValueError'
  }
}

export function assertSafeEnvValue(key: string, value: string): void {
  if (!isSafeEnvValue(value)) throw new UnsafeEnvValueError(key)
}

// Python's str.isspace() also treats these as whitespace, and Hermes strips
// them when it reads an unquoted value; JS \s does not match them.
const PYTHON_ONLY_WHITESPACE = /[\x1c-\x1f\x85]/

/**
 * Quote a value the way Hermes' own writer does (hermes_cli/config.py
 * `_quote_env_value`), so the value Hermes reads back is the value we wrote.
 */
export function quoteHermesEnvValue(value: string): string {
  if (value === '') return value
  const needsQuoting =
    value.includes('#')
    || value.includes('"')
    || value.includes("'")
    || value !== value.trim()
    || /\s/.test(value)
    || PYTHON_ONLY_WHITESPACE.test(value)
  if (!needsQuoting) return value
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

function lineDefinesKey(line: string, key: string): boolean {
  let stripped = line.trim()
  if (stripped.startsWith('export ')) stripped = stripped.slice('export '.length).trimStart()
  const eqIdx = stripped.indexOf('=')
  return eqIdx > 0 && stripped.slice(0, eqIdx).trim() === key
}

/**
 * Set `key` in a Hermes dotenv body. Replaces the first `KEY=` or
 * `export KEY=` line, drops later duplicates (the last one would otherwise
 * win on load), or appends when the key is absent. No regex is built from
 * the key and no `$` replacement patterns are interpreted in the value.
 */
export function upsertHermesEnvContent(content: string, key: string, value: string): string {
  assertSafeEnvValue(key, value)
  const assignment = `${key}=${quoteHermesEnvValue(value)}`
  const lines = content === '' ? [] : content.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  let found = false
  const next: string[] = []
  for (const line of lines) {
    if (lineDefinesKey(line, key)) {
      if (!found) next.push(assignment)
      found = true
      continue
    }
    next.push(line)
  }
  if (!found) next.push(assignment)
  return `${next.join('\n')}\n`
}

const PRIVATE_FILE_MODE = 0o600

/**
 * Replace a dotenv file atomically and keep it private.
 *
 * The content goes to a temp file in the target's directory, created with
 * O_EXCL and mode 0600, fsynced, then renamed over the target. Readers see
 * either the old file or the new one, never a partial write. The result is
 * never looser than 0600; a stricter existing mode (e.g. 0400) is kept. The
 * temp file is removed if any step fails.
 */
export function writeEnvFileAtomic(path: string, content: string): void {
  let mode = PRIVATE_FILE_MODE
  try {
    mode = statSync(path).mode & PRIVATE_FILE_MODE
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  let fd: number | null = openSync(tmpPath, 'wx', PRIVATE_FILE_MODE)
  try {
    // openSync's mode is filtered by the umask; set the final mode explicitly.
    fchmodSync(fd, mode)
    writeSync(fd, content, null, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmpPath, path)
  } catch (err) {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* already failing */ }
    }
    try { unlinkSync(tmpPath) } catch { /* already gone */ }
    throw err
  }
}
