import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { safeCompare, requireRole } from '@/lib/auth'

// Mock dependencies that auth.ts imports
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
}))

// Prevent event-bus singleton side-effects
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

describe('safeCompare', () => {
  it('returns true for matching strings', () => {
    expect(safeCompare('abc123', 'abc123')).toBe(true)
  })

  it('returns false for non-matching strings of same length', () => {
    expect(safeCompare('abc123', 'xyz789')).toBe(false)
  })

  it('returns false for different length strings', () => {
    expect(safeCompare('short', 'muchlonger')).toBe(false)
  })

  it('returns true for two empty strings', () => {
    expect(safeCompare('', '')).toBe(true)
  })

  it('returns false when one string is empty', () => {
    expect(safeCompare('', 'notempty')).toBe(false)
    expect(safeCompare('notempty', '')).toBe(false)
  })

  it('returns false for non-string inputs', () => {
    expect(safeCompare(null as any, 'a')).toBe(false)
    expect(safeCompare('a', undefined as any)).toBe(false)
  })
})

describe('requireRole', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, API_KEY: 'test-api-key-secret' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/api/test', {
      headers: new Headers(headers),
    })
  }

  it('returns 401 when no authentication is provided', () => {
    const result = requireRole(makeRequest(), 'viewer')
    expect(result.status).toBe(401)
    expect(result.error).toBe('Authentication required')
    expect(result.user).toBeUndefined()
  })

  it('returns 401 when API key is wrong', () => {
    const result = requireRole(
      makeRequest({ 'x-api-key': 'wrong-key' }),
      'viewer',
    )
    expect(result.status).toBe(401)
    expect(result.error).toBe('Authentication required')
  })

  it('returns user when API key is valid and role is sufficient', () => {
    const result = requireRole(
      makeRequest({ 'x-api-key': 'test-api-key-secret' }),
      'admin',
    )
    expect(result.status).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.user).toBeDefined()
    expect(result.user!.username).toBe('api')
    expect(result.user!.role).toBe('admin')
  })

  it('returns user for lower role requirement with API key (admin >= viewer)', () => {
    const result = requireRole(
      makeRequest({ 'x-api-key': 'test-api-key-secret' }),
      'viewer',
    )
    expect(result.user).toBeDefined()
    expect(result.user!.role).toBe('admin')
  })

  it('returns user for operator role requirement with API key (admin >= operator)', () => {
    const result = requireRole(
      makeRequest({ 'x-api-key': 'test-api-key-secret' }),
      'operator',
    )
    expect(result.user).toBeDefined()
  })
})
