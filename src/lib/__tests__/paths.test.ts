import { describe, it, expect } from 'vitest'
import { resolveWithin } from '../paths'
import path from 'node:path'

describe('resolveWithin', () => {
  const base = '/tmp/sandbox'

  it('resolves a simple relative path within base', () => {
    const result = resolveWithin(base, 'file.txt')
    expect(result).toBe('/tmp/sandbox/file.txt')
  })

  it('resolves nested relative path', () => {
    const result = resolveWithin(base, 'subdir/file.txt')
    expect(result).toBe('/tmp/sandbox/subdir/file.txt')
  })

  it('throws when path escapes base with ..', () => {
    expect(() => resolveWithin(base, '../escape.txt')).toThrow('Path escapes base directory')
  })

  it('throws when path tries deep escape', () => {
    expect(() => resolveWithin(base, '../../etc/passwd')).toThrow('Path escapes base directory')
  })

  it('throws for absolute path outside base', () => {
    expect(() => resolveWithin(base, '/etc/passwd')).toThrow('Path escapes base directory')
  })

  it('allows an absolute path within the base', () => {
    const result = resolveWithin(base, '/tmp/sandbox/file.txt')
    expect(result).toBe('/tmp/sandbox/file.txt')
  })

  it('handles double slashes and normalizes', () => {
    const result = resolveWithin(base, 'subdir//file.txt')
    expect(result).toBe('/tmp/sandbox/subdir/file.txt')
  })

  it('does not allow sibling directory access', () => {
    expect(() => resolveWithin(base, '../other/file.txt')).toThrow()
  })

  it('handles base dir with trailing slash', () => {
    const result = resolveWithin('/tmp/sandbox/', 'file.txt')
    expect(result).toBe('/tmp/sandbox/file.txt')
  })
})
