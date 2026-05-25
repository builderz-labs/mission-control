import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  ECS_CALL_TIMEOUT_MS,
  UPSTREAM_ERROR_CODE,
  classifyEcsFailures,
  upstreamErrorBody,
  withTimeout,
} from '@/extensions/fleet/lib/aws-hardening'

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a non-aborted signal before the deadline', () => {
    const t = withTimeout(1_000)
    expect(t.signal.aborted).toBe(false)
    t.clear()
  })

  it('aborts the signal once the timeout elapses', () => {
    vi.useFakeTimers()
    const t = withTimeout(1_000)
    expect(t.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(t.signal.aborted).toBe(true)
  })

  it('clear() prevents a later abort of an already-settled signal', () => {
    vi.useFakeTimers()
    const t = withTimeout(1_000)
    t.clear()
    vi.advanceTimersByTime(5_000)
    expect(t.signal.aborted).toBe(false)
  })

  it('defaults to ECS_CALL_TIMEOUT_MS when no override is given', () => {
    vi.useFakeTimers()
    const t = withTimeout()
    vi.advanceTimersByTime(ECS_CALL_TIMEOUT_MS - 1)
    expect(t.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(t.signal.aborted).toBe(true)
  })
})

describe('upstreamErrorBody', () => {
  it('returns the stable generic code, never a raw AWS name', () => {
    expect(upstreamErrorBody()).toEqual({ error: UPSTREAM_ERROR_CODE })
    expect(UPSTREAM_ERROR_CODE).toBe('UpstreamServiceError')
  })
})

describe('classifyEcsFailures', () => {
  it('treats undefined / empty as no failures', () => {
    const c = classifyEcsFailures(undefined)
    expect(c.missing).toHaveLength(0)
    expect(c.hasNonMissing).toBe(false)
    expect(classifyEcsFailures([]).hasNonMissing).toBe(false)
  })

  it('classifies MISSING as not-found (no non-missing failures)', () => {
    const c = classifyEcsFailures([{ arn: 'a', reason: 'MISSING' }])
    expect(c.missing).toHaveLength(1)
    expect(c.denied).toHaveLength(0)
    expect(c.other).toHaveLength(0)
    expect(c.hasNonMissing).toBe(false)
  })

  it('classifies authorization reasons as denied (case-insensitive)', () => {
    const c = classifyEcsFailures([
      { arn: 'a', reason: 'ACCESS_DENIED' },
      { arn: 'b', reason: 'access denied' },
    ])
    expect(c.denied).toHaveLength(2)
    expect(c.hasNonMissing).toBe(true)
  })

  it('classifies an unknown non-MISSING reason as other → non-missing', () => {
    const c = classifyEcsFailures([{ arn: 'a', reason: 'THROTTLED' }])
    expect(c.other).toHaveLength(1)
    expect(c.hasNonMissing).toBe(true)
  })

  it('partitions a mixed batch', () => {
    const c = classifyEcsFailures([
      { arn: 'a', reason: 'MISSING' },
      { arn: 'b', reason: 'AccessDeniedException' },
      { arn: 'c', reason: 'SOME_OTHER' },
    ])
    expect(c.missing).toHaveLength(1)
    expect(c.denied).toHaveLength(1)
    expect(c.other).toHaveLength(1)
    expect(c.hasNonMissing).toBe(true)
  })
})
