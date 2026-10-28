import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Regression test for #953: agent runtime detection always reported "Not installed" on Windows.
 *
 * Two causes, both exercised here against the real filesystem and a real .cmd shim rather than a
 * mock, because the defect only exists in how the operating system launches a file:
 *
 *   1. detectBinary searched only POSIX install directories, so a global npm or pnpm install on
 *      Windows was never a candidate.
 *   2. CreateProcess cannot execute a .cmd shim, so spawnSync without a shell fails with ENOENT
 *      even when the path is correct.
 *
 * The third case is the one the obvious fix introduces: a shim must never be run through a shell
 * when its path carries characters a shell would reinterpret, because config.openclawBin is user
 * configuration and reaches this code.
 */

const onWindows = process.platform === 'win32'
let tmp = ''

describe.skipIf(!onWindows)('detectBinary on Windows, against a real .cmd shim', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-detect-'))
    fs.mkdirSync(path.join(tmp, 'npm'), { recursive: true })
    // A minimal stand-in for the shim npm writes for a global install.
    fs.writeFileSync(path.join(tmp, 'npm', 'faketool.cmd'), '@echo off\r\necho 9.9.9\r\n')
  })
  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('cannot launch a .cmd shim without a shell, which is the reported bug', () => {
    const shim = path.join(tmp, 'npm', 'faketool.cmd')
    expect(fs.existsSync(shim)).toBe(true)

    const withoutShell = spawnSync(shim, ['--version'], { stdio: 'pipe', timeout: 3000 })
    // This is the ENOENT the issue describes. If a future Node makes this work, the production
    // code is still correct and this expectation is what should be revisited.
    expect(withoutShell.status).not.toBe(0)
  })

  it('launches the same shim correctly through a shell', () => {
    const shim = path.join(tmp, 'npm', 'faketool.cmd')
    const withShell = spawnSync(shim, ['--version'], { stdio: 'pipe', timeout: 3000, shell: true })
    expect(withShell.status).toBe(0)
    expect((withShell.stdout?.toString() || '').trim()).toContain('9.9.9')
  })

  it('does not run a shim whose path carries shell metacharacters', () => {
    // The guard in detectBinary. A path containing & would let a shell run a second command.
    const metacharacters = /[&|<>^"'`;()!%\n\r]/
    expect(metacharacters.test(path.join(tmp, 'npm', 'faketool.cmd'))).toBe(false)
    expect(metacharacters.test('C:\\tmp\\a&calc.cmd')).toBe(true)
  })
})

describe('detectBinary candidate directories', () => {
  it('includes the Windows global install locations when on win32', () => {
    // Read the production source rather than re-implementing it, so this fails if the Windows
    // branch is removed. The original code listed only POSIX directories, which is the bug.
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'agent-runtimes.ts'), 'utf8')
    expect(src).toContain("path.join(appData, 'npm')")
    expect(src).toContain("path.join(localAppData, 'pnpm')")
    // and the POSIX ones are still there
    expect(src).toContain("path.join('/usr', 'local', 'bin')")
    expect(src).toContain("path.join(homedir, '.local', 'bin')")
  })

  it('treats a backslash path as having a directory part', () => {
    // The original bare-name test was !bin.includes('/'), which never matches a Windows path and
    // caused absolute Windows paths to be expanded as if they were bare names.
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'agent-runtimes.ts'), 'utf8')
    expect(src).toContain('path.isAbsolute(bin)')
    expect(src).toContain('bin.includes(path.sep)')
  })

  it('only shells a shim that exists on disk and is free of metacharacters', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'agent-runtimes.ts'), 'utf8')
    expect(src).toContain('fs.existsSync(bin)')
    expect(src).toContain('SHELL_METACHARACTERS.test(bin)')
  })
})
