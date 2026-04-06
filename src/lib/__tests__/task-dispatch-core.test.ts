/**
 * Unit tests for task-dispatch sub-modules and orchestrators.
 * WHY: The sub-modules (model routing, parsers, prompt builders) are pure functions
 * with no external deps — they get full coverage cheaply. The orchestrators
 * (dispatchAssignedTasks, runAegisReviews) are tested with fully mocked DB and
 * external process calls, covering the main happy path and error revert logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── task-dispatch-model ──────────────────────────────────────────────────────
import {
  classifyTaskModel,
  resolveGatewayAgentId,
  resolveGatewayAgentIdForReview,
} from '@/lib/task-dispatch-model'
import type { DispatchableTask, ReviewableTask } from '@/lib/task-dispatch-types'

function makeTask(overrides: Partial<DispatchableTask> = {}): DispatchableTask {
  return {
    id: 1,
    title: 'Default task',
    description: null,
    status: 'assigned',
    priority: 'medium',
    assigned_to: 'agent-alpha',
    workspace_id: 1,
    agent_name: 'agent-alpha',
    agent_id: 10,
    agent_config: null,
    ticket_prefix: null,
    project_ticket_no: null,
    project_id: null,
    ...overrides,
  }
}

function makeReviewTask(overrides: Partial<ReviewableTask> = {}): ReviewableTask {
  return {
    id: 1,
    title: 'Review me',
    description: null,
    resolution: null,
    assigned_to: 'agent-beta',
    agent_config: null,
    workspace_id: 1,
    ticket_prefix: null,
    project_ticket_no: null,
    ...overrides,
  }
}

describe('classifyTaskModel', () => {
  it('returns Opus model for "critical" priority', () => {
    const result = classifyTaskModel(makeTask({ priority: 'critical' }))
    expect(result).toContain('opus')
  })

  it('returns Opus model when title contains debug keywords', () => {
    const debugTitles = [
      'Debug the login issue',
      'Diagnose performance regression',
      'Root cause analysis of crash',
      'Investigate memory leak',
      'Security audit of API layer',
    ]
    for (const title of debugTitles) {
      expect(classifyTaskModel(makeTask({ title }))).toContain('opus')
    }
  })

  it('returns Haiku model for low-priority routine tasks', () => {
    const result = classifyTaskModel(makeTask({ priority: 'low', title: 'Fetch the latest status' }))
    expect(result).toContain('haiku')
  })

  it('returns Haiku for explicit routine signal regardless of priority (non-high)', () => {
    const result = classifyTaskModel(makeTask({ priority: 'medium', title: 'Quick rename of a variable' }))
    expect(result).toContain('haiku')
  })

  it('returns null for moderate tasks (no override)', () => {
    const result = classifyTaskModel(makeTask({ title: 'Write a blog post draft', priority: 'medium' }))
    expect(result).toBeNull()
  })

  it('respects agent_config.dispatchModel override', () => {
    const result = classifyTaskModel(makeTask({
      agent_config: JSON.stringify({ dispatchModel: 'custom/my-model' }),
      title: 'Quick status check',
      priority: 'low',
    }))
    expect(result).toBe('custom/my-model')
  })

  it('ignores malformed agent_config JSON', () => {
    const result = classifyTaskModel(makeTask({
      agent_config: '{not valid json}',
      title: 'Quick status check',
      priority: 'low',
    }))
    // Falls through to normal routing
    expect(result).toContain('haiku')
  })

  it('does NOT route routine signals to Haiku for high priority', () => {
    const result = classifyTaskModel(makeTask({ priority: 'high', title: 'Quick list of issues' }))
    expect(result).toBeNull()
  })

  it('checks description for complex signals too', () => {
    const result = classifyTaskModel(makeTask({
      title: 'Monthly task',
      description: 'Refactor the entire authentication module',
      priority: 'medium',
    }))
    expect(result).toContain('opus')
  })
})

describe('resolveGatewayAgentId', () => {
  it('returns agent_name when agent_config is null', () => {
    expect(resolveGatewayAgentId(makeTask({ agent_name: 'my-agent' }))).toBe('my-agent')
  })

  it('uses openclawId from agent_config when present', () => {
    const result = resolveGatewayAgentId(makeTask({
      agent_config: JSON.stringify({ openclawId: 'oc-agent-007' }),
      agent_name: 'display-name',
    }))
    expect(result).toBe('oc-agent-007')
  })

  it('falls back to agent_name when openclawId is empty string', () => {
    const result = resolveGatewayAgentId(makeTask({
      agent_config: JSON.stringify({ openclawId: '' }),
      agent_name: 'fallback-name',
    }))
    expect(result).toBe('fallback-name')
  })

  it('falls back to agent_name on malformed JSON', () => {
    const result = resolveGatewayAgentId(makeTask({
      agent_config: 'not-json',
      agent_name: 'fallback',
    }))
    expect(result).toBe('fallback')
  })
})

describe('resolveGatewayAgentIdForReview', () => {
  it('returns assigned_to when agent_config is null', () => {
    expect(resolveGatewayAgentIdForReview(makeReviewTask({ assigned_to: 'reviewer-1' }))).toBe('reviewer-1')
  })

  it('falls back to "jarv" when assigned_to is null', () => {
    expect(resolveGatewayAgentIdForReview(makeReviewTask({ assigned_to: null }))).toBe('jarv')
  })

  it('uses openclawId from agent_config when present', () => {
    const result = resolveGatewayAgentIdForReview(makeReviewTask({
      agent_config: JSON.stringify({ openclawId: 'aegis-oc' }),
    }))
    expect(result).toBe('aegis-oc')
  })
})

// ── task-dispatch-parsers ────────────────────────────────────────────────────
import {
  parseGatewayJson,
  parseAgentResponse,
  parseReviewVerdict,
} from '@/lib/task-dispatch-parsers'

describe('parseGatewayJson', () => {
  it('returns null for empty string', () => {
    expect(parseGatewayJson('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseGatewayJson('   ')).toBeNull()
  })

  it('returns null when no JSON object is found', () => {
    expect(parseGatewayJson('plain text no braces')).toBeNull()
  })

  it('parses a clean JSON object', () => {
    const result = parseGatewayJson('{"status":"ok","data":1}')
    expect(result).toEqual({ status: 'ok', data: 1 })
  })

  it('extracts JSON embedded in surrounding text (CLI output)', () => {
    const raw = 'Warning: some CLI noise\n{"result":"done"}\ntrailing line'
    const result = parseGatewayJson(raw)
    expect(result).toEqual({ result: 'done' })
  })

  it('returns null for malformed JSON', () => {
    expect(parseGatewayJson('{bad json')).toBeNull()
  })

  it('handles nested JSON objects', () => {
    const result = parseGatewayJson('{"outer":{"inner":42}}')
    expect((result?.outer as Record<string, unknown>)?.inner).toBe(42)
  })
})

describe('parseAgentResponse', () => {
  it('extracts text from payloads[0].text format', () => {
    const payload = JSON.stringify({ payloads: [{ text: 'Task complete!' }], sessionId: 'sess-1' })
    const result = parseAgentResponse(payload)
    expect(result.text).toBe('Task complete!')
    expect(result.sessionId).toBe('sess-1')
  })

  it('falls back to result field', () => {
    const result = parseAgentResponse(JSON.stringify({ result: 'done' }))
    expect(result.text).toBe('done')
  })

  it('falls back to output field', () => {
    const result = parseAgentResponse(JSON.stringify({ output: 'hello' }))
    expect(result.text).toBe('hello')
  })

  it('stringifies entire response as last resort', () => {
    const input = JSON.stringify({ unknown: 'shape', value: 42 })
    const result = parseAgentResponse(input)
    expect(result.text).toContain('unknown')
    expect(result.sessionId).toBeNull()
  })

  it('returns raw text when stdout is not JSON', () => {
    const result = parseAgentResponse('plain text response from agent')
    expect(result.text).toBe('plain text response from agent')
    expect(result.sessionId).toBeNull()
  })

  it('returns null text for empty stdout', () => {
    const result = parseAgentResponse('')
    expect(result.text).toBeNull()
    expect(result.sessionId).toBeNull()
  })

  it('extracts session_id (snake_case variant)', () => {
    const payload = JSON.stringify({ payloads: [{ text: 'done' }], session_id: 'snake-sess' })
    const result = parseAgentResponse(payload)
    expect(result.sessionId).toBe('snake-sess')
  })
})

describe('parseReviewVerdict', () => {
  it('returns approved for VERDICT: APPROVED', () => {
    const result = parseReviewVerdict('VERDICT: APPROVED\nNOTES: Looks good')
    expect(result.status).toBe('approved')
    expect(result.notes).toBe('Looks good')
  })

  it('returns rejected for VERDICT: REJECTED', () => {
    const result = parseReviewVerdict('VERDICT: REJECTED\nNOTES: Missing error handling')
    expect(result.status).toBe('rejected')
    expect(result.notes).toBe('Missing error handling')
  })

  it('defaults to rejected when verdict is missing', () => {
    const result = parseReviewVerdict('No verdict in this response')
    expect(result.status).toBe('rejected')
  })

  it('uses default notes when NOTES line is absent (approved)', () => {
    const result = parseReviewVerdict('VERDICT: APPROVED')
    expect(result.status).toBe('approved')
    expect(result.notes).toBe('Quality check passed')
  })

  it('uses default notes when NOTES line is absent (rejected)', () => {
    const result = parseReviewVerdict('VERDICT: REJECTED')
    expect(result.notes).toBe('Quality check failed')
  })

  it('is case-insensitive for verdict detection', () => {
    const result = parseReviewVerdict('verdict: approved\nnotes: fine')
    expect(result.status).toBe('approved')
  })

  it('truncates notes at 2000 characters', () => {
    const longNotes = 'x'.repeat(3000)
    const result = parseReviewVerdict(`VERDICT: APPROVED\nNOTES: ${longNotes}`)
    expect(result.notes.length).toBeLessThanOrEqual(2000)
  })
})

// ── task-dispatch-prompts ────────────────────────────────────────────────────
import { buildTaskPrompt, buildReviewPrompt } from '@/lib/task-dispatch-prompts'

describe('buildTaskPrompt', () => {
  it('includes task title and priority', () => {
    const prompt = buildTaskPrompt(makeTask({ title: 'Fix the bug', priority: 'high' }))
    expect(prompt).toContain('Fix the bug')
    expect(prompt).toContain('high')
  })

  it('uses ticket ref when prefix and number are provided', () => {
    const prompt = buildTaskPrompt(makeTask({
      ticket_prefix: 'PROJ',
      project_ticket_no: 7,
    }))
    expect(prompt).toContain('PROJ-007')
  })

  it('falls back to TASK-{id} when ticket info is absent', () => {
    const prompt = buildTaskPrompt(makeTask({ id: 42 }))
    expect(prompt).toContain('TASK-42')
  })

  it('includes description when present', () => {
    const prompt = buildTaskPrompt(makeTask({ description: 'Do X then Y' }))
    expect(prompt).toContain('Do X then Y')
  })

  it('includes rejection feedback section when provided', () => {
    const prompt = buildTaskPrompt(makeTask(), 'Please add unit tests')
    expect(prompt).toContain('Previous Review Feedback')
    expect(prompt).toContain('Please add unit tests')
  })

  it('includes tags when present', () => {
    const prompt = buildTaskPrompt(makeTask({ tags: ['backend', 'security'] }))
    expect(prompt).toContain('backend')
    expect(prompt).toContain('security')
  })

  it('omits tags section when tags array is empty', () => {
    const prompt = buildTaskPrompt(makeTask({ tags: [] }))
    expect(prompt).not.toContain('Tags:')
  })

  it('does not include feedback section when rejection is null', () => {
    const prompt = buildTaskPrompt(makeTask(), null)
    expect(prompt).not.toContain('Previous Review Feedback')
  })

  it('ends with actionable instruction', () => {
    const prompt = buildTaskPrompt(makeTask())
    expect(prompt).toContain('Complete this task')
  })
})

describe('buildReviewPrompt', () => {
  it('identifies the reviewer as Aegis', () => {
    const prompt = buildReviewPrompt(makeReviewTask())
    expect(prompt).toContain('Aegis')
  })

  it('includes task title', () => {
    const prompt = buildReviewPrompt(makeReviewTask({ title: 'Deploy feature X' }))
    expect(prompt).toContain('Deploy feature X')
  })

  it('includes description when present', () => {
    const prompt = buildReviewPrompt(makeReviewTask({ description: 'Deploy to prod' }))
    expect(prompt).toContain('Deploy to prod')
  })

  it('includes resolution when present', () => {
    const prompt = buildReviewPrompt(makeReviewTask({ resolution: 'Deployed successfully' }))
    expect(prompt).toContain('Deployed successfully')
  })

  it('truncates resolution at 6000 characters', () => {
    const longRes = 'r'.repeat(8000)
    const prompt = buildReviewPrompt(makeReviewTask({ resolution: longRes }))
    // The truncation happens at 6000 chars
    const resSection = prompt.split('## Agent Resolution')[1] || ''
    expect(resSection.length).toBeLessThan(7000)
  })

  it('uses ticket ref when prefix and number are provided', () => {
    const prompt = buildReviewPrompt(makeReviewTask({
      ticket_prefix: 'OPS',
      project_ticket_no: 12,
    }))
    expect(prompt).toContain('OPS-012')
  })

  it('includes both verdict format options in instructions', () => {
    const prompt = buildReviewPrompt(makeReviewTask())
    expect(prompt).toContain('VERDICT: APPROVED')
    expect(prompt).toContain('VERDICT: REJECTED')
  })
})

// ── dispatchAssignedTasks + runAegisReviews orchestrators ────────────────────
// WHY: These are tested with full DB + external CLI mocks to verify status
// transitions and error revert logic without executing real subprocess calls.

const { mockRun, mockGet, mockPrepare, mockAll, mockBroadcast, mockRunOpenClaw, mockGateway, mockLogActivity } = vi.hoisted(() => {
  const mockRun = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
  const mockGet = vi.fn((): any => undefined)
  const mockAll = vi.fn((): any[] => [])
  const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet, all: mockAll }))
  const mockBroadcast = vi.fn()
  const mockRunOpenClaw = vi.fn()
  const mockGateway = vi.fn()
  const mockLogActivity = vi.fn()
  return { mockRun, mockGet, mockPrepare, mockAll, mockBroadcast, mockRunOpenClaw, mockGateway, mockLogActivity }
})

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({
    pragma: vi.fn(),
    prepare: mockPrepare,
    exec: vi.fn(),
    close: vi.fn(),
  })),
}))

vi.mock('@/lib/config', () => ({
  config: { dbPath: ':memory:' },
  ensureDirExists: vi.fn(),
}))

vi.mock('@/lib/migrations', () => ({ runMigrations: vi.fn() }))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: mockBroadcast, on: vi.fn(), emit: vi.fn() },
}))

vi.mock('@/lib/auto-credentials', () => ({
  ensureAutoGeneratedCredentials: vi.fn(),
}))

vi.mock('@/lib/seeds/ecc-instincts', () => ({ seedECCInstincts: vi.fn() }))
vi.mock('@/lib/webhooks', () => ({ initWebhookListener: vi.fn() }))
vi.mock('@/lib/scheduler', () => ({ initScheduler: vi.fn() }))

vi.mock('@/lib/command', () => ({ runOpenClaw: mockRunOpenClaw }))
vi.mock('@/lib/openclaw-gateway', () => ({ callOpenClawGateway: mockGateway }))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    db_helpers: {
      ...actual.db_helpers,
      logActivity: mockLogActivity,
    },
  }
})

import { dispatchAssignedTasks, runAegisReviews } from '@/lib/task-dispatch'

function makeDispatchableTask(overrides: Partial<DispatchableTask> = {}): DispatchableTask {
  return {
    id: 100,
    title: 'Test dispatch task',
    description: 'Do something important',
    status: 'assigned',
    priority: 'medium',
    assigned_to: 'worker',
    workspace_id: 1,
    agent_name: 'worker',
    agent_id: 5,
    agent_config: null,
    ticket_prefix: null,
    project_ticket_no: null,
    project_id: null,
    ...overrides,
  }
}

describe('dispatchAssignedTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: seed check passes (count > 0), no tasks by default
    mockGet.mockReturnValue({ count: 1 })
    mockAll.mockReturnValue([])
    mockRunOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({ payloads: [{ text: 'Task done by agent' }] }),
      stderr: '',
    })
  })

  it('returns early with ok=true when no assigned tasks exist', async () => {
    mockAll.mockReturnValue([])
    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('No assigned tasks')
  })

  it('dispatches a task and marks it done (in review) on success', async () => {
    mockAll.mockReturnValueOnce([makeDispatchableTask()]) // task query
    mockGet.mockReturnValue(undefined) // no rejection comment

    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('1/1')

    // Should broadcast in_progress and then review status changes
    const broadcasts = mockBroadcast.mock.calls.map((c: any[]) => c[0])
    expect(broadcasts).toContain('task.status_changed')
  })

  it('reverts task to "assigned" on dispatch failure', async () => {
    mockAll.mockReturnValueOnce([makeDispatchableTask()])
    mockGet.mockReturnValue(undefined)
    mockRunOpenClaw.mockRejectedValue(new Error('OpenClaw unavailable'))

    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('failed')

    // Verify revert: a run() call should have status='assigned'
    const runCalls = mockRun.mock.calls
    const revertCall = runCalls.find((c: unknown[]) => c[0] === 'assigned')
    expect(revertCall).toBeDefined()
  })

  it('parses JSON tags from task row', async () => {
    const taskWithTags = { ...makeDispatchableTask(), tags: '["frontend","urgent"]' }
    mockAll.mockReturnValueOnce([taskWithTags])
    mockGet.mockReturnValue(undefined)

    await dispatchAssignedTasks()
    // No error means tags were parsed without throwing
    expect(mockRunOpenClaw).toHaveBeenCalled()
  })

  it('handles multiple tasks and reports partial failure', async () => {
    const tasks = [makeDispatchableTask({ id: 1 }), makeDispatchableTask({ id: 2 })]
    mockAll.mockReturnValueOnce(tasks)
    mockGet.mockReturnValue(undefined)

    // First call succeeds, second fails
    mockRunOpenClaw
      .mockResolvedValueOnce({ stdout: JSON.stringify({ payloads: [{ text: 'done' }] }), stderr: '' })
      .mockRejectedValueOnce(new Error('Timeout'))

    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('1/2')
  })

  it('truncates agent response at 10000 characters', async () => {
    const longResponse = 'x'.repeat(12000)
    mockAll.mockReturnValueOnce([makeDispatchableTask()])
    mockGet.mockReturnValue(undefined)
    mockRunOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({ payloads: [{ text: longResponse }] }),
      stderr: '',
    })

    await dispatchAssignedTasks()
    // Verify truncation — .run('review', 'success', truncated, ...) → truncated is at index 2
    const updateCall = mockRun.mock.calls.find(
      (c: unknown[]) => typeof c[2] === 'string' && (c[2] as string).includes('[Response truncated')
    )
    expect(updateCall).toBeDefined()
  })

  it('reverts task to "assigned" when agent returns empty response', async () => {
    // WHY: parseAgentResponse('')  → catches JSON error → { text: null } → throw
    mockAll.mockReturnValueOnce([makeDispatchableTask()])
    mockGet.mockReturnValue(undefined)
    mockRunOpenClaw.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(false)

    // Revert to 'assigned' must have been called
    const revertCall = mockRun.mock.calls.find((c: unknown[]) => c[0] === 'assigned')
    expect(revertCall).toBeDefined()
  })

  it('stores dispatch_session_id in task metadata when agent returns sessionId', async () => {
    mockAll.mockReturnValueOnce([makeDispatchableTask()])
    // mockGet returns undefined: no rejection comment, no existing metadata
    mockGet.mockReturnValue(undefined)
    mockRunOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({ payloads: [{ text: 'Work complete' }], session_id: 'sess-xyz' }),
      stderr: '',
    })

    await dispatchAssignedTasks()

    // The UPDATE run() call should include metadata with dispatch_session_id
    const updateCall = (mockRun.mock.calls as unknown[][]).find(
      (c: unknown[]) => typeof c[3] === 'string' && (c[3] as string).includes('sess-xyz')
    )
    expect(updateCall).toBeDefined()
    const metadataArg = JSON.parse((updateCall as unknown[])[3] as string) as Record<string, unknown>
    expect(metadataArg.dispatch_session_id).toBe('sess-xyz')
  })

  it('dispatches to target session via chat.send when task has target_session metadata', async () => {
    // WHY: covers lines 235-254 — the chat.send path when a task specifies a targetSession
    mockAll.mockReturnValueOnce([makeDispatchableTask()])
    mockGet
      .mockReturnValueOnce(undefined)                            // (1) rejection comment query
      .mockReturnValueOnce({ metadata: JSON.stringify({ target_session: 'sess-abc123' }) }) // (2) taskMeta
      .mockReturnValue(undefined)                                // (3+) existing meta etc.

    mockGateway.mockResolvedValue({ status: 'ok', runId: 'run-456' })

    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(true)

    // chat.send gateway was called with the correct method
    expect(mockGateway).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({ sessionKey: 'sess-abc123' }),
      expect.any(Number),
    )

    // Task should be moved to 'review' with a descriptive resolution
    const reviewCall = (mockRun.mock.calls as unknown[][]).find((c: unknown[]) => c[0] === 'review')
    expect(reviewCall).toBeDefined()
    const resolution = (reviewCall as unknown[])[2] as string
    expect(resolution).toContain('sess-abc123')
  })

  it('reverts task when chat.send returns a non-success status', async () => {
    // WHY: covers lines 248-249 — chat.send status check error path
    mockAll.mockReturnValueOnce([makeDispatchableTask()])
    mockGet
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ metadata: JSON.stringify({ target_session: 'sess-fail' }) })
      .mockReturnValue(undefined)

    // Simulate gateway returning an error status
    mockGateway.mockResolvedValue({ status: 'error', runId: null })

    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(false)

    // Task should be reverted to 'assigned'
    const revertCall = mockRun.mock.calls.find((c: unknown[]) => c[0] === 'assigned')
    expect(revertCall).toBeDefined()
  })
})

describe('runAegisReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({ count: 1 })
    mockAll.mockReturnValue([])
    mockRunOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({ payloads: [{ text: 'VERDICT: APPROVED\nNOTES: Passes review' }] }),
      stderr: '',
    })
  })

  it('returns early with ok=true when no review tasks exist', async () => {
    mockAll.mockReturnValue([])
    const result = await runAegisReviews()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('No tasks awaiting review')
  })

  it('marks task as done when Aegis approves', async () => {
    const reviewTask: ReviewableTask = {
      id: 200, title: 'Review task', description: null, resolution: 'Did the work',
      assigned_to: 'agent-x', agent_config: null, workspace_id: 1,
      ticket_prefix: null, project_ticket_no: null,
    }
    mockAll.mockReturnValueOnce([reviewTask])

    const result = await runAegisReviews()
    expect(result.message).toContain('1 approved')

    const runCalls = mockRun.mock.calls
    const doneCall = runCalls.find((c: unknown[]) => c[0] === 'done')
    expect(doneCall).toBeDefined()
  })

  it('reverts task to in_progress with rejection comment when Aegis rejects', async () => {
    const reviewTask: ReviewableTask = {
      id: 201, title: 'Needs work', description: null, resolution: 'Incomplete',
      assigned_to: 'agent-y', agent_config: null, workspace_id: 1,
      ticket_prefix: null, project_ticket_no: null,
    }
    mockAll.mockReturnValueOnce([reviewTask])
    mockRunOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({ payloads: [{ text: 'VERDICT: REJECTED\nNOTES: Missing tests' }] }),
      stderr: '',
    })

    const result = await runAegisReviews()
    expect(result.message).toContain('rejected')

    const runCalls = mockRun.mock.calls
    const inProgressCall = runCalls.find((c: unknown[]) => c[0] === 'in_progress')
    expect(inProgressCall).toBeDefined()
  })

  it('reverts task to "review" status when Aegis invocation throws', async () => {
    const reviewTask: ReviewableTask = {
      id: 202, title: 'Error task', description: null, resolution: null,
      assigned_to: 'agent-z', agent_config: null, workspace_id: 1,
      ticket_prefix: null, project_ticket_no: null,
    }
    mockAll.mockReturnValueOnce([reviewTask])
    mockRunOpenClaw.mockRejectedValue(new Error('Gateway timeout'))

    const result = await runAegisReviews()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('error')

    const runCalls = mockRun.mock.calls
    const revertCall = runCalls.find((c: unknown[]) => c[0] === 'review')
    expect(revertCall).toBeDefined()
  })

  it('throws when Aegis returns empty response', async () => {
    const reviewTask: ReviewableTask = {
      id: 203, title: 'Empty response', description: null, resolution: null,
      assigned_to: 'agent-w', agent_config: null, workspace_id: 1,
      ticket_prefix: null, project_ticket_no: null,
    }
    mockAll.mockReturnValueOnce([reviewTask])
    mockRunOpenClaw.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await runAegisReviews()
    // Empty response should cause error path
    expect(result.ok).toBe(false)
  })
})
