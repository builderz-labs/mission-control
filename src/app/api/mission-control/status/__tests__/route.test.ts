import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('../../../../../../scripts/workflow-governor.cjs', () => ({
  run: vi.fn(),
}))

const { GET } = await import('../route')
const govModule = await import('../../../../../../scripts/workflow-governor.cjs') as unknown as { run: ReturnType<typeof vi.fn> }
const mockRun = govModule.run

const mockRequest = {
  url: 'http://localhost/api/mission-control/status',
  headers: new Headers(),
} as NextRequest

describe('GET /api/mission-control/status', () => {
  beforeEach(() => {
    mockRun.mockReset()
  })

  it('returns valid JSON with governor fields on success', async () => {
    const governorResult = {
      agent: 'Workflow Governor v1',
      label: 'OBSERVE ONLY',
      status: 'PASS',
      risk_level: 0,
      timestamp: '2026-05-07T14:19:29.790Z',
      repo: 'niko4244/mission-control',
      repo_state: { root: '/repo', branch_current: 'main', is_main: true, working_tree_clean: true },
      branch_state: { current: 'main', is_main: true, working_tree_clean: true, tracking: 'origin/main', ahead: 0, behind: 0 },
      pr_state: { number: null, state: null, base: null, head: null, mergeable: null, changed_files: null },
      validation_state: { preflight_passed: true, all_validations_passed: true },
      bot_results: {},
      contradictions: [],
      failure_classification: { real_blockers: [], false_positives: [], implementation_gaps: [], contradictions: 0, transient_failures: [] },
      approval_gates: [],
      next_action: 'idle',
      next_action_description: 'No action required — system is in a stable, clean state',
      confidence: 0.99,
      commands: ['node scripts/workflow-governor.cjs --repo niko4244/mission-control'],
      prompts: [],
      stop_conditions: [],
      notes: ['main is clean with no active PR — system is idle'],
      metadata: { execution_time_ms: 5000 },
    }

    mockRun.mockReturnValue(governorResult)

    const response = await GET(mockRequest)
    const data = await response.json()

    expect(data).toEqual(governorResult)
    expect(data.agent).toBe('Workflow Governor v1')
    expect(data.label).toBe('OBSERVE ONLY')
    expect(data.status).toBe('PASS')
    expect(data.next_action).toBe('idle')
    expect(Array.isArray(data.approval_gates)).toBe(true)
    expect(Array.isArray(data.commands)).toBe(true)
  })

  it('returns FAIL JSON with error when run() throws', async () => {
    mockRun.mockImplementation(() => { throw new Error('governor crashed') })

    const response = await GET(mockRequest)
    const data = await response.json()

    expect(data.status).toBe('FAIL')
    expect(data.risk_level).toBe(3)
    expect(data.error).toBeDefined()
    expect(data.error.message).toBe('governor crashed')
    expect(data.label).toBe('OBSERVE ONLY')
  })

  it('returns all required fields in successful response', async () => {
    const governorResult = {
      agent: 'Workflow Governor v1',
      label: 'OBSERVE ONLY',
      status: 'PASS',
      risk_level: 0,
      timestamp: '2026-05-07T14:19:29.790Z',
      repo: 'niko4244/mission-control',
      repo_state: {},
      branch_state: {},
      pr_state: {},
      validation_state: {},
      bot_results: {},
      contradictions: [],
      failure_classification: { real_blockers: [], false_positives: [], implementation_gaps: [], contradictions: 0, transient_failures: [] },
      approval_gates: [],
      next_action: 'idle',
      next_action_description: 'No action required',
      confidence: 0.99,
      commands: ['command'],
      prompts: [],
      stop_conditions: [],
      notes: [],
      metadata: { execution_time_ms: 5000 },
    }

    mockRun.mockReturnValue(governorResult)

    const response = await GET(mockRequest)
    const data = await response.json()

    const requiredFields = [
      'agent', 'label', 'status', 'risk_level', 'timestamp', 'repo',
      'repo_state', 'branch_state', 'pr_state', 'validation_state',
      'bot_results', 'contradictions', 'failure_classification',
      'approval_gates', 'next_action', 'next_action_description',
      'confidence', 'commands', 'prompts', 'stop_conditions', 'notes', 'metadata',
    ]

    for (const field of requiredFields) {
      expect(data).toHaveProperty(field)
    }
  })

  it('passes empty argv to run()', async () => {
    mockRun.mockReturnValue({ agent: 'Workflow Governor v1', status: 'PASS' })

    await GET(mockRequest)

    expect(mockRun).toHaveBeenCalledWith([])
  })

  it('label is preserved from governor output', async () => {
    mockRun.mockReturnValue({
      agent: 'Workflow Governor v1',
      label: 'OBSERVE ONLY',
      status: 'PASS',
    })

    const response = await GET(mockRequest)
    const data = await response.json()

    expect(data.label).toMatch(/OBSERVE/i)
  })
})
