import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MissionControlSnapshot } from '@/types/mission-control'

const smartPollState = vi.hoisted(() => ({
  calls: [] as Array<{ intervalMs: number; options: unknown }>,
  triggerRefresh: null as null | (() => void | Promise<void>),
}))

vi.mock('@/lib/use-smart-poll', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    useSmartPoll: (callback: () => void | Promise<void>, intervalMs: number, options: unknown) => {
      smartPollState.calls.push({ intervalMs, options })
      smartPollState.triggerRefresh = callback

      React.useEffect(() => {
        void callback()
      }, [callback])

      return callback
    },
  }
})

vi.mock('@/components/dashboard/agent-status-board', () => ({
  AgentStatusBoard: () => <div data-testid="agent-status-board" />,
}))

vi.mock('@/components/dashboard/error-blocker-panel', () => ({
  ErrorBlockerPanel: () => <div data-testid="error-blocker-panel" />,
}))

vi.mock('@/components/dashboard/event-stream-panel', () => ({
  EventStreamPanel: () => <div data-testid="event-stream-panel" />,
}))

vi.mock('@/components/dashboard/heartbeat-monitor-panel', () => ({
  HeartbeatMonitorPanel: () => <div data-testid="heartbeat-monitor-panel" />,
}))

vi.mock('@/components/dashboard/orchestrator-control-buttons', () => ({
  OrchestratorControlButtons: () => <div data-testid="orchestrator-control-buttons" />,
}))

vi.mock('@/components/dashboard/pipeline-execution-inspector', () => ({
  PipelineExecutionInspector: () => <div data-testid="pipeline-execution-inspector" />,
}))

vi.mock('@/components/dashboard/pipeline-stage-panel', () => ({
  PipelineStagePanel: () => <div data-testid="pipeline-stage-panel" />,
}))

vi.mock('@/components/dashboard/tool-call-timeline-panel', () => ({
  ToolCallTimelinePanel: () => <div data-testid="tool-call-timeline-panel" />,
}))

vi.mock('@/components/dashboard/usage-monitor-panel', () => ({
  UsageMonitorPanel: () => <div data-testid="usage-monitor-panel" />,
}))

import { MissionControlBoard } from '@/components/dashboard/mission-control-board'

class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
}

function createSnapshot(overrides: Partial<MissionControlSnapshot> = {}): MissionControlSnapshot {
  return {
    generatedAt: new Date('2026-03-08T12:00:00.000Z').toISOString(),
    summary: {
      agentsRegistered: 7,
      agentsReachable: 5,
      agentsActive: 3,
      tasksRunning: 2,
      errors24h: 1,
      eventRate: 4,
    },
    agents: [],
    tasks: [],
    events: [],
    pipeline: [],
    heartbeat: [],
    toolTimeline: [],
    usage: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalEstimatedCost: 0,
      callsPerMinute: 0,
      models: [],
    },
    blocked: [],
    pipelineInspector: [],
    orchestrator: {
      state: 'idle',
      dispatchEnabled: false,
      scheduledRunsEnabled: false,
      fallbackEnabled: false,
      schedulerRunning: false,
      activeRuns: 0,
    },
    ...overrides,
  }
}

function createJsonResponse(snapshot: MissionControlSnapshot): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(snapshot),
  } as unknown as Response
}

function createAbortError() {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function createDeferredResponse() {
  let resolve!: (value: Response) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<Response>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function createAbortingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(createAbortError())
        return
      }

      signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
    })
  })
}

async function renderBoard() {
  render(<MissionControlBoard />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
}

async function triggerRefresh() {
  if (!smartPollState.triggerRefresh) {
    throw new Error('Missing triggerRefresh callback')
  }

  await act(async () => {
    await smartPollState.triggerRefresh?.()
  })
}

async function emitSseMessage() {
  const source = MockEventSource.instances.at(-1)
  if (!source?.onmessage) {
    throw new Error('Missing SSE onmessage handler')
  }

  await act(async () => {
    source.onmessage?.({ data: JSON.stringify({ type: 'task.updated' }) } as MessageEvent)
  })
}

describe('MissionControlBoard', () => {
  beforeEach(() => {
    smartPollState.calls = []
    smartPollState.triggerRefresh = null
    MockEventSource.instances = []
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads the board successfully and clears the warning state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createJsonResponse(createSnapshot())))

    await renderBoard()

    expect(await screen.findByText('Agents Registered')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText(/Mission Control data is temporarily unavailable/i)).not.toBeInTheDocument()
  })

  it('shows the availability banner on initial timeout with no prior snapshot', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', createAbortingFetch())

    render(<MissionControlBoard />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
      await Promise.resolve()
    })

    expect(screen.getByText(/Mission Control data is temporarily unavailable\./i)).toBeInTheDocument()
    expect(screen.getByText(/Mission Control request timed out after 10s/i)).toBeInTheDocument()
  })

  it('suppresses the first failed refresh after a successful load', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createSnapshot()))
      .mockRejectedValueOnce(createAbortError())

    vi.stubGlobal('fetch', fetchMock)

    await renderBoard()
    await triggerRefresh()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText(/Mission Control is showing the last successful snapshot/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Mission Control data is temporarily unavailable/i)).not.toBeInTheDocument()
  })

  it('shows the stale snapshot banner after two consecutive failed refreshes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createSnapshot()))
      .mockRejectedValueOnce(createAbortError())
      .mockRejectedValueOnce(createAbortError())

    vi.stubGlobal('fetch', fetchMock)

    await renderBoard()
    await triggerRefresh()
    await triggerRefresh()

    expect(await screen.findByText(/Mission Control is showing the last successful snapshot\./i)).toBeInTheDocument()
    expect(screen.getByText(/Latest refresh failed: Mission Control request timed out after 10s/i)).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('clears the stale snapshot banner after a successful refresh', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createSnapshot()))
      .mockRejectedValueOnce(createAbortError())
      .mockRejectedValueOnce(createAbortError())
      .mockResolvedValueOnce(createJsonResponse(createSnapshot({
        generatedAt: new Date('2026-03-08T12:00:10.000Z').toISOString(),
        summary: {
          agentsRegistered: 9,
          agentsReachable: 7,
          agentsActive: 4,
          tasksRunning: 3,
          errors24h: 0,
          eventRate: 6,
        },
      })))

    vi.stubGlobal('fetch', fetchMock)

    await renderBoard()
    await triggerRefresh()
    await triggerRefresh()
    expect(await screen.findByText(/Mission Control is showing the last successful snapshot\./i)).toBeInTheDocument()

    await triggerRefresh()

    await waitFor(() => expect(screen.queryByText(/Mission Control is showing the last successful snapshot\./i)).not.toBeInTheDocument())
    expect(screen.getByText('9')).toBeInTheDocument()
  })

  it('coalesces overlapping refresh requests into one trailing refresh', async () => {
    const deferred = createDeferredResponse()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createSnapshot()))
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce(createJsonResponse(createSnapshot({
        generatedAt: new Date('2026-03-08T12:00:20.000Z').toISOString(),
        summary: {
          agentsRegistered: 11,
          agentsReachable: 9,
          agentsActive: 5,
          tasksRunning: 4,
          errors24h: 0,
          eventRate: 8,
        },
      })))

    vi.stubGlobal('fetch', fetchMock)

    await renderBoard()

    act(() => {
      void smartPollState.triggerRefresh?.()
      void smartPollState.triggerRefresh?.()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      deferred.resolve(createJsonResponse(createSnapshot({
        generatedAt: new Date('2026-03-08T12:00:15.000Z').toISOString(),
        summary: {
          agentsRegistered: 8,
          agentsReachable: 6,
          agentsActive: 4,
          tasksRunning: 2,
          errors24h: 1,
          eventRate: 5,
        },
      })))
      await Promise.resolve()
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.getByText('11')).toBeInTheDocument()
  })

  it('passes pauseWhenSseConnected true to smart polling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createJsonResponse(createSnapshot())))

    await renderBoard()

    expect(smartPollState.calls.at(-1)).toMatchObject({
      intervalMs: 10_000,
      options: { pauseWhenSseConnected: true },
    })
  })

  it('refreshes the board when an SSE event arrives', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createSnapshot()))
      .mockResolvedValueOnce(createJsonResponse(createSnapshot({
        generatedAt: new Date('2026-03-08T12:00:10.000Z').toISOString(),
        summary: {
          agentsRegistered: 10,
          agentsReachable: 8,
          agentsActive: 4,
          tasksRunning: 3,
          errors24h: 0,
          eventRate: 5,
        },
      })))

    vi.stubGlobal('fetch', fetchMock)

    await renderBoard()
    vi.useFakeTimers()
    await emitSseMessage()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('renders orchestrator recovery decisions and 30-minute reports for tasks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createJsonResponse(createSnapshot({
      tasks: [{
        id: 42,
        title: 'Fix flaky worker handoff',
        status: 'inbox',
        priority: 'high',
        assignedTo: null,
        stage: 'plan',
        updatedAt: new Date('2026-03-08T12:00:00.000Z').toISOString(),
        blocker: '1. it is a problem with "Verification found no changed files." how to fixed and prevent.',
        orchestratorDecision: 'Orchestrator decision: reroute to another agent instead of repeating AutoWorker1.',
        orchestratorReportType: 'problem',
        orchestratorReport: '1. it is a problem with "Verification found no changed files." how to fixed and prevent.',
      }],
    }))))

    await renderBoard()

    expect(await screen.findByText(/reroute to another agent/i)).toBeInTheDocument()
    expect(screen.getByText(/problem review/i)).toBeInTheDocument()
    expect(screen.getByText(/verification found no changed files/i)).toBeInTheDocument()
  })
})
