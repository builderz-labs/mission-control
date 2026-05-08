import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_EXECUTION_POLICY } from '../governance/execution-policy'

vi.mock('@/lib/db', () => ({ getDatabase: vi.fn() }))
vi.mock('../governance/runtime-limits', () => ({ getPolicy: vi.fn() }))

import { getDatabase } from '@/lib/db'
import { getPolicy } from '../governance/runtime-limits'
import { checkDispatchAllowed } from '../governance/policy-engine'

const mockGetDb = vi.mocked(getDatabase)
const mockGetPolicy = vi.mocked(getPolicy)

function makeDb(opts: {
  concurrentRuns?: number
  hourlyRuns?: number
  agentRuns?: number
} = {}) {
  return {
    prepare: (sql: string) => ({
      get: (..._args: unknown[]) => {
        if (sql.includes("status = 'running'") && sql.includes('agent_name')) {
          return { c: opts.agentRuns ?? 0 }
        }
        if (sql.includes("status = 'running'")) {
          return { c: opts.concurrentRuns ?? 0 }
        }
        if (sql.includes('created_at >=') && sql.includes('execution_runs')) {
          return { c: opts.hourlyRuns ?? 0 }
        }
        return { c: 0 }
      },
      run: vi.fn(),
      all: (..._args: unknown[]) => [],
    }),
  } as any
}

describe('DEFAULT_EXECUTION_POLICY', () => {
  it('has expected default values', () => {
    expect(DEFAULT_EXECUTION_POLICY.maxConcurrentRuns).toBe(10)
    expect(DEFAULT_EXECUTION_POLICY.maxConcurrentPerAgent).toBe(3)
    expect(DEFAULT_EXECUTION_POLICY.maxTasksPerHour).toBe(100)
    expect(DEFAULT_EXECUTION_POLICY.maintenanceMode).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkDispatchAllowed
// ---------------------------------------------------------------------------

describe('checkDispatchAllowed — allowed paths', () => {
  beforeEach(() => {
    mockGetPolicy.mockReturnValue({ ...DEFAULT_EXECUTION_POLICY })
    mockGetDb.mockReturnValue(makeDb())
  })

  it('allows dispatch when everything is under limits', () => {
    const result = checkDispatchAllowed({ workspaceId: 1, agentName: 'test' })
    expect(result.allowed).toBe(true)
  })

  it('allows when no agentName is provided', () => {
    const result = checkDispatchAllowed({ workspaceId: 1 })
    expect(result.allowed).toBe(true)
  })
})

describe('checkDispatchAllowed — maintenance mode', () => {
  it('denies when maintenance mode is active', () => {
    mockGetPolicy.mockReturnValue({ ...DEFAULT_EXECUTION_POLICY, maintenanceMode: true })
    mockGetDb.mockReturnValue(makeDb())
    const result = checkDispatchAllowed({ workspaceId: 1 })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected denied')
    expect(result.code).toBe('MAINTENANCE_MODE')
  })
})

describe('checkDispatchAllowed — concurrent run limits', () => {
  it('denies when max concurrent runs reached', () => {
    mockGetPolicy.mockReturnValue({ ...DEFAULT_EXECUTION_POLICY, maxConcurrentRuns: 3 })
    mockGetDb.mockReturnValue(makeDb({ concurrentRuns: 3 }))
    const result = checkDispatchAllowed({ workspaceId: 1 })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected denied')
    expect(result.code).toBe('MAX_CONCURRENT_RUNS')
  })

  it('allows when just below max concurrent', () => {
    mockGetPolicy.mockReturnValue({ ...DEFAULT_EXECUTION_POLICY, maxConcurrentRuns: 3 })
    mockGetDb.mockReturnValue(makeDb({ concurrentRuns: 2 }))
    const result = checkDispatchAllowed({ workspaceId: 1 })
    expect(result.allowed).toBe(true)
  })
})

describe('checkDispatchAllowed — hourly quota', () => {
  it('denies when hourly quota exceeded', () => {
    mockGetPolicy.mockReturnValue({ ...DEFAULT_EXECUTION_POLICY, maxTasksPerHour: 10 })
    mockGetDb.mockReturnValue(makeDb({ concurrentRuns: 0, hourlyRuns: 10 }))
    const result = checkDispatchAllowed({ workspaceId: 1 })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected denied')
    expect(result.code).toBe('QUOTA_EXCEEDED')
  })
})

describe('checkDispatchAllowed — per-agent concurrency', () => {
  it('denies when agent at max concurrency', () => {
    mockGetPolicy.mockReturnValue({ ...DEFAULT_EXECUTION_POLICY, maxConcurrentPerAgent: 2 })
    mockGetDb.mockReturnValue(makeDb({ agentRuns: 2 }))
    const result = checkDispatchAllowed({ workspaceId: 1, agentName: 'slow-agent' })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected denied')
    expect(result.code).toBe('MAX_CONCURRENT_AGENT')
  })
})

describe('checkDispatchAllowed — fail-closed on error', () => {
  it('denies with POLICY_UNAVAILABLE when DB throws', () => {
    mockGetPolicy.mockReturnValue({ ...DEFAULT_EXECUTION_POLICY })
    mockGetDb.mockImplementation(() => { throw new Error('db offline') })
    const result = checkDispatchAllowed({ workspaceId: 1 })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected denied')
    expect(result.code).toBe('POLICY_UNAVAILABLE')
  })
})
