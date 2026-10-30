import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  consumeAutoLoginToken,
  isSafeAutoLoginTokenMode,
} from '@/lib/auto-login-token'

const tempDirs: string[] = []

function tokenFile(record: object, mode = 0o600): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-auto-login-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, 'auto-login-token.json')
  fs.writeFileSync(filePath, JSON.stringify(record), { mode })
  if (process.platform !== 'win32') fs.chmodSync(filePath, mode)
  return filePath
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('auto-login token file', () => {
  it('consumes a matching unexpired token exactly once', () => {
    const filePath = tokenFile({ token: 'one-time-token', expiresAt: 2_000 })

    expect(consumeAutoLoginToken('one-time-token', { filePath, now: 1_000 })).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(consumeAutoLoginToken('one-time-token', { filePath, now: 1_000 })).toBe(false)
  })

  it('does not consume the file for a wrong token', () => {
    const filePath = tokenFile({ token: 'expected-token', expiresAt: 2_000 })

    expect(consumeAutoLoginToken('wrong-token-of-same-length', { filePath, now: 1_000 })).toBe(false)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('rejects and removes an expired token', () => {
    const filePath = tokenFile({ token: 'expired-token', expiresAt: 1_000 })

    expect(consumeAutoLoginToken('expired-token', { filePath, now: 1_000 })).toBe(false)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('rejects a TTL longer than the five-minute ceiling', () => {
    const filePath = tokenFile({ token: 'too-long', expiresAt: 1_000 + 5 * 60_000 + 1 })

    expect(consumeAutoLoginToken('too-long', { filePath, now: 1_000 })).toBe(false)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('rejects malformed records and removes them', () => {
    const filePath = tokenFile({ token: '', expiresAt: 'later' })

    expect(consumeAutoLoginToken('anything', { filePath, now: 1_000 })).toBe(false)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('rejects a token file readable by group or others', () => {
    const filePath = tokenFile({ token: 'visible-token', expiresAt: 2_000 }, 0o644)

    expect(consumeAutoLoginToken('visible-token', { filePath, now: 1_000 })).toBe(false)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked token file', () => {
    const targetPath = tokenFile({ token: 'linked-token', expiresAt: 2_000 })
    const linkPath = path.join(path.dirname(targetPath), 'auto-login-token-link.json')
    fs.symlinkSync(targetPath, linkPath)

    expect(consumeAutoLoginToken('linked-token', { filePath: linkPath, now: 1_000 })).toBe(false)
    expect(fs.existsSync(targetPath)).toBe(true)
  })
})

describe('isSafeAutoLoginTokenMode', () => {
  it('requires exactly 0600 on POSIX platforms', () => {
    expect(isSafeAutoLoginTokenMode(0o100600, 'linux')).toBe(true)
    expect(isSafeAutoLoginTokenMode(0o100400, 'linux')).toBe(false)
    expect(isSafeAutoLoginTokenMode(0o100640, 'linux')).toBe(false)
  })
})
