import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reset the singleton before each test
beforeEach(() => {
  const g = globalThis as typeof globalThis & { __eventBus?: unknown }
  delete g.__eventBus
})

describe('event-bus', () => {
  it('eventBus is a singleton', async () => {
    const mod1 = await import('../event-bus')
    expect(mod1.eventBus).toBeDefined()
    expect(typeof mod1.eventBus.broadcast).toBe('function')
  })

  it('broadcast emits a server-event', async () => {
    const { eventBus } = await import('../event-bus')
    const handler = vi.fn()
    eventBus.on('server-event', handler)

    const result = eventBus.broadcast('task.created', { id: 1 })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(result)
    expect(result).toMatchObject({
      type: 'task.created',
      data: { id: 1 },
    })
    expect(typeof result.timestamp).toBe('number')

    eventBus.removeListener('server-event', handler)
  })

  it('broadcast delivers to multiple listeners', async () => {
    const { eventBus } = await import('../event-bus')
    const h1 = vi.fn()
    const h2 = vi.fn()
    eventBus.on('server-event', h1)
    eventBus.on('server-event', h2)

    eventBus.broadcast('agent.updated', { name: 'test' })

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()

    eventBus.removeListener('server-event', h1)
    eventBus.removeListener('server-event', h2)
  })
})
