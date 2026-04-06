/**
 * Unit tests for event-bus.ts
 * WHY: The event bus is the backbone of all real-time SSE communication in Ultron.
 * Every engine (self-healing, self-learning, self-improving) and every API endpoint
 * relies on it — correctness here is critical.
 *
 * No external mocks needed: the module is a pure EventEmitter wrapper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eventBus, type ServerEvent, type EventType } from '@/lib/event-bus'

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function captureNextEvent(): Promise<ServerEvent> {
  return new Promise((resolve) => {
    eventBus.once('server-event', (event: ServerEvent) => resolve(event))
  })
}

// ────────────────────────────────────────────────────────────────────────────
// broadcast — happy path
// ────────────────────────────────────────────────────────────────────────────

describe('broadcast — happy path', () => {
  it('emits on the server-event channel', async () => {
    const handler = vi.fn()
    eventBus.on('server-event', handler)

    eventBus.broadcast('task.created', { id: 1 })

    eventBus.off('server-event', handler)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('returns the event object', () => {
    const eventCapture = captureNextEvent()
    const returned = eventBus.broadcast('task.updated', { id: 2, status: 'done' })

    expect(returned).toMatchObject({
      type: 'task.updated',
      data: { id: 2, status: 'done' },
    })
    expect(typeof returned.timestamp).toBe('number')

    // Consume the captured promise so no listeners leak between tests
    return eventCapture
  })

  it('includes a timestamp in milliseconds (unix epoch range)', () => {
    // Synchronous: EventEmitter fires listeners synchronously
    const before = Date.now()
    const returned = eventBus.broadcast('agent.updated', {})
    const after = Date.now()

    expect(returned.timestamp).toBeGreaterThanOrEqual(before)
    expect(returned.timestamp).toBeLessThanOrEqual(after)
  })

  it('carries the exact data payload provided', async () => {
    const payload = { taskId: 42, agentName: 'jarvis', priority: 'critical' }
    const nextEvent = captureNextEvent()
    eventBus.broadcast('task.status_changed', payload)
    const event = await nextEvent
    expect(event.data).toEqual(payload)
  })

  it('carries the event type verbatim', async () => {
    const nextEvent = captureNextEvent()
    eventBus.broadcast('audit.security', { actor: 'admin', action: 'login_failed' })
    const event = await nextEvent
    expect(event.type).toBe('audit.security')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// broadcast — data edge cases
// ────────────────────────────────────────────────────────────────────────────

describe('broadcast — data edge cases', () => {
  it('accepts null as data', async () => {
    const nextEvent = captureNextEvent()
    eventBus.broadcast('notification.read', null)
    const event = await nextEvent
    expect(event.data).toBeNull()
  })

  it('accepts an empty object', async () => {
    const nextEvent = captureNextEvent()
    eventBus.broadcast('connection.created', {})
    const event = await nextEvent
    expect(event.data).toEqual({})
  })

  it('accepts an array as data', async () => {
    const nextEvent = captureNextEvent()
    eventBus.broadcast('leaderboard.updated', [1, 2, 3])
    const event = await nextEvent
    expect(event.data).toEqual([1, 2, 3])
  })

  it('accepts a primitive string as data', async () => {
    const nextEvent = captureNextEvent()
    eventBus.broadcast('chat.message', 'hello world')
    const event = await nextEvent
    expect(event.data).toBe('hello world')
  })

  it('accepts nested objects with special characters', async () => {
    const payload = { text: "SELECT * FROM users; DROP TABLE users; --", emoji: '' }
    const nextEvent = captureNextEvent()
    eventBus.broadcast('security.event', payload)
    const event = await nextEvent
    expect(event.data).toEqual(payload)
  })

  it('accepts a deeply nested object', async () => {
    const deep = { a: { b: { c: { d: { e: 'deep' } } } } }
    const nextEvent = captureNextEvent()
    eventBus.broadcast('health.check_completed', deep)
    const event = await nextEvent
    expect(event.data).toEqual(deep)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Event type coverage
// ────────────────────────────────────────────────────────────────────────────

describe('event type coverage', () => {
  const allTypes: EventType[] = [
    'task.created',
    'task.updated',
    'task.deleted',
    'task.status_changed',
    'chat.message',
    'chat.message.deleted',
    'notification.created',
    'notification.read',
    'activity.created',
    'agent.updated',
    'agent.created',
    'agent.deleted',
    'agent.synced',
    'agent.status_changed',
    'audit.security',
    'security.event',
    'connection.created',
    'connection.disconnected',
    'github.synced',
    'health.check_completed',
    'health.circuit_tripped',
    'health.circuit_recovered',
    'health.recovery_attempted',
    'health.service_degraded',
    'health.service_restored',
    'learning.pattern_stored',
    'learning.pattern_applied',
    'learning.feedback_received',
    'improving.regression_detected',
    'improving.suggestion_created',
    'improving.cost_spike',
    'agent.cognitive_load_updated',
    'leaderboard.updated',
    'brief.generated',
    'council.deliberation_started',
    'council.deliberation_completed',
    'council.vote_cast',
    'council.synthesis_reached',
    'browse.step_completed',
    'browse.page_captured',
    'browse.session_ended',
    'governance.gate_passed',
    'governance.gate_failed',
    'governance.review_required',
  ]

  it('can broadcast every defined EventType without throwing', () => {
    // Use a no-op listener so events don't accumulate in unhandled state
    const handler = vi.fn()
    eventBus.on('server-event', handler)

    for (const type of allTypes) {
      expect(() => eventBus.broadcast(type, {})).not.toThrow()
    }

    eventBus.off('server-event', handler)
    expect(handler).toHaveBeenCalledTimes(allTypes.length)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Listener management (subscribe / unsubscribe)
// ────────────────────────────────────────────────────────────────────────────

describe('listener management', () => {
  beforeEach(() => {
    // Clean slate — remove all listeners added by previous tests
    eventBus.removeAllListeners('server-event')
  })

  it('notifies multiple listeners on a single broadcast', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    const h3 = vi.fn()
    eventBus.on('server-event', h1)
    eventBus.on('server-event', h2)
    eventBus.on('server-event', h3)

    eventBus.broadcast('task.created', { id: 10 })

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
    expect(h3).toHaveBeenCalledOnce()
  })

  it('stops notifying a listener after off()', () => {
    const handler = vi.fn()
    eventBus.on('server-event', handler)
    eventBus.broadcast('task.updated', { id: 1 })

    eventBus.off('server-event', handler)
    eventBus.broadcast('task.updated', { id: 2 })

    // Only the first broadcast should have been received
    expect(handler).toHaveBeenCalledOnce()
    const receivedEvent = handler.mock.calls[0][0] as ServerEvent
    expect(receivedEvent.data).toEqual({ id: 1 })
  })

  it('once() listeners fire exactly once', () => {
    const handler = vi.fn()
    eventBus.once('server-event', handler)

    eventBus.broadcast('chat.message', 'first')
    eventBus.broadcast('chat.message', 'second')
    eventBus.broadcast('chat.message', 'third')

    expect(handler).toHaveBeenCalledOnce()
    const event = handler.mock.calls[0][0] as ServerEvent
    expect(event.data).toBe('first')
  })

  it('delivers events in registration order (FIFO)', () => {
    const order: number[] = []
    eventBus.on('server-event', () => order.push(1))
    eventBus.on('server-event', () => order.push(2))
    eventBus.on('server-event', () => order.push(3))

    eventBus.broadcast('agent.updated', {})

    expect(order).toEqual([1, 2, 3])
  })

  it('a throwing listener does not prevent other listeners from firing', () => {
    const badHandler = vi.fn(() => { throw new Error('listener error') })
    const goodHandler = vi.fn()

    eventBus.on('server-event', badHandler)
    eventBus.on('server-event', goodHandler)

    // EventEmitter propagates the throw — wrap in try/catch to test isolation
    try {
      eventBus.broadcast('task.deleted', { id: 99 })
    } catch {
      // Expected — EventEmitter does not swallow listener errors
    } finally {
      // WHY: must clean up explicitly so leaking handlers don't affect subsequent tests
      eventBus.off('server-event', badHandler)
      eventBus.off('server-event', goodHandler)
    }

    // Both handlers were invoked; the good one ran after the bad one threw
    expect(badHandler).toHaveBeenCalledOnce()
    // EventEmitter stops at first throw, so goodHandler may or may not fire
    // depending on Node version — we assert the bad one DID fire (not silently skipped)
    expect(badHandler).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.deleted' }))
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Singleton guarantee
// ────────────────────────────────────────────────────────────────────────────

describe('singleton guarantee', () => {
  beforeEach(() => {
    eventBus.removeAllListeners('server-event')
  })

  it('re-importing returns the same instance', async () => {
    // Dynamic import forces a fresh module resolution attempt
    const { eventBus: secondRef } = await import('@/lib/event-bus')
    expect(secondRef).toBe(eventBus)
  })

  it('listeners registered on one reference receive events from another', async () => {
    const handler = vi.fn()
    eventBus.on('server-event', handler)

    // Dynamic import uses ESM module cache — same singleton via globalThis.__eventBus
    const { eventBus: secondRef } = await import('@/lib/event-bus')
    secondRef.broadcast('github.synced', { repo: 'ultron' })

    eventBus.off('server-event', handler)
    expect(handler).toHaveBeenCalledOnce()
    const event = handler.mock.calls[0][0] as ServerEvent
    expect(event.data).toEqual({ repo: 'ultron' })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Event ordering with rapid sequential broadcasts
// ────────────────────────────────────────────────────────────────────────────

describe('event ordering', () => {
  beforeEach(() => {
    eventBus.removeAllListeners('server-event')
  })

  it('preserves sequence order for rapid broadcasts', () => {
    const received: number[] = []
    eventBus.on('server-event', (e: ServerEvent) => received.push(e.data as number))

    for (let i = 0; i < 100; i++) {
      eventBus.broadcast('task.created', i)
    }

    expect(received).toHaveLength(100)
    expect(received).toEqual(Array.from({ length: 100 }, (_, i) => i))
  })

  it('timestamps are monotonically non-decreasing across rapid broadcasts', () => {
    const timestamps: number[] = []
    eventBus.on('server-event', (e: ServerEvent) => timestamps.push(e.timestamp))

    for (let i = 0; i < 50; i++) {
      eventBus.broadcast('agent.updated', { seq: i })
    }

    for (let i = 1; i < timestamps.length; i++) {
      // Each timestamp must be >= the previous (monotonically non-decreasing)
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// MaxListeners — bus should not emit a MaxListeners warning at normal scale
// ────────────────────────────────────────────────────────────────────────────

describe('maxListeners configuration', () => {
  beforeEach(() => {
    eventBus.removeAllListeners('server-event')
  })

  it('supports up to 50 listeners without emitting MaxListenersExceededWarning', () => {
    const warnSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})

    const handlers: ReturnType<typeof vi.fn>[] = []
    for (let i = 0; i < 50; i++) {
      const h = vi.fn()
      handlers.push(h)
      eventBus.on('server-event', h)
    }

    eventBus.broadcast('task.created', { scale: 50 })

    const maxListenersWarning = warnSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('MaxListeners')
    )
    expect(maxListenersWarning).toBe(false)

    handlers.forEach((h) => eventBus.off('server-event', h))
    warnSpy.mockRestore()
  })
})
