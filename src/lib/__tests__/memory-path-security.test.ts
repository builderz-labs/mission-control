import { describe, expect, it } from 'vitest'
import { canonicalizeMemoryRelativePath, isPathAllowed } from '@/lib/memory-path'

describe('memory path security boundary', () => {
  it.each([
    '',
    '/absolute.md',
    'C:\\absolute.md',
    '../escape.md',
    'folder/../escape.md',
    './note.md',
    'folder//note.md',
    'folder/./note.md',
    'folder/\0note.md',
  ])('rejects non-canonical path %j', (path) => {
    expect(() => canonicalizeMemoryRelativePath(path)).toThrow()
    expect(isPathAllowed(path)).toBe(false)
  })

  it('canonicalizes platform separators without changing the path scope', () => {
    expect(canonicalizeMemoryRelativePath('folder\\nested\\note.md')).toBe('folder/nested/note.md')
  })

  it('accepts a bounded nested relative path', () => {
    expect(canonicalizeMemoryRelativePath('projects/mission-control/note.md')).toBe(
      'projects/mission-control/note.md',
    )
  })
})
