import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { standaloneReleaseIntact } from '@/lib/standalone-assets'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('standaloneReleaseIntact', () => {
  it('rejects a cwd that has been unlinked from the filesystem', () => {
    expect(standaloneReleaseIntact(join(tmpdir(), 'mc-missing-standalone'))).toBe(false)
  })

  it('requires a non-empty brand logo in the standalone public tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-standalone-'))
    dirs.push(root)
    expect(standaloneReleaseIntact(root)).toBe(false)
    mkdirSync(join(root, 'public', 'brand'), { recursive: true })
    writeFileSync(join(root, 'public', 'brand', 'mc-logo-128.png'), '')
    expect(standaloneReleaseIntact(root)).toBe(false)
    writeFileSync(join(root, 'public', 'brand', 'mc-logo-128.png'), 'png')
    expect(standaloneReleaseIntact(root)).toBe(true)
  })
})
