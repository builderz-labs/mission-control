import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import {
  buildExecutionSnapshot,
  cancelExecution,
  claimDispatch,
  getExecutionSnapshotForAgent,
  getDispatchTaskOrThrow,
  OpenClawRuntimeError,
  recordOpenClawHeartbeat,
  recordExecutionProgress,
  submitExecutionResult,
} from '@/lib/openclaw-runtime'

// Mock runs module to use test database
const mockGetRun = vi.fn()
const mockUpdateRun = vi.fn()
const mockCreateRun = vi.fn()

vi.mock('@/lib/runs', () => ({
  getRun: () => mockGetRun(),
  updateRun: (id: string, updates: any, wsId: number) => mockUpdateRun(id, updates, wsId),
  createRun: (run: any, wsId?: number) => mockCreateRun(run, wsId),
  getDatabase: vi.fn(),
}))

// Set default mock implementation
mockCreateRun.mockImplementation((run: any) => ({ ...run, id: 'run-abc-123' }))

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

function seedAgent(db: Database.Database, overrides: Partial<Record<string, unknown>> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const agent = {
    id: 11,
    name: 'openclaw-node-01',
    role: 'agent',
    status: 'idle',
    last_seen: now - 100,
    last_activity: 'waiting',
    created_at: now,
    updated_at: now,
    workspace_id: 1,
    ...overrides,
  }

  db.prepare(`
    INSERT INTO agents (id, name, role, status, last_seen, last_activity, created_at, updated_at, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.id,
    agent.name,
    agent.role,
    agent.status,
    agent.last_seen,
    agent.last_activity,
    agent.created_at,
    agent.updated_at,
    agent.workspace_id,
  )

  return agent
}

function seedRun(db: Database.Database, overrides: Partial<Record<string, unknown>> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const run = {
    id: 'run-1',
    agent_id: 'openclaw-node-01',
    agent_name: 'openclaw-node-01',
    status: 'running',
    outcome: null,
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_ms: null,
    steps: '[]',
    tools_available: '[]',
    cost_input_tokens: 0,
    cost_output_tokens: 0,
    workspace_id: 1,
    metadata: JSON.stringify({ openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } }),
    ...overrides,
  }

  db.prepare(`
    INSERT INTO runs (
      id, agent_id, agent_name, status, outcome, started_at, ended_at, duration_ms,
      steps, tools_available, cost_input_tokens, cost_output_tokens, workspace_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.agent_id,
    run.agent_name,
    run.status,
    run.outcome,
    run.started_at,
    run.ended_at,
    run.duration_ms,
    run.steps,
    run.tools_available,
    run.cost_input_tokens,
    run.cost_output_tokens,
    run.workspace_id,
    run.metadata,
  )

  return run
}

describe('openclaw-runtime', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb()
    vi.clearAllMocks()
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
    mockCreateRun.mockReturnValue({ id: 'run-abc-123' })

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
    expect(result.run_id).toBe('run-abc-123')
    expect(mockCreateRun).toHaveBeenCalled()

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
    mockCreateRun.mockReturnValue({ id: 'run-abc-123' })

    const first = claimDispatch(db, {
      dispatchId: 7,
      agentId: 'openclaw-node-01',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      capabilityTags: ['builder'],
      workspaceId: 1,
      actor: 'operator',
    })

    // For idempotent call, mock the run lookup
    mockCreateRun.mockClear()
    db.prepare(`
      INSERT INTO runs (id, agent_id, status, started_at, steps, cost_input_tokens, cost_output_tokens, workspace_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-abc-123', 'openclaw-node-01', 'running', new Date().toISOString(), '[]', 0, 0, 1, JSON.stringify({ openclaw: { dispatch_id: 7 } }))

    const second = claimDispatch(db, {
      dispatchId: 7,
      agentId: 'openclaw-node-01',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      capabilityTags: ['builder'],
      workspaceId: 1,
      actor: 'operator',
    })

    expect(second.dispatch_id).toEqual(first.dispatch_id)
    expect(second.task_id).toEqual(first.task_id)
    expect(second.run_id).toBe('run-abc-123')
    expect(mockCreateRun).not.toHaveBeenCalled() // Should not create new run on idempotent call
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

  it('records heartbeat for existing agent', () => {
    seedAgent(db)

    const result = recordOpenClawHeartbeat(db, {
      agentId: 'openclaw-node-01',
      runtimeType: 'openclaw',
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      nodeStatus: 'busy',
      currentLoad: 2,
      maxConcurrency: 4,
      queueLag: 1,
      capabilityTags: ['builder', 'builder'],
      metadata: { region: 'us-east-1' },
      workspaceId: 1,
      actor: 'operator',
      actorId: 11,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    })

    expect(result.accepted).toBe(true)
    expect(result.server_time).toBeTypeOf('number')

    const agent = db.prepare('SELECT status, last_activity FROM agents WHERE name = ? AND workspace_id = ?').get('openclaw-node-01', 1) as any
    expect(agent.status).toBe('busy')
    expect(agent.last_activity).toContain('OpenClaw heartbeat')

    const activity = db.prepare('SELECT * FROM activities WHERE type = ? AND workspace_id = ? ORDER BY id DESC LIMIT 1').get('openclaw_heartbeat', 1) as any
    expect(activity.entity_type).toBe('agent')
    expect(activity.actor).toBe('openclaw-node-01')
    expect(JSON.parse(activity.data)).toMatchObject({
      runtime_type: 'openclaw',
      runtime_node_id: 'node-a',
      runtime_session_id: 'session-1',
      node_status: 'busy',
      capability_tags: ['builder'],
    })

    const audit = db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get('openclaw_heartbeat') as any
    expect(audit.actor).toBe('operator')
    expect(JSON.parse(audit.detail)).toMatchObject({
      agent_id: 'openclaw-node-01',
      runtime_type: 'openclaw',
      runtime_node_id: 'node-a',
    })
  })

  it('rejects heartbeat for unknown agent', () => {
    expect(() =>
      recordOpenClawHeartbeat(db, {
        agentId: 'missing-node',
        runtimeNodeId: 'node-a',
        runtimeSessionId: 'session-1',
        nodeStatus: 'online',
        capabilityTags: [],
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)

    try {
      recordOpenClawHeartbeat(db, {
        agentId: 'missing-node',
        runtimeNodeId: 'node-a',
        runtimeSessionId: 'session-1',
        nodeStatus: 'online',
        capabilityTags: [],
        workspaceId: 1,
        actor: 'operator',
      })
    } catch (error) {
      expect((error as OpenClawRuntimeError).code).toBe('AGENT_NOT_FOUND')
    }
  })

  it('rejects heartbeat with non-openclaw runtime type', () => {
    seedAgent(db)

    expect(() =>
      recordOpenClawHeartbeat(db, {
        agentId: 'openclaw-node-01',
        runtimeType: 'other',
        runtimeNodeId: 'node-a',
        runtimeSessionId: 'session-1',
        nodeStatus: 'online',
        capabilityTags: [],
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('records progress for existing run', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)
    mockUpdateRun.mockImplementation((id: string, updates: any, wsId: number) => {
      // Simulate updating the run metadata
      return { ...testRun, ...updates, metadata: updates.metadata }
    })

    const result = recordExecutionProgress(db, {
      runId: 'run-1',
      progress: 55,
      message: 'Halfway done',
      metrics: { completed_steps: 3 },
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      workspaceId: 1,
      actor: 'operator',
    })

    expect(result.run_id).toBe('run-1')
    expect(result.progress).toBe(55)
    expect(result.message).toBe('Halfway done')
    expect(result.metrics).toEqual({ completed_steps: 3 })
    expect(mockUpdateRun).toHaveBeenCalledWith(
      'run-1',
      {
        metadata: expect.objectContaining({
          openclaw: expect.objectContaining({
            progress: 55,
            message: 'Halfway done',
            metrics: { completed_steps: 3 },
          }),
        }),
      },
      1,
    )
  })

  it('rejects progress for non-existent run', () => {
    mockGetRun.mockReturnValue(null)

    expect(() =>
      recordExecutionProgress(db, {
        runId: 'missing-run',
        progress: 50,
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('rejects progress for different runtime session', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)

    expect(() =>
      recordExecutionProgress(db, {
        runId: 'run-1',
        progress: 50,
        runtimeSessionId: 'session-2',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('submits execution result successfully', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)
    mockUpdateRun.mockImplementation((id: string, updates: any, wsId: number) => {
      // Simulate updating the run
      return { ...testRun, ...updates }
    })

    const result = submitExecutionResult(db, {
      runId: 'run-1',
      status: 'completed',
      outcome: 'success',
      result: { output: 'Build successful' },
      artifacts: [
        { type: 'file', name: 'build.log', path: '/logs/build.log' },
        { type: 'artifact', name: 'app.zip', content: 'binary-data' },
      ],
      logs: [
        { level: 'info', message: 'Starting build', timestamp: Date.now() },
        { level: 'info', message: 'Build complete', timestamp: Date.now() },
      ],
      runtimeNodeId: 'node-a',
      runtimeSessionId: 'session-1',
      workspaceId: 1,
      actor: 'operator',
    })

    expect(result.run_id).toBe('run-1')
    expect(result.status).toBe('completed')
    expect(result.outcome).toBe('success')
    expect(result.artifacts_count).toBe(2)
    expect(result.logs_count).toBe(2)
    expect(result.submitted_at).toBeTypeOf('number')

    expect(mockUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        outcome: 'success',
      }),
      1,
    )
  })

  it('submits failed execution result', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)
    mockUpdateRun.mockImplementation((id: string, updates: any, wsId: number) => {
      return { ...testRun, ...updates }
    })

    const result = submitExecutionResult(db, {
      runId: 'run-1',
      status: 'failed',
      outcome: 'error',
      error: 'Build failed with exit code 1',
      logs: [
        { level: 'info', message: 'Starting build' },
        { level: 'error', message: 'Compilation failed' },
      ],
      workspaceId: 1,
      actor: 'operator',
    })

    expect(result.run_id).toBe('run-1')
    expect(result.status).toBe('failed')
    expect(result.outcome).toBe('error')
    expect(result.logs_count).toBe(2)

    expect(mockUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        outcome: 'error',
      }),
      1,
    )
  })

  it('rejects submit for non-existent run', () => {
    mockGetRun.mockReturnValue(null)

    expect(() =>
      submitExecutionResult(db, {
        runId: 'missing-run',
        status: 'completed',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('rejects submit for different runtime session', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)

    expect(() =>
      submitExecutionResult(db, {
        runId: 'run-1',
        status: 'completed',
        runtimeSessionId: 'session-2',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('cancels execution successfully', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)
    mockUpdateRun.mockImplementation((id: string, updates: any, wsId: number) => {
      return { ...testRun, ...updates }
    })

    const result = cancelExecution(db, {
      runId: 'run-1',
      reason: 'User requested cancellation',
      runtimeSessionId: 'session-1',
      workspaceId: 1,
      actor: 'operator',
    })

    expect(result.run_id).toBe('run-1')
    expect(result.status).toBe('cancelled')
    expect(result.outcome).toBe('cancelled')
    expect(result.reason).toBe('User requested cancellation')
    expect(result.cancelled_at).toBeTypeOf('number')

    expect(mockUpdateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'cancelled',
        outcome: 'cancelled',
      }),
      1,
    )
  })

  it('cancels execution without reason', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)
    mockUpdateRun.mockImplementation((id: string, updates: any, wsId: number) => {
      return { ...testRun, ...updates }
    })

    const result = cancelExecution(db, {
      runId: 'run-1',
      workspaceId: 1,
      actor: 'operator',
    })

    expect(result.run_id).toBe('run-1')
    expect(result.status).toBe('cancelled')
    expect(result.reason).toBeNull()
  })

  it('rejects cancel for non-existent run', () => {
    mockGetRun.mockReturnValue(null)

    expect(() =>
      cancelExecution(db, {
        runId: 'missing-run',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('rejects cancel for already completed run', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'completed',
      outcome: 'success',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)

    expect(() =>
      cancelExecution(db, {
        runId: 'run-1',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)

    try {
      cancelExecution(db, {
        runId: 'run-1',
        workspaceId: 1,
        actor: 'operator',
      })
    } catch (error) {
      expect((error as OpenClawRuntimeError).code).toBe('RUN_ALREADY_FINALIZED')
    }
  })

  it('rejects cancel for already failed run', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'failed',
      outcome: 'error',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)

    expect(() =>
      cancelExecution(db, {
        runId: 'run-1',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('rejects cancel for already cancelled run', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'cancelled',
      outcome: 'cancelled',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)

    expect(() =>
      cancelExecution(db, {
        runId: 'run-1',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })

  it('rejects cancel for different runtime session', () => {
    const testRun = {
      id: 'run-1',
      agent_id: 'openclaw-node-01',
      agent_name: 'openclaw-node-01',
      status: 'running',
      outcome: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      steps: [],
      tools_available: [],
      cost_input_tokens: 0,
      cost_output_tokens: 0,
      workspace_id: 1,
      metadata: { openclaw: { runtime_session_id: 'session-1', runtime_node_id: 'node-a' } },
    }

    mockGetRun.mockReturnValue(testRun)

    expect(() =>
      cancelExecution(db, {
        runId: 'run-1',
        runtimeSessionId: 'session-2',
        workspaceId: 1,
        actor: 'operator',
      })
    ).toThrowError(OpenClawRuntimeError)
  })
})
