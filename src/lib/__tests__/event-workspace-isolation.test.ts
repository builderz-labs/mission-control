import { describe, expect, it } from 'vitest'
import { eventBelongsToWorkspace, type ServerEvent } from '@/lib/event-bus'

function event(data: unknown): ServerEvent {
  return { type: 'task.updated', data: data as Record<string, unknown>, timestamp: Date.now() }
}

describe('event workspace isolation', () => {
  it('accepts an event only for its explicit workspace owner', () => {
    expect(eventBelongsToWorkspace(event({ id: 7, workspace_id: 2 }), 2)).toBe(true)
    expect(eventBelongsToWorkspace(event({ id: 7, workspace_id: 2 }), 1)).toBe(false)
  })

  it('rejects events with missing or ambiguous workspace ownership', () => {
    expect(eventBelongsToWorkspace(event({ id: 7 }), 1)).toBe(false)
    expect(eventBelongsToWorkspace(event({ id: 7, workspace_id: '1' }), 1)).toBe(false)
    expect(eventBelongsToWorkspace(event(null), 1)).toBe(false)
  })
})
