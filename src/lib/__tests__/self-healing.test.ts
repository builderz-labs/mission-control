/**
 * Tests for the Self-Healing Engine subsystems:
 * - Circuit Breaker (state machine)
 * - Health Pulse (checks + persistence)
 * - Auto-Recovery (strategy execution + logging)
 * - Error Taxonomy (classification)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared DB mock
// ---------------------------------------------------------------------------

const runMock = vi.fn((..._args: unknown[]) => ({ changes: 0, lastInsertRowid: 1 }))
const getMock = vi.fn<() => unknown>()
const allMock = vi.fn<() => unknown[]>(() => [])
const execMock = vi.fn()
const transactionMock = vi.fn((fn: (args: unknown) => void) => fn)
const prepMock = vi.fn(() => ({ run: runMock, get: getMock, all: allMock }))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: prepMock,
    exec: execMock,
    transaction: transactionMock,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/config', () => ({
  config: { dbPath: '/tmp/test.db' },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import {
  getBreakerState,
  getAllBreakerStates,
  isCircuitAllowed,
  recordSuccess,
  recordFailure,
  resetBreaker,
} from '../self-healing/circuit-breaker'

import {
  runHealthChecks,
  getLatestHealthChecks,
  pruneHealthChecks,
} from '../self-healing/health-pulse'

import {
  attemptRecovery,
  registerRecoveryStrategy,
  getRecentRecoveryLogs,
  getServiceRecoveryLogs,
  sanitizeDiagnosis,
} from '../self-healing/auto-recovery'

import {
  classifyError,
  safeErrorMessage,
} from '../self-healing/error-taxonomy'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBreaker(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 1,
    service_name: 'test-service',
    state: 'closed',
    failure_count: 0,
    last_failure_at: null,
    last_success_at: null,
    trip_count: 0,
    cooldown_until: null,
    workspace_id: 1,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeHealthRow(overrides: Record<string, unknown> = {}) {
  return {
    service_name: 'database',
    status: 'healthy',
    response_time_ms: 5,
    error_message: null,
    metadata: null,
    ...overrides,
  }
}

function makeRecoveryLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    service_name: 'test-service',
    error_type: 'transient',
    error_class: 'internal',
    diagnosis: 'Service: test-service | Error: timeout | Type: transient',
    action_taken: 'Automatic recovery succeeded',
    result: 'recovered',
    attempt_number: 1,
    workspace_id: 1,
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

// ============================================================================
// CIRCUIT BREAKER TESTS
// ============================================================================

describe('getBreakerState', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns breaker record when found', () => {
    getMock.mockReturnValue(makeBreaker())
    const result = getBreakerState('test-service')
    expect(result).not.toBeNull()
    expect(result!.service_name).toBe('test-service')
    expect(result!.state).toBe('closed')
  })

  it('returns null when not found', () => {
    getMock.mockReturnValue(undefined)
    expect(getBreakerState('unknown-service')).toBeNull()
  })
})

describe('getAllBreakerStates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no breakers exist', () => {
    allMock.mockReturnValue([])
    expect(getAllBreakerStates()).toEqual([])
  })

  it('returns all breaker records', () => {
    allMock.mockReturnValue([makeBreaker(), makeBreaker({ id: 2, service_name: 'other' })])
    expect(getAllBreakerStates()).toHaveLength(2)
  })
})

describe('isCircuitAllowed — closed state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // ensureBreakerExists INSERT OR IGNORE, then getBreakerState
    runMock.mockReturnValue({ changes: 0, lastInsertRowid: 0 })
    getMock.mockReturnValue(makeBreaker({ state: 'closed' }))
  })

  it('allows requests when breaker is closed', () => {
    expect(isCircuitAllowed('test-service')).toBe(true)
  })
})

describe('isCircuitAllowed — open state', () => {
  beforeEach(() => vi.clearAllMocks())

  it('blocks requests when breaker is open and cooldown has not expired', () => {
    const future = Math.floor(Date.now() / 1000) + 9999
    runMock.mockReturnValue({ changes: 0, lastInsertRowid: 0 })
    getMock.mockReturnValue(makeBreaker({ state: 'open', cooldown_until: future }))
    expect(isCircuitAllowed('test-service')).toBe(false)
  })

  it('allows requests and transitions to half_open when cooldown has expired', () => {
    const past = Math.floor(Date.now() / 1000) - 100
    runMock.mockReturnValue({ changes: 0, lastInsertRowid: 0 })
    getMock.mockReturnValue(makeBreaker({ state: 'open', cooldown_until: past }))
    // isCircuitAllowed transitions to half_open (UPDATE) then returns true
    expect(isCircuitAllowed('test-service')).toBe(true)
    // Verify the UPDATE was called (state change to half_open)
    expect(runMock).toHaveBeenCalled()
  })
})

describe('isCircuitAllowed — half_open state', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows one test request through when breaker is half_open', () => {
    runMock.mockReturnValue({ changes: 0, lastInsertRowid: 0 })
    getMock.mockReturnValue(makeBreaker({ state: 'half_open' }))
    expect(isCircuitAllowed('test-service')).toBe(true)
  })
})

describe('recordSuccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets state to closed and resets failure count', () => {
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })
    getMock.mockReturnValue(makeBreaker({ state: 'closed', failure_count: 0 }))
    const result = recordSuccess('test-service')
    expect(result.state).toBe('closed')
    expect(result.failure_count).toBe(0)
  })

  it('throws if breaker not found after success update', () => {
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })
    getMock.mockReturnValue(undefined)
    expect(() => recordSuccess('ghost-service')).toThrow()
  })
})

describe('recordFailure — threshold tracking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('increments failure count without tripping when below threshold', () => {
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })
    const now = Math.floor(Date.now() / 1000)
    getMock.mockReturnValue(makeBreaker({ failure_count: 1, last_failure_at: now }))
    const result = recordFailure('test-service', {
      failureThreshold: 3,
      windowMs: 300_000,
      cooldownMs: 30_000,
    })
    // Still below threshold — state remains 'closed'
    expect(result.state).toBe('closed')
  })

  it('trips breaker to open when failure threshold is reached', () => {
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })
    const now = Math.floor(Date.now() / 1000)
    // failure_count: 2, threshold: 3 → next failure = 3 → trip
    getMock
      .mockReturnValueOnce(makeBreaker({ failure_count: 2, last_failure_at: now }))   // initial getBreakerState
      .mockReturnValueOnce(makeBreaker({ state: 'open', failure_count: 3, trip_count: 1 })) // after trip
    const result = recordFailure('test-service', {
      failureThreshold: 3,
      windowMs: 300_000,
      cooldownMs: 30_000,
    })
    expect(result.state).toBe('open')
    expect(result.trip_count).toBe(1)
  })

  it('resets failure count when previous failure is outside the time window', () => {
    // last_failure_at is older than the window — should reset to count 1
    const oldFailure = Math.floor(Date.now() / 1000) - 9999
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })
    getMock.mockReturnValue(makeBreaker({ failure_count: 5, last_failure_at: oldFailure }))
    recordFailure('test-service', {
      failureThreshold: 3,
      windowMs: 60_000,
      cooldownMs: 30_000,
    })
    // The UPDATE run should be called with recentFailures = 1
    const updateArgs = runMock.mock.calls[1] // second run = the failure_count UPDATE
    expect(updateArgs[0]).toBe(1) // recentFailures reset to 1
  })
})

describe('resetBreaker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resets breaker to closed state with zero failures', () => {
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })
    getMock.mockReturnValue(makeBreaker({ state: 'closed', failure_count: 0, cooldown_until: null }))
    const result = resetBreaker('test-service')
    expect(result!.state).toBe('closed')
    expect(result!.failure_count).toBe(0)
    expect(result!.cooldown_until).toBeNull()
  })
})

// ============================================================================
// HEALTH PULSE TESTS
// ============================================================================

describe('runHealthChecks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns results for all requested services', () => {
    // DB health check needs a SELECT 1 response
    getMock.mockReturnValue({ ok: 1 })
    // persistHealthChecks uses transaction
    transactionMock.mockImplementation((fn) => (args: unknown) => fn(args))
    const results = runHealthChecks(['database'])
    expect(results).toHaveLength(1)
    expect(results[0].serviceName).toBe('database')
  })

  it('marks unknown service as degraded', () => {
    transactionMock.mockImplementation((fn) => (args: unknown) => fn(args))
    const results = runHealthChecks(['nonexistent-service'])
    expect(results[0].status).toBe('degraded')
    expect(results[0].errorMessage).toContain('No checker registered')
  })

  it('returns healthy status when DB responds correctly', () => {
    getMock.mockReturnValue({ ok: 1 })
    transactionMock.mockImplementation((fn) => (args: unknown) => fn(args))
    const results = runHealthChecks(['database'])
    expect(results[0].status).toBe('healthy')
  })

  it('returns down status when DB query fails', () => {
    getMock.mockImplementation(() => { throw new Error('SQLITE_BUSY') })
    transactionMock.mockImplementation((fn) => (args: unknown) => fn(args))
    const results = runHealthChecks(['database'])
    expect(results[0].status).toBe('down')
    expect(results[0].errorMessage).toBeTruthy()
  })

  it('returns memory check results', () => {
    transactionMock.mockImplementation((fn) => (args: unknown) => fn(args))
    const results = runHealthChecks(['memory'])
    expect(results[0].serviceName).toBe('memory')
    expect(['healthy', 'degraded', 'down']).toContain(results[0].status)
    expect(results[0].metadata).toHaveProperty('heapUsedMb')
  })
})

describe('getLatestHealthChecks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no checks recorded', () => {
    allMock.mockReturnValue([])
    expect(getLatestHealthChecks()).toEqual([])
  })

  it('maps DB rows to HealthCheckResult objects', () => {
    allMock.mockReturnValue([makeHealthRow()])
    const results = getLatestHealthChecks()
    expect(results).toHaveLength(1)
    expect(results[0].serviceName).toBe('database')
    expect(results[0].status).toBe('healthy')
  })

  it('parses JSON metadata when present', () => {
    allMock.mockReturnValue([makeHealthRow({ metadata: '{"freeBytes":1000}' })])
    const results = getLatestHealthChecks()
    expect(results[0].metadata).toEqual({ freeBytes: 1000 })
  })

  it('returns empty array and logs error on DB failure', () => {
    prepMock.mockImplementationOnce(() => { throw new Error('DB error') })
    const results = getLatestHealthChecks()
    expect(results).toEqual([])
  })
})

describe('pruneHealthChecks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns number of deleted records', () => {
    runMock.mockReturnValue({ changes: 5, lastInsertRowid: 0 })
    expect(pruneHealthChecks(3600)).toBe(5)
  })

  it('returns 0 on error', () => {
    prepMock.mockImplementationOnce(() => { throw new Error('DB error') })
    expect(pruneHealthChecks()).toBe(0)
  })
})

// ============================================================================
// AUTO-RECOVERY TESTS
// ============================================================================

describe('attemptRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // getRecentAttemptCount uses DB
    getMock.mockReturnValue({ count: 0 })
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 1 })
    // circuit_breakers for isCircuitAllowed
    prepMock.mockImplementation(() => ({
      run: runMock,
      get: getMock,
      all: allMock,
    }))
  })

  it('escalates when error is not retryable (permanent)', () => {
    getMock.mockReturnValue(makeBreaker({ state: 'closed' }))
    const error = new Error('SQLITE_CORRUPT: database corruption')
    const action = attemptRecovery('test-service', error)
    expect(action.result).toBe('escalated')
  })

  it('escalates when max recovery attempts are exhausted', () => {
    // Return count >= MAX_RECOVERY_ATTEMPTS (3)
    getMock
      .mockReturnValueOnce({ count: 3 }) // getRecentAttemptCount
      .mockReturnValue(makeBreaker({ state: 'closed' }))
    const error = new Error('ETIMEDOUT: connection timed out')
    const action = attemptRecovery('test-service', error)
    expect(action.result).toBe('escalated')
    expect(action.attemptNumber).toBe(4)
  })

  it('escalates when circuit breaker is open', () => {
    const future = Math.floor(Date.now() / 1000) + 9999
    getMock
      .mockReturnValueOnce({ count: 0 }) // getRecentAttemptCount
      .mockReturnValue(makeBreaker({ state: 'open', cooldown_until: future }))
    const error = new Error('ETIMEDOUT: connection timed out')
    const action = attemptRecovery('test-service', error)
    expect(action.result).toBe('escalated')
  })

  it('uses generic database recovery when no strategy registered', () => {
    getMock
      .mockReturnValueOnce({ count: 0 })  // getRecentAttemptCount
      .mockReturnValue(makeBreaker({ state: 'closed' }))  // isCircuitAllowed + circuit ops
    const error = new Error('ECONNRESET: connection reset')
    const action = attemptRecovery('database', error)
    // database has a generic recovery strategy — result is recovered or failed
    expect(['recovered', 'failed']).toContain(action.result)
  })

  it('uses registered custom strategy', () => {
    getMock
      .mockReturnValueOnce({ count: 0 })
      .mockReturnValue(makeBreaker({ state: 'closed' }))

    const strategy = vi.fn(() => true)
    registerRecoveryStrategy('custom-service', strategy)

    const error = new Error('ECONNRESET: custom service failed')
    const action = attemptRecovery('custom-service', error)
    expect(strategy).toHaveBeenCalledWith('custom-service', error)
    expect(action.result).toBe('recovered')
  })

  it('returns failed when custom strategy returns false', () => {
    getMock
      .mockReturnValueOnce({ count: 0 })
      .mockReturnValue(makeBreaker({ state: 'closed' }))

    registerRecoveryStrategy('fail-service', () => false)

    const error = new Error('ECONNRESET: fail service down')
    const action = attemptRecovery('fail-service', error)
    expect(action.result).toBe('failed')
  })

  it('returns failed when custom strategy throws', () => {
    getMock
      .mockReturnValueOnce({ count: 0 })
      .mockReturnValue(makeBreaker({ state: 'closed' }))

    registerRecoveryStrategy('throw-service', () => {
      throw new Error('strategy error')
    })

    const error = new Error('ECONNRESET: throw service down')
    const action = attemptRecovery('throw-service', error)
    expect(action.result).toBe('failed')
  })

  it('sets correct attemptNumber on first attempt', () => {
    getMock
      .mockReturnValueOnce({ count: 0 })
      .mockReturnValue(makeBreaker({ state: 'closed' }))
    registerRecoveryStrategy('attempt-service', () => true)
    const action = attemptRecovery('attempt-service', new Error('ECONNRESET'))
    expect(action.attemptNumber).toBe(1)
  })
})

describe('sanitizeDiagnosis', () => {
  it('removes the Error segment from diagnosis string', () => {
    const raw = 'Service: db | Error: connection refused | Type: transient | Class: internal | Retryable: true'
    const sanitized = sanitizeDiagnosis(raw)
    expect(sanitized).not.toContain('connection refused')
    expect(sanitized).toContain('Service: db')
    expect(sanitized).toContain('Type: transient')
  })

  it('leaves diagnosis unchanged when no Error segment exists', () => {
    const clean = 'Service: db | Type: transient | Class: internal'
    expect(sanitizeDiagnosis(clean)).toBe(clean)
  })
})

describe('getRecentRecoveryLogs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no logs exist', () => {
    allMock.mockReturnValue([])
    expect(getRecentRecoveryLogs()).toEqual([])
  })

  it('returns log entries', () => {
    allMock.mockReturnValue([makeRecoveryLog()])
    const logs = getRecentRecoveryLogs(10)
    expect(logs).toHaveLength(1)
    expect(logs[0].result).toBe('recovered')
  })

  it('returns empty array on DB error', () => {
    prepMock.mockImplementationOnce(() => { throw new Error('DB error') })
    expect(getRecentRecoveryLogs()).toEqual([])
  })
})

describe('getServiceRecoveryLogs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns logs for specific service', () => {
    allMock.mockReturnValue([makeRecoveryLog({ service_name: 'db-service' })])
    const logs = getServiceRecoveryLogs('db-service')
    expect(logs[0].service_name).toBe('db-service')
  })

  it('returns empty array on DB error', () => {
    prepMock.mockImplementationOnce(() => { throw new Error('DB error') })
    expect(getServiceRecoveryLogs('any')).toEqual([])
  })
})

// ============================================================================
// ERROR TAXONOMY TESTS
// ============================================================================

describe('classifyError', () => {
  it('classifies SQLITE_BUSY as transient and retryable', () => {
    const c = classifyError(new Error('SQLITE_BUSY: database is locked'))
    expect(c.errorType).toBe('transient')
    expect(c.retryable).toBe(true)
    expect(c.maxRetries).toBe(3)
  })

  it('classifies ETIMEDOUT as transient', () => {
    const c = classifyError(new Error('ETIMEDOUT: request timed out'))
    expect(c.errorType).toBe('transient')
    expect(c.retryable).toBe(true)
  })

  it('classifies SQLITE_CORRUPT as permanent and non-retryable', () => {
    const c = classifyError(new Error('SQLITE_CORRUPT: database is corrupt'))
    expect(c.errorType).toBe('permanent')
    expect(c.retryable).toBe(false)
    expect(c.maxRetries).toBe(0)
  })

  it('classifies permission denied as permanent', () => {
    const c = classifyError(new Error('permission denied: /data/db'))
    expect(c.errorType).toBe('permanent')
    expect(c.retryable).toBe(false)
  })

  it('classifies rate limit errors as transient', () => {
    const c = classifyError(new Error('rate limit exceeded'))
    expect(c.errorType).toBe('transient')
  })

  it('classifies authentication errors as user_facing', () => {
    const c = classifyError(new Error('authentication failed'))
    expect(c.errorClass).toBe('user_facing')
  })

  it('classifies not found as user_facing', () => {
    const c = classifyError(new Error('not found'))
    expect(c.errorClass).toBe('user_facing')
  })

  it('classifies generic connection errors as internal', () => {
    const c = classifyError(new Error('ECONNRESET: connection reset by peer'))
    expect(c.errorClass).toBe('internal')
  })

  it('defaults to transient for unknown errors', () => {
    const c = classifyError(new Error('some completely unknown error'))
    expect(c.errorType).toBe('transient')
  })

  it('handles non-Error objects', () => {
    const c = classifyError('a plain string error')
    expect(c).toHaveProperty('errorType')
    expect(c).toHaveProperty('retryable')
  })

  it('returns immutable classification', () => {
    const c = classifyError(new Error('ECONNRESET'))
    expect(Object.isFrozen(c)).toBe(true)
  })
})

describe('safeErrorMessage', () => {
  it('returns raw message for user_facing errors', () => {
    const error = new Error('authentication failed: invalid token')
    const c = classifyError(error)
    const msg = safeErrorMessage(error, c)
    expect(msg).toBe('authentication failed: invalid token')
  })

  it('returns generic message for internal errors', () => {
    const error = new Error('ECONNRESET: socket hung up')
    const c = classifyError(error)
    const msg = safeErrorMessage(error, c)
    expect(msg).toContain('internal error')
    expect(msg).toContain('automatic recovery')
  })

  it('handles non-Error for user_facing', () => {
    const c = classifyError('not found: resource')
    const msg = safeErrorMessage('not found: resource', c)
    expect(typeof msg).toBe('string')
  })
})
