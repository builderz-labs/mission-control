import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted() so mock variables are available inside vi.mock() factories
const { mockRun, mockGet, mockAll, mockPrepare, mockLoggerError } = vi.hoisted(() => {
  const mockRun = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
  const mockGet = vi.fn((): any => ({ count: 1 }))
  const mockAll = vi.fn((): any[] => [])
  const mockPrepare = vi.fn(() => ({
    run: mockRun,
    get: mockGet,
    all: mockAll,
  }))
  const mockLoggerError = vi.fn()
  return { mockRun, mockGet, mockAll, mockPrepare, mockLoggerError }
})

// Mock better-sqlite3 native module to avoid needing compiled bindings
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => ({
      prepare: mockPrepare,
      pragma: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
    })),
  }
})

vi.mock('@/lib/config', () => ({
  config: { dbPath: ':memory:' },
  ensureDirExists: vi.fn(),
}))

vi.mock('@/lib/migrations', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: mockLoggerError, warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn(), setMaxListeners: vi.fn() },
}))

import { sovereignMemory } from '@/lib/sovereign-memory'

describe('sovereignMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('set()', () => {
    it('calls db.prepare with INSERT ON CONFLICT and returns true', () => {
      const result = sovereignMemory.set('test-key', { foo: 'bar' }, 'my-project', 'AEGIS')

      expect(result).toBe(true)
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sovereign_memory'),
      )
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT(key) DO UPDATE SET'),
      )
      expect(mockRun).toHaveBeenCalledWith(
        'test-key',
        JSON.stringify({ foo: 'bar' }),
        'my-project',
        'AEGIS',
        expect.any(Number),
      )
    })

    it('returns false and logs error on DB failure', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('DB write failed')
      })

      const result = sovereignMemory.set('bad-key', 'value')

      expect(result).toBe(false)
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), key: 'bad-key' }),
        'Failed to set sovereign memory',
      )
    })
  })

  describe('get()', () => {
    it('returns parsed JSON for existing key', () => {
      mockGet.mockReturnValueOnce({ value: JSON.stringify({ hello: 'world' }) })

      const result = sovereignMemory.get<{ hello: string }>('existing-key')

      expect(result).toEqual({ hello: 'world' })
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT value FROM sovereign_memory WHERE key = ?'),
      )
      expect(mockGet).toHaveBeenCalledWith('existing-key')
    })

    it('returns null for missing key', () => {
      mockGet.mockReturnValueOnce(undefined)

      const result = sovereignMemory.get('missing-key')

      expect(result).toBeNull()
    })

    it('returns null on DB error', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('DB read failed')
      })

      const result = sovereignMemory.get('error-key')

      expect(result).toBeNull()
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), key: 'error-key' }),
        'Failed to get sovereign memory',
      )
    })
  })

  describe('listByProject()', () => {
    it('returns parsed entries for a project', () => {
      const rawRows = [
        { key: 'k1', value: JSON.stringify({ a: 1 }), project_slug: 'proj', actor: 'AEGIS', updated_at: 1000 },
        { key: 'k2', value: JSON.stringify('hello'), project_slug: 'proj', actor: 'SCOUT', updated_at: 2000 },
      ]
      mockAll.mockReturnValueOnce(rawRows)

      const result = sovereignMemory.listByProject('proj')

      expect(result).toEqual([
        { key: 'k1', value: { a: 1 }, project_slug: 'proj', actor: 'AEGIS', updated_at: 1000 },
        { key: 'k2', value: 'hello', project_slug: 'proj', actor: 'SCOUT', updated_at: 2000 },
      ])
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM sovereign_memory WHERE project_slug = ?'),
      )
      expect(mockAll).toHaveBeenCalledWith('proj')
    })

    it('returns empty array on error', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('DB list failed')
      })

      const result = sovereignMemory.listByProject('bad-project')

      expect(result).toEqual([])
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), projectSlug: 'bad-project' }),
        'Failed to list sovereign memory',
      )
    })
  })

  describe('prune()', () => {
    it('deletes entries older than threshold and returns changes count', () => {
      mockRun.mockReturnValueOnce({ lastInsertRowid: 0, changes: 5 })

      const result = sovereignMemory.prune(3600)

      expect(result).toBe(5)
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sovereign_memory WHERE updated_at < ?'),
      )
      expect(mockRun).toHaveBeenCalledWith(expect.any(Number))
    })

    it('returns 0 on error', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('DB prune failed')
      })

      const result = sovereignMemory.prune(7200)

      expect(result).toBe(0)
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to prune sovereign memory',
      )
    })
  })
})
