import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

let db: InstanceType<typeof Database>

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

describe('handoff briefs', () => {
  it('creates a brief and round-trips array/object fields', async () => {
    const { createHandoffBrief } = await import('@/lib/handoffs')
    const brief = createHandoffBrief({
      from_agent: 'hermes',
      to_agent: 'claude-code',
      task_summary: 'Ship the handoff feature',
      decisions_made: ['use a dedicated table over reusing runs.steps'],
      next_steps: ['wire the SessionStart hook'],
      open_questions: ['does the hook need retries?'],
      refs: ['src/lib/handoffs.ts'],
    })

    expect(brief.id).toBeTruthy()
    expect(brief.from_agent).toBe('hermes')
    expect(brief.to_agent).toBe('claude-code')
    expect(brief.decisions_made).toEqual(['use a dedicated table over reusing runs.steps'])
    expect(brief.next_steps).toEqual(['wire the SessionStart hook'])
    expect(brief.consumed_at).toBeNull()
  })

  it('returns the latest unconsumed brief for an agent, newest first', async () => {
    const { createHandoffBrief, getLatestHandoffForAgent } = await import('@/lib/handoffs')

    createHandoffBrief({ from_agent: 'hermes', to_agent: 'claude-code', task_summary: 'first' })
    // SQLite unixepoch() has 1s resolution; force ordering explicitly rather than sleeping.
    db.prepare(`UPDATE handoff_briefs SET created_at = created_at - 10`).run()
    const second = createHandoffBrief({ from_agent: 'hermes', to_agent: 'claude-code', task_summary: 'second' })

    const latest = getLatestHandoffForAgent('claude-code')
    expect(latest?.id).toBe(second.id)
    expect(latest?.task_summary).toBe('second')
  })

  it('excludes consumed briefs from getLatestHandoffForAgent', async () => {
    const { createHandoffBrief, getLatestHandoffForAgent, markHandoffConsumed } = await import('@/lib/handoffs')

    const brief = createHandoffBrief({ from_agent: 'hermes', to_agent: 'claude-code', task_summary: 'only one' })
    expect(getLatestHandoffForAgent('claude-code')).not.toBeNull()

    markHandoffConsumed(brief.id, 'claude-code')
    expect(getLatestHandoffForAgent('claude-code')).toBeNull()
  })

  it('scopes latest-brief lookup by task_id when given', async () => {
    const { createHandoffBrief, getLatestHandoffForAgent } = await import('@/lib/handoffs')

    createHandoffBrief({ from_agent: 'hermes', to_agent: 'claude-code', task_summary: 'task 1', task_id: 1 })
    createHandoffBrief({ from_agent: 'hermes', to_agent: 'claude-code', task_summary: 'task 2', task_id: 2 })

    const forTask1 = getLatestHandoffForAgent('claude-code', { taskId: 1 })
    expect(forTask1?.task_summary).toBe('task 1')
  })

  it('markHandoffConsumed is idempotent and keeps the original consumer', async () => {
    const { createHandoffBrief, markHandoffConsumed } = await import('@/lib/handoffs')

    const brief = createHandoffBrief({ from_agent: 'hermes', to_agent: 'claude-code', task_summary: 'x' })
    const first = markHandoffConsumed(brief.id, 'claude-code')
    const second = markHandoffConsumed(brief.id, 'someone-else')

    expect(first?.consumed_by).toBe('claude-code')
    expect(second?.consumed_by).toBe('claude-code')
  })

  it('lists briefs scoped by workspace and filters', async () => {
    const { createHandoffBrief, listHandoffBriefs } = await import('@/lib/handoffs')

    createHandoffBrief({ from_agent: 'hermes', to_agent: 'claude-code', task_summary: 'a' }, 1)
    createHandoffBrief({ from_agent: 'claude-code', to_agent: 'hermes', task_summary: 'b' }, 1)

    const { briefs, total } = listHandoffBriefs({ toAgent: 'claude-code', workspaceId: 1 })
    expect(total).toBe(1)
    expect(briefs[0].task_summary).toBe('a')
  })
})
