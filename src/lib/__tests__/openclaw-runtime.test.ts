import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import {
  buildExecutionSnapshot,
  claimDispatch,
  getExecutionSnapshotForAgent,
  getDispatchTaskOrThrow,
  OpenClawRuntimeError,
} from '@/lib/openclaw-runtime'

function createDb() {
  const db = new Database(':memory:')
  runMigrations(db)
  return db
}

function seedTask(db: Database.Database, overrides: Partial<Record<string, unknown>> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const task = {
    id: 7,
    title: 'Build landing page',
    description: 'Implement the first OpenClaw MVP slice',
    status: 'assigned',
    priority: 'high',
    assigned_to: 'openclaw-builder',
    created_by: 'system',
    created_at: now,
    updated_at: now,
    tags: '[]',
    metadata: JSON.stringify({
      implementation_repo: 'builderz-labs/mission-control',
      code_location: '/src/app',
      extra: 'value',
    }),
    workspace_id: 1,
    ...overrides,
  }

  db.prepare(`
    INSERT INTO tasks (
      id, title, description, status, priority, assigned_to,
      created_by, created_at, updated_at, tags, metadata, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.title,
    task.description,
    task.status,
    task.priority,
    task.assigned_to,
    task.created_by,
    task.created_at,
    task.updated_at,
    task.tags,
    task.metadata,
    task.workspace_id,
  )

  return task
}

describe('openclaw-runtime', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb()
  })

  it('builds execution snapshots from task metadata', () => {
    const task = seedTask(db)
    const taskRow = getDispatchTaskOrThrow(db, Number(task.id), 1)

    expect(buildExecutionSnapshot(taskRow, 7)).toEqual({
      dispatch_id: 7,
      task_id: 7,
      title: 'Build landing page',
      description: 'Implement the first OpenClaw MVP slice',
      status: 'assigned',
      priority: 'high',
      assigned_to: 'openclaw-builder',
      metadata: {
        implementation_repo: 'builderz-labs/mission-control',
        code_location: '/src/app',
        extra: 'value',
      },
      implementation_repo: 'builderz-labs/mission-control',
      code_location: '/src/app',
    })
  })

  it('creates claim and snapshot on first claim', () => {
    seedTask(db)

    const result = claimDispatch(db, {
      dispatchId: 7,
      agentId: 'openclaw-node-01',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      capabilityTags: ['builder', 'frontend'],
      workspaceId: 1,
      actor: 'operator',
      actorId: 11,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    })

    expect(result.dispatch_id).toBe(7)
    expect(result.task_id).toBe(7)
    expect(result.dispatch_status).toBe('acked')
    expect(result.snapshot_hash).toMatch(/^[a-f0-9]{64}$/)

    const claim = db.prepare('SELECT * FROM openclaw_dispatch_claims WHERE dispatch_id = ? AND workspace_id = ?').get(7, 1) as any
    expect(claim.agent_id).toBe('openclaw-node-01')
    expect(claim.runtime_session_id).toBe('session-1')

    const snapshot = db.prepare('SELECT * FROM openclaw_execution_snapshots WHERE dispatch_id = ? AND workspace_id = ?').get(7, 1) as any
    expect(JSON.parse(snapshot.snapshot_json)).toMatchObject({
      dispatch_id: 7,
      task_id: 7,
      implementation_repo: 'builderz-labs/mission-control',
    })
  })

  it('returns same result for idempotent claim', () => {
    seedTask(db)

    const first = claimDispatch(db, {
      dispatchId: 7,
      agentId: 'openclaw-node-01',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      capabilityTags: ['builder'],
      workspaceId: 1,
      actor: 'operator',
    })

    const second = claimDispatch(db, {
      dispatchId: 7,
      agentId: 'openclaw-node-01',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      capabilityTags: ['builder'],
      workspaceId: 1,
      actor: 'operator',
    })

    expect(second).toEqual(first)
  })

  it('rejects claim from another agent session', () => {
    seedTask(db)
    claimDispatch(db, {
      dispatchId: 7,
      agentId: 'openclaw-node-01',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      capabilityTags: ['builder'],
      workspaceId: 1,
      actor: 'operator',
    })

    expect(() =>
      claimDispatch(db, {
        dispatchId: 7,
        agentId: 'openclaw-node-02',
        runtimeNodeId: 'node-b',
        runtimeSessionId: 'session-2',
        capabilityTags: ['builder'],
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)

    try {
      claimDispatch(db, {
        dispatchId: 7,
        agentId: 'openclaw-node-02',
        runtimeNodeId: 'node-b',
        runtimeSessionId: 'session-2',
        capabilityTags: ['builder'],
        workspaceId: 1,
        actor: 'operator',
      })
    } catch (error) {
      expect((error as OpenClawRuntimeError).code).toBe('DISPATCH_ALREADY_CLAIMED')
    }
  })

  it('returns snapshot only to owning agent session', () => {
    seedTask(db)
    claimDispatch(db, {
      dispatchId: 7,
      agentId: 'openclaw-node-01',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      capabilityTags: ['builder'],
      workspaceId: 1,
      actor: 'operator',
    })

    expect(
      getExecutionSnapshotForAgent(db, {
        dispatchId: 7,
        agentId: 'openclaw-node-01',
        runtimeSessionId: 'session-1',
        workspaceId: 1,
      })
    ).toMatchObject({
      dispatch_id: 7,
      task_id: 7,
      implementation_repo: 'builderz-labs/mission-control',
    })

    expect(() =>
      getExecutionSnapshotForAgent(db, {
        dispatchId: 7,
        agentId: 'openclaw-node-02',
        runtimeSessionId: 'session-2',
        workspaceId: 1,
      })
    ).toThrowError(OpenClawRuntimeError)
  })
})
