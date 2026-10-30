import { createHash, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { AUTO_LOGIN_TOKEN_FILE } from '@/lib/auto-login'

interface AutoLoginTokenRecord {
  token: string
  expiresAt: number
}

interface ConsumeOptions {
  filePath?: string
  now?: number
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Hash first so mismatched input lengths still take the fixed-size compare path. */
function constantTimeTokenEqual(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected))
}

export function isSafeAutoLoginTokenMode(mode: number, platform = process.platform): boolean {
  // Windows does not expose POSIX permission bits through stat(). The writer
  // still requests 0600; Unix hosts enforce the exact mode here.
  if (platform === 'win32') return true
  return (mode & 0o777) === 0o600
}

function parseRecord(raw: string): AutoLoginTokenRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Partial<AutoLoginTokenRecord>
  if (typeof record.token !== 'string' || record.token.length === 0) return null
  if (!Number.isSafeInteger(record.expiresAt)) return null
  return { token: record.token, expiresAt: record.expiresAt as number }
}

function unlinkSameFile(filePath: string, opened: fs.BigIntStats): boolean {
  try {
    const current = fs.lstatSync(filePath, { bigint: true })
    if (
      !current.isFile()
      || current.dev !== opened.dev
      || current.ino !== opened.ino
      || current.size !== opened.size
      || current.mtimeNs !== opened.mtimeNs
    ) {
      return false
    }
    fs.unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Consume the launcher-issued token. The file must already have safe
 * permissions. CAS-style deletion makes concurrent consumers single-winner.
 */
export function consumeAutoLoginToken(candidate: string | null | undefined, options: ConsumeOptions = {}): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 512) return false

  const filePath = options.filePath ?? path.join(config.dataDir, AUTO_LOGIN_TOKEN_FILE)
  const now = options.now ?? Date.now()
  let fd: number | null = null

  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(fd, { bigint: true })
    if (!stat.isFile() || !isSafeAutoLoginTokenMode(Number(stat.mode))) return false

    const record = parseRecord(fs.readFileSync(fd, 'utf8'))
    if (!record) {
      unlinkSameFile(filePath, stat)
      return false
    }

    if (record.expiresAt <= now || record.expiresAt > now + 5 * 60_000) {
      unlinkSameFile(filePath, stat)
      return false
    }

    const matches = constantTimeTokenEqual(candidate, record.token)
    if (!matches) return false

    return unlinkSameFile(filePath, stat)
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        // The descriptor may already be invalid after an exceptional read.
      }
    }
  }
}
