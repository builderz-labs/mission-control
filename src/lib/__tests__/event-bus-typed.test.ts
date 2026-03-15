import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventType, EventDataMap } from '@/lib/event-bus'

// Reset singleton before each test
beforeEach(() => {
  const g = globalThis as typeof globalThis & { __eventBus?: unknown }
  delete g.__eventBus
})

describe('EventBus typed events', () => {
  it('broadcasts existing event types with typed data', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    const listener = vi.fn()
    eventBus.on('server-event', listener)

    eventBus.broadcast('task.created', { id: 1 })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.created',
        data: { id: 1 },
        timestamp: expect.any(Number),
      })
    )

    eventBus.removeListener('server-event', listener)
  })

  it('broadcasts workflow events with typed data', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    const listener = vi.fn()
    eventBus.on('server-event', listener)

    eventBus.broadcast('workflow.phase.transition', {
      runId: 1,
      fromPhase: 'design',
      toPhase: 'review',
    })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.phase.transition',
        data: { runId: 1, fromPhase: 'design', toPhase: 'review' },
      })
    )

    eventBus.removeListener('server-event', listener)
  })

  it('broadcasts debate events', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    const listener = vi.fn()
    eventBus.on('server-event', listener)

    eventBus.broadcast('debate.concluded', {
      debateId: 5,
      outcome: 'consensus',
      voteCount: { accept: 3, reject: 1 },
    })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'debate.concluded' })
    )

    eventBus.removeListener('server-event', listener)
  })

  it('broadcasts scaling events', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    const listener = vi.fn()
    eventBus.on('server-event', listener)

    eventBus.broadcast('scaling.hire.requested', {
      requestId: 'req-1',
      taskType: 'code-review',
      reason: 'queue depth exceeded threshold',
    })

    expect(listener).toHaveBeenCalled()
    eventBus.removeListener('server-event', listener)
  })

  it('broadcasts persona events', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    const listener = vi.fn()
    eventBus.on('server-event', listener)

    eventBus.broadcast('persona.emotional_state.changed', {
      agentId: 1,
      pleasure: 0.7,
      arousal: 0.3,
      dominance: 0.5,
    })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'persona.emotional_state.changed',
        data: { agentId: 1, pleasure: 0.7, arousal: 0.3, dominance: 0.5 },
      })
    )

    eventBus.removeListener('server-event', listener)
  })

  it('broadcasts spatial events', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    const listener = vi.fn()
    eventBus.on('server-event', listener)

    eventBus.broadcast('spatial.node.added', {
      nodeId: 'node-1',
      agentId: 42,
      agentName: 'orchestrator',
    })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'spatial.node.added',
        data: { nodeId: 'node-1', agentId: 42, agentName: 'orchestrator' },
      })
    )

    eventBus.removeListener('server-event', listener)
  })

  // Compile-time type test: verifies EventType includes all 6 new system events
  it('has all expected event type members', () => {
    const newEvents: EventType[] = [
      'spatial.node.added',
      'workflow.phase.transition',
      'chat.mention.routed',
      'debate.created',
      'persona.emotional_state.changed',
      'scaling.evaluation.triggered',
    ]
    expect(newEvents).toHaveLength(6)
  })
})
