import { describe, expect, it } from 'vitest'
import {
  alwaysProtectedRoots,
  devProjectRoot,
  extractDevPathsFromCommand,
  isProtectedPath,
  isSafeDeleteTarget,
  parseLeaseProjectRoots,
  parseLsofCwds,
  uniqueRoots,
} from '@/lib/mac-cleanup/protect'

const home = '/Users/tylerdevries'

describe('devProjectRoot', () => {
  it('maps a nested cwd to the Dev project root', () => {
    expect(devProjectRoot(`${home}/Dev/coffee-story/src/lib`, home)).toBe(`${home}/Dev/coffee-story`)
  })

  it('maps idle checkouts to the specific idle project, not the whole idle tree', () => {
    expect(devProjectRoot(`${home}/Dev/_idle/old-app/src`, home)).toBe(`${home}/Dev/_idle/old-app`)
  })

  it('ignores paths outside Dev', () => {
    expect(devProjectRoot(`${home}/Library/Caches/Homebrew`, home)).toBeNull()
  })
})

describe('isProtectedPath', () => {
  const roots = [`${home}/Dev/coffee-story`, `${home}/Work`, `${home}/Dev/mission-control`]

  it('blocks the active project and nested files', () => {
    expect(isProtectedPath(`${home}/Dev/coffee-story/node_modules`, roots)).toBe(true)
    expect(isProtectedPath(`${home}/Dev/coffee-story`, roots)).toBe(true)
  })

  it('allows sibling projects and global caches', () => {
    expect(isProtectedPath(`${home}/Dev/actz-may/node_modules`, roots)).toBe(false)
    expect(isProtectedPath(`${home}/.npm/_cacache`, roots)).toBe(false)
    expect(isProtectedPath(`${home}/Dev/_idle/old-app/node_modules`, roots)).toBe(false)
  })

  it('blocks deleting a parent of a protected root', () => {
    expect(isProtectedPath(`${home}/Dev`, roots)).toBe(true)
    expect(isProtectedPath(home, roots)).toBe(true)
  })
})

describe('parsers', () => {
  it('reads lsof cwd paths', () => {
    const stdout = ['p99', 'fcwd', `n${home}/Dev/actz-may`, 'p100', 'fcwd', 'n/private/tmp'].join('\n')
    expect(parseLsofCwds(stdout)).toEqual([`${home}/Dev/actz-may`, '/private/tmp'])
  })

  it('reads lease project roots', () => {
    expect(parseLeaseProjectRoots('pid=1\nproject_root=/Users/tylerdevries/Dev/omnia-vault\n')).toEqual([
      '/Users/tylerdevries/Dev/omnia-vault',
    ])
  })

  it('extracts Dev paths from command lines', () => {
    const cmd = `node /Users/tylerdevries/Dev/precision-imagery/scripts/dev.mjs`
    expect(extractDevPathsFromCommand(cmd, home)[0]).toContain('/Dev/precision-imagery/')
  })
})

describe('isSafeDeleteTarget', () => {
  const stat = { isSymbolicLink: () => false, uid: 501 }

  it('rejects protected projects, symlinks, and paths outside the allowlist', () => {
    const roots = [`${home}/Dev/coffee-story`]
    expect(isSafeDeleteTarget(`${home}/Dev/coffee-story/node_modules`, `${home}/Dev/_idle`, roots, 501, stat)).toBe(false)
    expect(isSafeDeleteTarget(`${home}/Dev/_idle/old-app/node_modules`, `${home}/Dev/_idle`, roots, 501, {
      isSymbolicLink: () => true,
      uid: 501,
    })).toBe(false)
    expect(isSafeDeleteTarget(`${home}/Work/client`, `${home}/Dev/_idle`, roots, 501, stat)).toBe(false)
  })

  it('allows an idle project cache that is not protected', () => {
    expect(isSafeDeleteTarget(
      `${home}/Dev/_idle/old-app/node_modules`,
      `${home}/Dev/_idle`,
      [`${home}/Dev/coffee-story`],
      501,
      { isSymbolicLink: () => false, uid: 501 },
    )).toBe(true)
  })
})

describe('uniqueRoots', () => {
  it('drops HOME and other roots that would block all user caches', () => {
    const roots = uniqueRoots([
      `${home}/Dev/coffee-story`,
      home,
      `${home}/Library`,
      `${home}/.cache`,
      `${home}/Dev`,
    ], home)
    expect(roots).toEqual([`${home}/Dev/coffee-story`])
  })
})

describe('alwaysProtectedRoots', () => {
  it('includes Work, this repo, and agent homes', () => {
    const roots = alwaysProtectedRoots(home)
    expect(roots).toContain(`${home}/Work`)
    expect(roots).toContain(`${home}/Dev/mission-control`)
    expect(roots).toContain(`${home}/.claude`)
  })
})
