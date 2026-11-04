import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeEnvFileAtomic } from '@/lib/dotenv-writer'

const isWindows = process.platform === 'win32'
const TARGET = 'dotenv-file'
const modeOf = (path: string) => statSync(path).mode & 0o777

describe('writeEnvFileAtomic', () => {
  let dir: string
  let target: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-dotenv-'))
    target = join(dir, TARGET)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a new file with the content and mode 0600', () => {
    writeEnvFileAtomic(target, 'A=1\n')
    expect(readFileSync(target, 'utf8')).toBe('A=1\n')
    if (!isWindows) expect(modeOf(target)).toBe(0o600)
    expect(readdirSync(dir)).toEqual([TARGET])
  })

  it.skipIf(isWindows)('tightens a world-readable file to 0600', () => {
    writeFileSync(target, 'OLD=1\n')
    chmodSync(target, 0o644)
    writeEnvFileAtomic(target, 'NEW=1\n')
    expect(readFileSync(target, 'utf8')).toBe('NEW=1\n')
    expect(modeOf(target)).toBe(0o600)
  })

  it.skipIf(isWindows)('keeps an existing 0600 file at 0600', () => {
    writeFileSync(target, 'OLD=1\n')
    chmodSync(target, 0o600)
    writeEnvFileAtomic(target, 'NEW=2\n')
    expect(readFileSync(target, 'utf8')).toBe('NEW=2\n')
    expect(modeOf(target)).toBe(0o600)
  })

  it.skipIf(isWindows)('keeps a stricter existing mode', () => {
    writeFileSync(target, 'OLD=1\n')
    chmodSync(target, 0o400)
    writeEnvFileAtomic(target, 'NEW=3\n')
    expect(readFileSync(target, 'utf8')).toBe('NEW=3\n')
    expect(modeOf(target)).toBe(0o400)
  })

  it('removes the temp file when the rename fails', () => {
    // A non-empty directory at the target path makes rename fail.
    mkdirSync(target)
    writeFileSync(join(target, 'keep'), 'x')
    expect(() => writeEnvFileAtomic(target, 'A=1\n')).toThrow()
    expect(readdirSync(dir)).toEqual([TARGET])
  })
})
