import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/password'

describe('hashPassword', () => {
  it('returns a string in salt:hash format', () => {
    const result = hashPassword('secret')
    const parts = result.split(':')
    expect(parts).toHaveLength(2)
    expect(parts[0].length).toBeGreaterThan(0)
    expect(parts[1].length).toBeGreaterThan(0)
  })

  it('produces different salts for the same password', () => {
    const a = hashPassword('secret')
    const b = hashPassword('secret')
    const saltA = a.split(':')[0]
    const saltB = b.split(':')[0]
    expect(saltA).not.toBe(saltB)
  })
})

describe('verifyPassword', () => {
  it('returns true for a correct password', () => {
    const stored = hashPassword('correct-horse')
    expect(verifyPassword('correct-horse', stored)).toBe(true)
  })

  it('returns false for a wrong password', () => {
    const stored = hashPassword('correct-horse')
    expect(verifyPassword('wrong-horse', stored)).toBe(false)
  })

  it('returns false for a malformed stored hash (no colon)', () => {
    expect(verifyPassword('anything', 'nocolonhere')).toBe(false)
  })

  it('returns false for an empty stored string', () => {
    expect(verifyPassword('anything', '')).toBe(false)
  })

  it('returns false for an empty salt', () => {
    expect(verifyPassword('anything', ':somehash')).toBe(false)
  })

  it('returns false for an empty hash', () => {
    expect(verifyPassword('anything', 'somesalt:')).toBe(false)
  })
})
