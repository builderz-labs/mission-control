import { describe, expect, it } from 'vitest'
import { flyJobsComplete, jobsForSession } from '@/lib/chat-fly-jobs'
import type { FlyActivityJob } from '@/lib/fly-activity'

function job(partial: Partial<FlyActivityJob> & Pick<FlyActivityJob, 'id' | 'session_id'>): FlyActivityJob {
  return {
    task_id: 1,
    title: 'Lint',
    state: 'succeeded',
    swarm_id: null,
    machine_id: null,
    image_kind: 'core-performance',
    runtime_seconds: 1,
    observed_cost_usd: 0,
    estimated_cost_usd: 0,
    cpu_percent: null,
    memory_bytes: null,
    heartbeat_at: null,
    ...partial,
  }
}

describe('jobsForSession', () => {
  it('nests Fly jobs under the launching chat session', () => {
    const jobs = [
      job({ id: 'a', session_id: 'grok-mc-audit', title: 'lint' }),
      job({ id: 'b', session_id: 'other', title: 'test' }),
    ]
    expect(jobsForSession(jobs, 'session:grok:grok-mc-audit')).toEqual([
      { id: 'a', title: 'lint', state: 'succeeded' },
    ])
  })

  it('treats a nest as complete only when every worker finished', () => {
    expect(flyJobsComplete([{ id: 'a', title: 'lint', state: 'succeeded' }])).toBe(true)
    expect(flyJobsComplete([{ id: 'a', title: 'lint', state: 'running' }])).toBe(false)
    expect(flyJobsComplete([])).toBe(false)
  })
})
