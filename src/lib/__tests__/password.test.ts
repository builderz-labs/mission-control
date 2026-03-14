import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../password'

describe('hashPassword', () => {
  it('returns a string with salt:hash format', () => {
    const hash = hashPassword('testpassword')
    expect(hash).toContain(':')
    const parts = hash.split(':')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveLength(32) // 16 bytes hex = 32 chars
    expect(parts[1]).toHaveLength(64) // 32 bytes hex = 64 chars
  })

  it('produces different hashes for same password (random salt)', () => {
    const hash1 = hashPassword('password123')
    const hash2 = hashPassword('password123')
    expect(hash1).not.toBe(hash2)
  })

  it('handles empty string', () => {
    const hash = hashPassword('')
    expect(hash).toContain(':')
  })

  it('handles special characters', () => {
    const hash = hashPassword('p@$$w0rd!#%&*()')
    expect(hash).toContain(':')
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', () => {
    const password = 'correctpassword'
    const hash = hashPassword(password)
    expect(verifyPassword(password, hash)).toBe(true)
  })

  it('returns false for wrong password', () => {
    const hash = hashPassword('correctpassword')
    expect(verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('returns false for malformed stored hash (no colon)', () => {
    expect(verifyPassword('password', 'malformedhash')).toBe(false)
  })

  it('returns false for empty stored hash', () => {
    expect(verifyPassword('password', '')).toBe(false)
  })

  it('returns false when salt missing', () => {
    expect(verifyPassword('password', ':somehash')).toBe(false)
  })

  it('returns false when hash missing', () => {
    expect(verifyPassword('password', 'somesalt:')).toBe(false)
  })

  it('is case-sensitive', () => {
    const hash = hashPassword('Password')
    expect(verifyPassword('password', hash)).toBe(false)
    expect(verifyPassword('PASSWORD', hash)).toBe(false)
    expect(verifyPassword('Password', hash)).toBe(true)
  })

  it('verifies consistently across multiple calls', () => {
    const password = 'stable-password'
    const hash = hashPassword(password)
    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword(password, hash)).toBe(true)
  })
})
