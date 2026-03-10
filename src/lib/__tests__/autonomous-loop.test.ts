import { describe, expect, it } from 'vitest'
import {
  buildDebateNote,
  buildThirtyMinuteTaskReview,
  decideOrchestratorRecovery,
  planAutoSpawnForBacklog,
} from '@/lib/autonomous-loop'

describe('autonomous loop helpers', () => {
  it('plans auto-spawn against backlog and remaining capacity', () => {
    expect(planAutoSpawnForBacklog({
      backlog: 7,
      activeAgents: 1,
      autoSpawnedAgents: 0,
      maxAutoSpawnAgents: 3,
      tasksPerAgent: 2,
    })).toBe(3)

    expect(planAutoSpawnForBacklog({
      backlog: 2,
      activeAgents: 2,
      autoSpawnedAgents: 1,
      maxAutoSpawnAgents: 1,
      tasksPerAgent: 2,
    })).toBe(0)
  })

  it('builds a compact debate note with a concrete blocker', () => {
    const note = buildDebateNote({
      title: 'Add users tab',
      status: 'quality_review',
      blocker: 'Verification found no changed files in admin UI.',
      round: 2,
    })

    expect(note).toContain('Agent Debate Round 2')
    expect(note).toContain('Verification found no changed files in admin UI.')
    expect(note).toContain('smallest viable context slice')
  })

  it('retries the same agent first when the failure is a verification miss', () => {
    const decision = decideOrchestratorRecovery({
      title: 'Add users tab',
      status: 'in_progress',
      failureCount: 1,
      blocker: 'Verification found no changed files in admin UI.',
      lastAgent: 'AutoWorker1',
      lastExitCode: 0,
    })

    expect(decision.strategy).toBe('retry_same_agent')
    expect(decision.preferredAgent).toBe('AutoWorker1')
    expect(decision.summary).toContain('retry AutoWorker1')
  })

  it('reroutes to another agent after repeated or runtime failures', () => {
    const decision = decideOrchestratorRecovery({
      title: 'Add users tab',
      status: 'in_progress',
      failureCount: 2,
      blocker: 'Agent crashed with exception',
      lastAgent: 'AutoWorker1',
      lastExitCode: 1,
    })

    expect(decision.strategy).toBe('reroute_agent')
    expect(decision.avoidAgent).toBe('AutoWorker1')
    expect(decision.summary).toContain('reroute')
  })

  it('builds the 30-minute wait review for normal reviewer activity', () => {
    const review = buildThirtyMinuteTaskReview({
      status: 'review',
      elapsedSeconds: 31 * 60,
      failureCount: 0,
    })

    expect(review.kind).toBe('wait')
    expect(review.waitMinutes).toBe(15)
    expect(review.summary).toContain('wait for "15" minute')
  })

  it('builds the 30-minute bug restart review for runtime crashes', () => {
    const review = buildThirtyMinuteTaskReview({
      status: 'in_progress',
      elapsedSeconds: 40 * 60,
      failureCount: 3,
      blocker: 'Unhandled exception in worker runtime',
      lastExitCode: 1,
    })

    expect(review.kind).toBe('bug_restart')
    expect(review.shouldRestart).toBe(true)
    expect(review.summary).toContain('it will be restart')
  })
})
