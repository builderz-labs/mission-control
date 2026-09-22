import { describe, expect, it } from 'vitest'
import { isSafeHomePath, resolveWithin } from '../safe-home-path'

describe('isSafeHomePath', () => {
  it('allows the home directory and children, rejects escapes', () => {
    expect(isSafeHomePath('/Users/dev', '/Users/dev')).toBe(true)
    expect(isSafeHomePath('/Users/dev/app', '/Users/dev')).toBe(true)
    expect(isSafeHomePath('/etc', '/Users/dev')).toBe(false)
    expect(isSafeHomePath('/Users/dev/../etc', '/Users/dev')).toBe(false)
    expect(isSafeHomePath('', '/Users/dev')).toBe(false)
  })
})

describe('resolveWithin', () => {
  it('rejects path traversal out of the root', () => {
    expect(resolveWithin('/data', 'sessions', 'a.md')?.endsWith('/data/sessions/a.md')).toBe(true)
    expect(resolveWithin('/data', '../../etc/passwd')).toBeNull()
    expect(resolveWithin('/data', 'ok', '..', '..', 'etc')).toBeNull()
  })
})
