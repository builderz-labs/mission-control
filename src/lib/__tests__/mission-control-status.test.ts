import { describe, expect, it } from 'vitest'
import {
  buildPipelineInspector,
  buildMissionControlSummary,
  buildPipelineStages,
  classifyAgentPresence,
  deriveThinkingSummary,
  extractToolName,
  inferStageFromText,
} from '@/lib/mission-control-status'
import type { MissionControlAgentRow, UnifiedStatusEvent } from '@/types/mission-control'

describe('mission-control status helpers', () => {
  it('classifies active, idle, and offline windows', () => {
    const now = Date.now()
    expect(classifyAgentPresence(now - 10_000)).toBe('active')
    expect(classifyAgentPresence(now - 90_000)).toBe('idle')
    expect(classifyAgentPresence(now - 10 * 60_000)).toBe('offline')
  })

  it('extracts tool and stage hints from freeform text', () => {
    expect(extractToolName('Dev tool write_file for dashboard panel')).toBe('write_file')
    expect(inferStageFromText('Reviewer validate diff_check on patch 42')).toBe('validate')
    expect(inferStageFromText('TechLead planning next workflow stage')).toBe('plan')
  })

  it('derives safe reasoning summaries without exposing raw chain of thought', () => {
    expect(deriveThinkingSummary(undefined, 'patch', 'overview dashboard', 'write_file')).toBe(
      'Updating overview dashboard with write_file'
    )
    expect(deriveThinkingSummary('Checking pipeline state', 'validate')).toBe('Checking pipeline state')
  })

  it('builds summary metrics from normalized data', () => {
    const agents = [{ id: 1 }, { id: 2 }, { id: 3 }] as Array<any>
    const agentRows: MissionControlAgentRow[] = [
      { agentId: '1', agentName: 'A', stage: 'patch', status: 'active', reachable: true },
      { agentId: '2', agentName: 'B', stage: 'plan', status: 'idle', reachable: true },
      { agentId: '3', agentName: 'C', stage: 'idle', status: 'offline', reachable: false },
    ]
    const tasks = [
      { status: 'in_progress' },
      { status: 'review' },
    ] as Array<any>
    const events: UnifiedStatusEvent[] = [
      {
        id: '1',
        ts: new Date(Date.now()).toISOString(),
        agentId: '1',
        agentName: 'A',
        source: 'local',
        kind: 'status',
        summary: 'running',
        severity: 'info',
      },
      {
        id: '2',
        ts: new Date(Date.now()).toISOString(),
        agentId: '2',
        agentName: 'B',
        source: 'log',
        kind: 'error',
        summary: 'failed',
        severity: 'error',
      },
    ]
    const logs = [
      { tsMs: Date.now(), level: 'error' },
      { tsMs: Date.now(), level: 'info' },
    ] as Array<any>

    const summary = buildMissionControlSummary(agents, agentRows, tasks, events, logs)
    expect(summary.agentsRegistered).toBe(3)
    expect(summary.agentsReachable).toBe(2)
    expect(summary.agentsActive).toBe(1)
    expect(summary.tasksRunning).toBe(1)
    expect(summary.errors24h).toBe(2)
  })

  it('maps the current pipeline stage to fixed mission stages', () => {
    const stages = buildPipelineStages(
      {
        id: 1,
        task_id: 10,
        task_description: 'Validate dashboard',
        status: 'running',
        output: 'validate diff_check in progress',
        error: null,
        started_at: Math.floor(Date.now() / 1000),
        completed_at: null,
      },
      undefined,
      null
    )

    expect(stages.find((stage) => stage.key === 'scan')?.status).toBe('completed')
    expect(stages.find((stage) => stage.key === 'validate')?.status).toBe('running')
    expect(stages.find((stage) => stage.key === 'report')?.status).toBe('pending')
  })

  it('builds a pipeline inspector from normalized stage events', () => {
    const now = Date.now()
    const pipeline = buildPipelineStages(null, {
      id: 'evt-1',
      ts: new Date(now).toISOString(),
      agentId: '1',
      agentName: 'Dev',
      source: 'local',
      kind: 'stage_change',
      stage: 'patch',
      summary: 'patch running',
    }, null)

    const inspector = buildPipelineInspector(pipeline, [
      {
        id: 'evt-1',
        ts: new Date(now - 20_000).toISOString(),
        agentId: '1',
        agentName: 'Dev',
        source: 'local',
        kind: 'tool_call',
        stage: 'patch',
        summary: 'write file',
      },
      {
        id: 'evt-2',
        ts: new Date(now - 5_000).toISOString(),
        agentId: '2',
        agentName: 'Reviewer',
        source: 'local',
        kind: 'review',
        stage: 'validate',
        summary: 'reviewing patch',
      },
    ], null)

    expect(inspector.find((stage) => stage.key === 'patch')?.agentsInvolved).toContain('Dev')
    expect(inspector.find((stage) => stage.key === 'patch')?.logs[0]).toContain('Dev')
  })
})
