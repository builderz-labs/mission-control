import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { getDatabase, db_helpers, logAuditEvent, closeDatabase } from '@/lib/db'
import {
  claimDispatch,
  recordExecutionProgress,
  submitExecutionResult,
  isOpenClawTask,
} from '@/lib/openclaw-runtime'
import { dispatchAssignedTasks } from '@/lib/task-dispatch'
import { eventBus } from '@/lib/event-bus'

// Mock eventBus to capture events
const mockBroadcast = vi.fn()
vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: vi.fn((...args) => mockBroadcast(...args)),
  },
}))

// Setup test database
process.env.MISSION_CONTROL_TEST_MODE = '1'
process.env.MISSION_CONTROL_DATA_DIR = '/tmp/mc-test-e2e-' + Date.now()

describe('OpenClaw Integration E2E', () => {
  let db: ReturnType<typeof getDatabase>
  let workspaceId: number
  let agentId: number
  let testId: string

  beforeEach(() => {
    db = getDatabase()
    mockBroadcast.mockClear()
    testId = `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`

    // Setup workspace with unique slug
    const workspaceResult = db
      .prepare("INSERT INTO workspaces (slug, name, tenant_id) VALUES (?, ?, ?)")
      .run(testId, `Test Workspace ${testId}`, 1)
    workspaceId = Number(workspaceResult.lastInsertRowid)

    // Setup agent with unique name
    const agentResult = db
      .prepare(
        "INSERT INTO agents (name, role, status, workspace_id, hidden) VALUES (?, ?, ?, ?, ?)"
      )
      .run(`openclaw-test-agent-${testId}`, 'coder', 'idle', workspaceId, 0)
    agentId = Number(agentResult.lastInsertRowid)
  })

  afterEach(() => {
    closeDatabase()
    mockBroadcast.mockClear()
  })

  describe('Complete OpenClaw task lifecycle', () => {
    it('should execute full flow: dispatch → claim → progress → submit → review', async () => {
      // ============================================================
      // Step 1: Create OpenClaw task with metadata.runtime_type
      // ============================================================
      const taskMetadata = {
        runtime_type: 'openclaw' as const,
        openclaw: {
          implementation_repo: 'test-org/test-repo',
          code_location: '/src/components',
          strategy: 'claim_then_execute' as const,
          auto_validate: true,
        },
      }

      const taskResult = db
        .prepare(
          `
          INSERT INTO tasks (title, description, status, priority, assigned_to, workspace_id, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          'Build landing page',
          'Create a responsive landing page with hero section',
          'assigned',
          'high',
          'openclaw-test-agent-' + testId,
          workspaceId,
          JSON.stringify(taskMetadata)
        )
      const taskId = Number(taskResult.lastInsertRowid)

      // Verify task is recognized as OpenClaw task
      const taskRow = db
        .prepare('SELECT metadata FROM tasks WHERE id = ?')
        .get(taskId) as { metadata: string }
      const parsedMetadata = JSON.parse(taskRow.metadata)
      expect(isOpenClawTask(parsedMetadata)).toBe(true)

      // ============================================================
      // Step 2: Dispatch task (scheduler creates run + claim)
      // ============================================================
      const dispatchResult = await dispatchAssignedTasks()
      expect(dispatchResult.ok).toBe(true)
      expect(dispatchResult.message).toContain('Dispatched')

      // Verify task is now in_progress
      const dispatchedTask = db
        .prepare('SELECT status, metadata FROM tasks WHERE id = ?')
        .get(taskId) as { status: string; metadata: string }
      expect(dispatchedTask.status).toBe('in_progress')

      // Verify metadata was updated with dispatch_id and run_id
      const updatedMetadata = JSON.parse(dispatchedTask.metadata)
      expect(updatedMetadata.openclaw.dispatch_id).toBeDefined()
      expect(updatedMetadata.openclaw.run_id).toBeDefined()

      const dispatchId = updatedMetadata.openclaw.dispatch_id
      const runId = updatedMetadata.openclaw.run_id

      // Verify event was broadcast
      const statusChangeEvent = mockBroadcast.mock.calls.find(
        (call) => call[0] === 'task.status_changed' && call[1].id === taskId
      )
      expect(statusChangeEvent).toBeDefined()
      expect(statusChangeEvent![1].status).toBe('in_progress')
      expect(statusChangeEvent![1].reason).toBe('openclaw_dispatched')

      // ============================================================
      // Step 3: Verify dispatch was created by scheduler
      // (In real scenario, runtime would claim with its own session)
      // For test, we use the run_id returned from dispatch
      // The claim was already done by dispatchOpenClawTask with 'pending' session
      // ============================================================
      expect(runId).toBeDefined()
      expect(dispatchId).toBe(taskId)

      // ============================================================
      // Step 4: Report progress (multiple updates)
      // ============================================================
      const progressUpdates = [25, 50, 75, 100]
      for (const progress of progressUpdates) {
        recordExecutionProgress(db, {
          runId,
          progress,
          message: `Processing step ${progress / 25}`,
          metrics: { steps_completed: progress / 25, total_steps: 4 },
          runtimeNodeId: 'node-1',
          runtimeSessionId: 'session-abc-123',
          workspaceId,
          actor: 'openclaw-runtime',
        })

        // Verify run.updated event was broadcast
        const runUpdatedEvent = mockBroadcast.mock.calls.find(
          (call) =>
            call[0] === 'run.updated' &&
            call[1].run_id === runId &&
            call[1].progress === progress
        )
        expect(runUpdatedEvent).toBeDefined()
        expect(runUpdatedEvent![1].source).toBe('openclaw')
      }

      // Verify task.updated event at 20% intervals (20, 40, 60, 80, 100)
      // Our progress updates: 25, 50, 75, 100
      // 25% should trigger (25 % 20 === 5, not 0) - wait, 25 % 20 = 5, not triggered
      // 50 % 20 = 10, not triggered
      // So actually only 100 would trigger? Let me check the logic again
      // Actually the code checks `input.progress % 20 === 0`
      // 25 % 20 = 5, 50 % 20 = 10, 75 % 20 = 15, 100 % 20 = 0
      // So only 100 should trigger task.updated

      // ============================================================
      // Step 5: Submit successful result
      // ============================================================
      const submitResult = submitExecutionResult(db, {
        runId,
        status: 'completed',
        outcome: 'success',
        result: {
          summary: 'Landing page created successfully',
          files_created: ['src/components/Hero.tsx', 'src/components/LandingPage.tsx'],
        },
        artifacts: [
          { type: 'file', name: 'Hero.tsx', path: '/src/components/Hero.tsx' },
          { type: 'file', name: 'LandingPage.tsx', path: '/src/components/LandingPage.tsx' },
        ],
        logs: [
          { level: 'info', message: 'Starting task execution', timestamp: Date.now() },
          { level: 'info', message: 'Creating Hero component', timestamp: Date.now() },
          { level: 'info', message: 'Task completed', timestamp: Date.now() },
        ],
        runtimeNodeId: 'node-1',
        runtimeSessionId: 'session-abc-123',
        auto_validate: true,
        workspaceId,
        actor: 'openclaw-runtime',
      })

      expect(submitResult.status).toBe('completed')
      expect(submitResult.outcome).toBe('success')
      expect(submitResult.eval_result).toBeDefined()
      expect(submitResult.eval_result?.pass).toBe(true)
      expect(submitResult.eval_result?.score).toBe(1.0)

      // ============================================================
      // Step 6: Verify task status transitioned to review
      // ============================================================
      const finalTask = db
        .prepare('SELECT status, outcome, resolution, metadata FROM tasks WHERE id = ?')
        .get(taskId) as { status: string; outcome: string; resolution: string; metadata: string }

      expect(finalTask.status).toBe('review')
      expect(finalTask.outcome).toBe('success')
      expect(finalTask.resolution).toContain('**Execution Result**')
      expect(finalTask.resolution).toContain('Landing page created')
      expect(finalTask.resolution).toContain('**Artifacts:** 2')
      expect(finalTask.resolution).toContain('**Auto Validation:**')
      expect(finalTask.resolution).toContain('Pass: yes')

      // Verify status change event
      const finalStatusEvent = mockBroadcast.mock.calls.find(
        (call) =>
          call[0] === 'task.status_changed' &&
          call[1].id === taskId &&
          call[1].status === 'review'
      )
      expect(finalStatusEvent).toBeDefined()
      expect(finalStatusEvent![1].reason).toBe('openclaw_execution_complete')

      // Verify comment was added
      const comments = db
        .prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at DESC')
        .all(taskId) as Array<{ author: string; content: string }>

      expect(comments.length).toBeGreaterThan(0)
      expect(comments[0].author).toBe('openclaw-test-agent-' + testId)
      expect(comments[0].content).toContain('Execution Result')

      // Verify activity was logged
      const activities = db
        .prepare('SELECT * FROM activities WHERE entity_id = ? AND type LIKE ?')
        .all(taskId, '%openclaw%') as Array<{ type: string; description: string }>

      const completionActivity = activities.find((a) =>
        a.type.includes('openclaw_task_completed')
      )
      expect(completionActivity).toBeDefined()
    })

    it('should handle failed execution with retry logic', async () => {
      // ============================================================
      // Step 1: Create OpenClaw task
      // ============================================================
      const taskMetadata = {
        runtime_type: 'openclaw' as const,
        openclaw: {
          strategy: 'claim_then_execute' as const,
        },
      }

      const taskResult = db
        .prepare(
          `
          INSERT INTO tasks (title, description, status, priority, assigned_to, workspace_id, metadata, dispatch_attempts)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          'Build feature X',
          'Create feature X',
          'assigned',
          'medium',
          'openclaw-test-agent-' + testId,
          workspaceId,
          JSON.stringify(taskMetadata),
          0
        )
      const taskId = Number(taskResult.lastInsertRowid)

      // ============================================================
      // Step 2: First dispatch attempt
      // ============================================================
      await dispatchAssignedTasks()

      const taskAfterDispatch = db
        .prepare('SELECT metadata FROM tasks WHERE id = ?')
        .get(taskId) as { metadata: string }
      const metadata1 = JSON.parse(taskAfterDispatch.metadata)
      const runId1 = metadata1.openclaw.run_id

      // Submit failure
      submitExecutionResult(db, {
        runId: runId1,
        status: 'failed',
        outcome: 'error',
        error: 'Network timeout during build',
        workspaceId,
        actor: 'openclaw-runtime',
      })

      // Verify task requeued to assigned with retry count
      const taskAfterFailure1 = db
        .prepare('SELECT status, dispatch_attempts, error_message FROM tasks WHERE id = ?')
        .get(taskId) as { status: string; dispatch_attempts: number; error_message: string }

      expect(taskAfterFailure1.status).toBe('assigned')
      expect(taskAfterFailure1.dispatch_attempts).toBe(1)
      expect(taskAfterFailure1.error_message).toContain('Will retry')

      // ============================================================
      // Step 3: Second dispatch attempt
      // ============================================================
      await dispatchAssignedTasks()

      const taskAfterDispatch2 = db
        .prepare('SELECT metadata FROM tasks WHERE id = ?')
        .get(taskId) as { metadata: string }
      const metadata2 = JSON.parse(taskAfterDispatch2.metadata)
      const runId2 = metadata2.openclaw.run_id

      expect(runId2).not.toBe(runId1) // Should be a new run

      // Submit another failure
      submitExecutionResult(db, {
        runId: runId2,
        status: 'failed',
        outcome: 'error',
        error: 'Build failed again',
        workspaceId,
        actor: 'openclaw-runtime',
      })

      const taskAfterFailure2 = db
        .prepare('SELECT status, dispatch_attempts FROM tasks WHERE id = ?')
        .get(taskId) as { status: string; dispatch_attempts: number }

      expect(taskAfterFailure2.status).toBe('assigned')
      expect(taskAfterFailure2.dispatch_attempts).toBe(2)

      // ============================================================
      // Step 4: Third dispatch attempt (final)
      // ============================================================
      await dispatchAssignedTasks()

      const taskAfterDispatch3 = db
        .prepare('SELECT metadata FROM tasks WHERE id = ?')
        .get(taskId) as { metadata: string }
      const metadata3 = JSON.parse(taskAfterDispatch3.metadata)
      const runId3 = metadata3.openclaw.run_id

      // Submit third failure - should move to failed
      submitExecutionResult(db, {
        runId: runId3,
        status: 'failed',
        outcome: 'error',
        error: 'Final attempt failed',
        workspaceId,
        actor: 'openclaw-runtime',
      })

      // After 3 failures, task should be in failed status
      const taskAfterFinalFailure = db
        .prepare('SELECT status, outcome, dispatch_attempts FROM tasks WHERE id = ?')
        .get(taskId) as { status: string; outcome: string; dispatch_attempts: number }

      expect(taskAfterFinalFailure.status).toBe('failed')
      expect(taskAfterFinalFailure.outcome).toBe('failed')
      expect(taskAfterFinalFailure.dispatch_attempts).toBe(3)
    })

    it('should handle cancelled execution', async () => {
      const taskMetadata = {
        runtime_type: 'openclaw' as const,
      }

      const taskResult = db
        .prepare(
          `
          INSERT INTO tasks (title, description, status, priority, assigned_to, workspace_id, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          'Build feature Y',
          'Create feature Y',
          'assigned',
          'low',
          'openclaw-test-agent-' + testId,
          workspaceId,
          JSON.stringify(taskMetadata)
        )
      const taskId = Number(taskResult.lastInsertRowid)

      // Dispatch
      await dispatchAssignedTasks()

      const taskAfterDispatch = db
        .prepare('SELECT metadata FROM tasks WHERE id = ?')
        .get(taskId) as { metadata: string }
      const metadata = JSON.parse(taskAfterDispatch.metadata)
      const runId = metadata.openclaw.run_id

      // Submit cancelled
      submitExecutionResult(db, {
        runId,
        status: 'cancelled',
        outcome: 'cancelled',
        workspaceId,
        actor: 'openclaw-runtime',
      })

      // Should be requeued (same as failed)
      const taskAfterCancel = db
        .prepare('SELECT status, dispatch_attempts FROM tasks WHERE id = ?')
        .get(taskId) as { status: string; dispatch_attempts: number }

      expect(taskAfterCancel.status).toBe('assigned')
      expect(taskAfterCancel.dispatch_attempts).toBe(1)
    })
  })

  describe('isOpenClawTask helper', () => {
    it('should return true for valid OpenClaw metadata', () => {
      expect(isOpenClawTask({ runtime_type: 'openclaw' })).toBe(true)
      expect(
        isOpenClawTask({
          runtime_type: 'openclaw',
          openclaw: { strategy: 'claim_then_execute' },
        })
      ).toBe(true)
    })

    it('should return false for non-OpenClaw metadata', () => {
      expect(isOpenClawTask({})).toBe(false)
      expect(isOpenClawTask({ runtime_type: 'other' })).toBe(false)
      expect(isOpenClawTask(null)).toBe(false)
      expect(isOpenClawTask(undefined)).toBe(false)
    })
  })
})
