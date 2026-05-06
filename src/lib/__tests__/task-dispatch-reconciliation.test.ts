import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbState = vi.hoisted(() => ({
  tasks: [] as Array<{
    id: number
    title: string
    assigned_to: string | null
    metadata: string | null
    workspace_id: number
    ticket_prefix?: string | null
    project_ticket_no?: number | null
  }>,
  updates: [] as Array<{
    resolution: string
    metadata: string
    taskId: number
    workspaceId: number
  }>,
  comments: [] as Array<{
    taskId: number
    author: string
    content: string
    workspaceId: number
  }>,
  statusUpdates: [] as Array<{
    status: string
    taskId: number
  }>,
  metadataUpdates: [] as Array<{
    metadata: string
    taskId: number
  }>,
  callOpenClawGateway: vi.fn(),
  runOpenClaw: vi.fn(),
  getAllGatewaySessions: vi.fn(),
  readSessionJsonl: vi.fn(),
  logActivity: vi.fn(),
  broadcast: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT') && sql.includes('assigned_to') && sql.includes('metadata') && sql.includes('project_ticket_no')) {
        return {
          all: () => mockDbState.tasks,
        }
      }
      if (sql.includes('FROM tasks t') && sql.includes('JOIN agents')) {
        return {
          all: () => mockDbState.tasks,
        }
      }
      if (sql.includes('SELECT metadata FROM tasks WHERE id = ?')) {
        return {
          get: (taskId: number) => {
            const task = mockDbState.tasks.find((item) => item.id === taskId)
            return task ? { metadata: task.metadata } : undefined
          },
        }
      }
      if (sql === 'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?') {
        return {
          run: (status: string, _updatedAt: number, taskId: number) => {
            mockDbState.statusUpdates.push({ status, taskId })
            return { changes: 1 }
          },
        }
      }
      if (sql === 'UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?') {
        return {
          run: (metadata: string, _updatedAt: number, taskId: number) => {
            mockDbState.metadataUpdates.push({ metadata, taskId })
            return { changes: 1 }
          },
        }
      }
      if (sql.includes('UPDATE tasks') && sql.includes("status = 'review'")) {
        return {
          run: (resolution: string, metadata: string, _updatedAt: number, taskId: number, workspaceId: number) => {
            mockDbState.updates.push({ resolution, metadata, taskId, workspaceId })
            return { changes: 1 }
          },
        }
      }
      if (sql.includes('INSERT INTO comments')) {
        return {
          run: (taskId: number, author: string, content: string, _createdAt: number, workspaceId: number) => {
            mockDbState.comments.push({ taskId, author, content, workspaceId })
            return { changes: 1 }
          },
        }
      }
      return {
        all: () => [],
        get: () => undefined,
        run: () => ({ changes: 0 }),
      }
    },
  }),
  db_helpers: {
    logActivity: mockDbState.logActivity,
  },
}))

vi.mock('../config', () => ({
  config: {
    openclawHome: 'C:/openclaw',
    openclawStateDir: 'C:/openclaw',
  },
}))

vi.mock('../openclaw-gateway', () => ({
  callOpenClawGateway: mockDbState.callOpenClawGateway,
}))

vi.mock('../command', () => ({
  runOpenClaw: mockDbState.runOpenClaw,
}))

vi.mock('../sessions', () => ({
  getAllGatewaySessions: mockDbState.getAllGatewaySessions,
}))

vi.mock('../transcript-parser', () => ({
  readSessionJsonl: mockDbState.readSessionJsonl,
  parseJsonlTranscript: (raw: string, limit: number) => raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'message' && entry.message)
    .map((entry) => ({
      role: entry.message.role === 'assistant' ? 'assistant' : entry.message.role === 'system' ? 'system' : 'user',
      parts: Array.isArray(entry.message.content)
        ? entry.message.content
            .filter((part: any) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
            .map((part: any) => ({ type: 'text', text: part.text.trim() }))
        : typeof entry.message.content === 'string' && entry.message.content.trim()
          ? [{ type: 'text', text: entry.message.content.trim() }]
          : [],
      timestamp: entry.timestamp,
    }))
    .filter((message) => message.parts.length > 0)
    .slice(-limit),
}))

vi.mock('../event-bus', () => ({
  eventBus: {
    broadcast: mockDbState.broadcast,
  },
}))

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: mockDbState.warn,
    error: vi.fn(),
  },
}))

import { dispatchAssignedTasks, extractDeferredCompletionText, reconcileDeferredTaskCompletions } from '../task-dispatch'

describe('deferred task completion reconciliation', () => {
  beforeEach(() => {
    mockDbState.tasks = []
    mockDbState.updates = []
    mockDbState.comments = []
    mockDbState.statusUpdates = []
    mockDbState.metadataUpdates = []
    mockDbState.callOpenClawGateway.mockReset()
    mockDbState.runOpenClaw.mockReset()
    mockDbState.getAllGatewaySessions.mockReset()
    mockDbState.getAllGatewaySessions.mockReturnValue([])
    mockDbState.readSessionJsonl.mockReset()
    mockDbState.readSessionJsonl.mockReturnValue(null)
    mockDbState.logActivity.mockClear()
    mockDbState.broadcast.mockClear()
    mockDbState.warn.mockClear()
  })

  it('extracts text from gateway payloads', () => {
    expect(
      extractDeferredCompletionText({
        status: 'completed',
        result: {
          payloads: [{ text: 'Finished delegated work.' }],
        },
      })
    ).toBe('Finished delegated work.')
  })

  it('extracts text from responses-style output arrays', () => {
    expect(
      extractDeferredCompletionText({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Reviewable result.' }],
          },
        ],
      })
    ).toBe('Reviewable result.')
  })

  it('does not wait on dispatch_session_id when dispatch_run_id is missing', async () => {
    mockDbState.tasks = [{
      id: 11,
      title: 'Deferred task',
      assigned_to: 'agent-one',
      metadata: JSON.stringify({ async_state: 'pending', dispatch_session_id: 'session-123' }),
      workspace_id: 1,
    }]
    const waitForRun = vi.fn(async () => ({ complete: true, text: 'Should not be used.' }))

    const result = await reconcileDeferredTaskCompletions({ waitForRun })

    expect(waitForRun).not.toHaveBeenCalled()
    expect(result.promoted).toBe(0)
    expect(mockDbState.updates).toHaveLength(0)
  })

  it('leaves tasks in progress when the wait result is not terminal', async () => {
    mockDbState.tasks = [{
      id: 12,
      title: 'Still running task',
      assigned_to: 'agent-one',
      metadata: JSON.stringify({ async_state: 'pending', dispatch_run_id: 'run-123' }),
      workspace_id: 1,
    }]
    const waitForRun = vi.fn(async () => ({ complete: false, text: 'Partial output is ignored.' }))

    const result = await reconcileDeferredTaskCompletions({ waitForRun })

    expect(result.promoted).toBe(0)
    expect(mockDbState.updates).toHaveLength(0)
    expect(mockDbState.comments).toHaveLength(0)
  })

  it('keeps agent.wait timeout results pending', async () => {
    mockDbState.tasks = [{
      id: 15,
      title: 'Timed out wait task',
      assigned_to: 'agent-one',
      metadata: JSON.stringify({ async_state: 'pending', dispatch_run_id: 'run-timeout' }),
      workspace_id: 1,
    }]
    mockDbState.callOpenClawGateway.mockResolvedValue({ status: 'timeout', runId: 'run-timeout' })

    const result = await reconcileDeferredTaskCompletions()

    expect(mockDbState.callOpenClawGateway).toHaveBeenCalledWith(
      'agent.wait',
      { runId: 'run-timeout', timeoutMs: 1000 },
      3000,
    )
    expect(result.promoted).toBe(0)
    expect(mockDbState.updates).toHaveLength(0)
    expect(mockDbState.comments).toHaveLength(0)
  })

  it('skips malformed async metadata without waiting or updating', async () => {
    mockDbState.tasks = [{
      id: 13,
      title: 'Malformed metadata task',
      assigned_to: 'agent-one',
      metadata: '{"async_state":"pending","dispatch_run_id":"run-123"',
      workspace_id: 1,
    }]
    const waitForRun = vi.fn(async () => ({ complete: true, text: 'Should not be used.' }))

    const result = await reconcileDeferredTaskCompletions({ waitForRun })

    expect(waitForRun).not.toHaveBeenCalled()
    expect(result.promoted).toBe(0)
    expect(mockDbState.updates).toHaveLength(0)
  })

  it('promotes completed runs with a fallback resolution when no text is returned', async () => {
    mockDbState.tasks = [{
      id: 14,
      title: 'Empty output task',
      assigned_to: null,
      metadata: JSON.stringify({ async_state: 'pending', dispatch_run_id: 'run-456' }),
      workspace_id: 1,
    }]
    const waitForRun = vi.fn(async () => ({ complete: true, text: null }))

    const result = await reconcileDeferredTaskCompletions({ waitForRun })

    expect(result.promoted).toBe(1)
    expect(mockDbState.updates[0].resolution).toBe('Deferred agent run completed without textual output.')
    expect(mockDbState.comments[0]).toMatchObject({
      taskId: 14,
      author: 'agent',
      content: 'Deferred agent run completed without textual output.',
      workspaceId: 1,
    })
  })

  it('recovers completed run text from the agent transcript when wait has no text', async () => {
    mockDbState.tasks = [{
      id: 30,
      title: 'Transcript output task',
      assigned_to: 'Arnold',
      metadata: JSON.stringify({
        async_state: 'pending',
        dispatch_run_id: 'run-30',
        dispatch_session_id: 'arnold',
      }),
      workspace_id: 1,
      ticket_prefix: 'TASK',
      project_ticket_no: 30,
    }]
    mockDbState.getAllGatewaySessions.mockReturnValue([{
      key: 'agent:arnold:main',
      agent: 'arnold',
      sessionId: 'session-30',
      updatedAt: Date.now(),
      chatType: 'agent',
      channel: '',
      model: '',
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      contextTokens: 0,
      active: true,
    }])
    mockDbState.readSessionJsonl.mockReturnValue([
      JSON.stringify({
        type: 'message',
        timestamp: '2026-05-06T20:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '**[TASK-030] Transcript output task**' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-05-06T20:01:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Recovered transcript response.' }],
        },
      }),
    ].join('\n'))
    const waitForRun = vi.fn(async () => ({ complete: true, text: null }))

    const result = await reconcileDeferredTaskCompletions({ waitForRun })

    expect(result.promoted).toBe(1)
    expect(mockDbState.getAllGatewaySessions).toHaveBeenCalledWith(24 * 60 * 60 * 1000, true)
    expect(mockDbState.readSessionJsonl).toHaveBeenCalledWith('C:/openclaw', 'arnold', 'session-30')
    expect(mockDbState.updates[0].resolution).toBe('Recovered transcript response.')
    expect(mockDbState.comments[0]).toMatchObject({
      taskId: 30,
      author: 'Arnold',
      content: 'Recovered transcript response.',
      workspaceId: 1,
    })
  })
})

describe('existing-session deferred dispatch', () => {
  beforeEach(() => {
    mockDbState.tasks = []
    mockDbState.updates = []
    mockDbState.comments = []
    mockDbState.statusUpdates = []
    mockDbState.metadataUpdates = []
    mockDbState.callOpenClawGateway.mockReset()
    mockDbState.runOpenClaw.mockReset()
    mockDbState.getAllGatewaySessions.mockReset()
    mockDbState.getAllGatewaySessions.mockReturnValue([])
    mockDbState.readSessionJsonl.mockReset()
    mockDbState.readSessionJsonl.mockReturnValue(null)
    mockDbState.logActivity.mockClear()
    mockDbState.broadcast.mockClear()
    mockDbState.warn.mockClear()
  })

  it('marks accepted chat.send without a runId as explicit manual reconciliation', async () => {
    mockDbState.tasks = [{
      id: 21,
      title: 'Existing session task',
      description: 'Use the existing chat session.',
      status: 'assigned',
      priority: 'medium',
      assigned_to: 'agent-one',
      workspace_id: 1,
      agent_name: 'agent-one',
      agent_id: 7,
      agent_config: null,
      ticket_prefix: null,
      project_ticket_no: null,
      project_id: null,
      metadata: JSON.stringify({ target_session: 'session-123' }),
    } as any]
    mockDbState.callOpenClawGateway.mockResolvedValue({ status: 'accepted' })

    const result = await dispatchAssignedTasks()

    expect(result).toEqual({ ok: true, message: 'Dispatched 1/1 tasks' })
    expect(mockDbState.callOpenClawGateway).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'session-123',
        deliver: false,
      }),
      125_000,
    )
    expect(mockDbState.metadataUpdates).toHaveLength(1)
    const metadata = JSON.parse(mockDbState.metadataUpdates[0].metadata)
    expect(metadata).toMatchObject({
      target_session: 'session-123',
      dispatch_session_id: 'session-123',
      async_state: 'accepted_without_run_id',
      async_reconciliation: 'manual_required',
    })
    expect(metadata.dispatch_run_id).toBeUndefined()
    expect(metadata.async_warning).toContain('accepted without a runId')
    expect(mockDbState.broadcast).toHaveBeenCalledWith('task.updated', expect.objectContaining({
      id: 21,
      status: 'in_progress',
      async_state: 'accepted_without_run_id',
    }))
    expect(mockDbState.logActivity).toHaveBeenCalledWith(
      'task_deferred_dispatch_unreconcilable',
      'task',
      21,
      'scheduler',
      expect.stringContaining('manual reconciliation required'),
      expect.objectContaining({
        dispatch_session_id: 'session-123',
        async_state: 'accepted_without_run_id',
      }),
      1,
    )
  })

  it('does not send heuristic model overrides when the agent has a configured default model', async () => {
    mockDbState.tasks = [{
      id: 22,
      title: 'Diagnose failure in dispatch',
      description: 'Investigate why the task is not working.',
      status: 'assigned',
      priority: 'medium',
      assigned_to: 'Arnold',
      workspace_id: 1,
      agent_name: 'Arnold',
      agent_id: 1,
      agent_config: JSON.stringify({
        openclawId: 'arnold',
        model: { primary: 'openai-codex/gpt-5.4' },
      }),
      ticket_prefix: null,
      project_ticket_no: null,
      project_id: null,
      metadata: '{}',
    } as any]
    mockDbState.callOpenClawGateway.mockResolvedValue({
      status: 'accepted',
      runId: 'run-22',
      sessionId: 'session-22',
    })

    await dispatchAssignedTasks()

    expect(mockDbState.runOpenClaw).not.toHaveBeenCalled()
    expect(mockDbState.callOpenClawGateway).toHaveBeenCalledTimes(1)
    const [, params, timeoutMs] = mockDbState.callOpenClawGateway.mock.calls[0]
    expect(timeoutMs).toBe(60_000)
    expect(params).toMatchObject({
      agentId: 'arnold',
      deliver: false,
    })
    expect(params.model).toBeUndefined()
    const metadata = JSON.parse(mockDbState.metadataUpdates[0].metadata)
    expect(metadata).toMatchObject({
      dispatch_session_id: 'session-22',
      dispatch_run_id: 'run-22',
      async_state: 'pending',
    })
  })
})
