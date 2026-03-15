import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestWorkflow, deleteTestWorkflow } from './helpers'

test.describe('Workflow Phases + Run Lifecycle', () => {
  // ── Template CRUD with Phases ──

  let templateId: number

  test('POST /api/workflows creates template with phases', async ({ request }) => {
    const res = await request.post('/api/workflows', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-wf-phases-${Date.now()}`,
        task_prompt: 'E2E test workflow',
        phases: [
          { name: 'Gather', phase_order: 0, agent_role: 'researcher', requires_approval: false },
          { name: 'Review', phase_order: 1, agent_role: 'reviewer', requires_approval: true, description: 'Human reviews output' },
          { name: 'Finalize', phase_order: 2, agent_role: 'writer', requires_approval: false },
        ],
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.template).toBeDefined()
    expect(body.template.phases).toHaveLength(3)
    expect(body.template.phases[0].name).toBe('Gather')
    expect(body.template.phases[1].requires_approval).toBe(true)
    templateId = body.template.id
  })

  test('GET /api/workflows includes phases in response', async ({ request }) => {
    const res = await request.get('/api/workflows', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    const tpl = body.templates.find((t: { id: number }) => t.id === templateId)
    expect(tpl).toBeDefined()
    expect(tpl.phases).toHaveLength(3)
    expect(tpl.phases[0].phase_order).toBe(0)
    expect(tpl.phases[2].phase_order).toBe(2)
  })

  test('GET /api/workflows/[id]/phases lists phases', async ({ request }) => {
    const res = await request.get(`/api/workflows/${templateId}/phases`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.phases).toHaveLength(3)
    expect(body.phases[1].name).toBe('Review')
    expect(body.phases[1].requires_approval).toBe(true)
  })

  test('PUT /api/workflows/[id]/phases reorders phases', async ({ request }) => {
    const res = await request.put(`/api/workflows/${templateId}/phases`, {
      headers: API_KEY_HEADER,
      data: {
        phases: [
          { name: 'Gather', phase_order: 0, requires_approval: false },
          { name: 'Finalize', phase_order: 1, requires_approval: false },
        ],
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.phases).toHaveLength(2)
    expect(body.phases[0].name).toBe('Gather')
    expect(body.phases[1].name).toBe('Finalize')
  })

  test('PUT /api/workflows/[id]/phases restores 3 phases for run tests', async ({ request }) => {
    const res = await request.put(`/api/workflows/${templateId}/phases`, {
      headers: API_KEY_HEADER,
      data: {
        phases: [
          { name: 'Gather', phase_order: 0, agent_role: 'researcher', requires_approval: false },
          { name: 'Review', phase_order: 1, agent_role: 'reviewer', requires_approval: true },
          { name: 'Finalize', phase_order: 2, agent_role: 'writer', requires_approval: false },
        ],
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.phases).toHaveLength(3)
  })

  // ── Run Lifecycle ──

  let runId: number
  let phaseRuns: Array<{ id: number; phase_id: number; status: string; phase_name: string }>

  test('POST /api/workflows/runs starts a new run', async ({ request }) => {
    const res = await request.post('/api/workflows/runs', {
      headers: API_KEY_HEADER,
      data: {
        template_id: templateId,
        input_data: { query: 'test input' },
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.runId).toBeDefined()
    expect(body.status).toBe('running')
    runId = body.runId
  })

  test('GET /api/workflows/runs lists runs', async ({ request }) => {
    const res = await request.get('/api/workflows/runs', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.runs.length).toBeGreaterThan(0)
    const run = body.runs.find((r: { id: number }) => r.id === runId)
    expect(run).toBeDefined()
    expect(run.status).toBe('running')
  })

  test('GET /api/workflows/runs?status=running filters by status', async ({ request }) => {
    const res = await request.get('/api/workflows/runs?status=running', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    for (const run of body.runs) {
      expect(run.status).toBe('running')
    }
  })

  test('GET /api/workflows/runs/[id] shows run status with phases', async ({ request }) => {
    const res = await request.get(`/api/workflows/runs/${runId}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.run.status).toBe('running')
    expect(body.run.input_data).toEqual({ query: 'test input' })
    expect(body.phases).toHaveLength(3)
    expect(body.phases[0].status).toBe('running')
    expect(body.phases[0].phase_name).toBe('Gather')
    expect(body.phases[1].status).toBe('pending')
    expect(body.phases[2].status).toBe('pending')
    phaseRuns = body.phases
  })

  test('POST /api/workflows/runs/[id]/advance completes phase 1 and pauses at approval gate', async ({ request }) => {
    const gatherPhaseRunId = phaseRuns[0].id
    const res = await request.post(`/api/workflows/runs/${runId}/advance`, {
      headers: API_KEY_HEADER,
      data: {
        phase_run_id: gatherPhaseRunId,
        output: { research: 'found results' },
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Should pause because phase 2 (Review) requires approval
    expect(body.status).toBe('paused')
    expect(body.nextPhase).toBeDefined()
    expect(body.nextPhase.name).toBe('Review')
    expect(body.nextPhase.requiresApproval).toBe(true)
  })

  test('GET /api/workflows/runs/[id] confirms paused state', async ({ request }) => {
    const res = await request.get(`/api/workflows/runs/${runId}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.run.status).toBe('paused')
    expect(body.phases[0].status).toBe('completed')
    expect(body.phases[1].status).toBe('paused')
    expect(body.phases[2].status).toBe('pending')
    // Refresh phase run IDs
    phaseRuns = body.phases
  })

  test('POST /api/workflows/runs/[id]/approve resumes paused phase', async ({ request }) => {
    const reviewPhaseRunId = phaseRuns[1].id
    const res = await request.post(`/api/workflows/runs/${runId}/approve`, {
      headers: API_KEY_HEADER,
      data: { phase_run_id: reviewPhaseRunId },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
    expect(body.approved_by).toBeDefined()
  })

  test('GET /api/workflows/runs/[id] confirms Review is running after approval', async ({ request }) => {
    const res = await request.get(`/api/workflows/runs/${runId}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.run.status).toBe('running')
    expect(body.phases[1].status).toBe('running')
    expect(body.phases[1].approved_by).toBeDefined()
    phaseRuns = body.phases
  })

  test('POST /api/workflows/runs/[id]/advance completes phase 2 and advances to phase 3', async ({ request }) => {
    const reviewPhaseRunId = phaseRuns[1].id
    const res = await request.post(`/api/workflows/runs/${runId}/advance`, {
      headers: API_KEY_HEADER,
      data: {
        phase_run_id: reviewPhaseRunId,
        output: { approved: true, notes: 'looks good' },
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Phase 3 (Finalize) does not require approval so should be running
    expect(body.status).toBe('running')
    expect(body.nextPhase.name).toBe('Finalize')
    expect(body.nextPhase.requiresApproval).toBe(false)
  })

  test('GET /api/workflows/runs/[id] refresh for phase 3', async ({ request }) => {
    const res = await request.get(`/api/workflows/runs/${runId}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.phases[2].status).toBe('running')
    phaseRuns = body.phases
  })

  test('POST /api/workflows/runs/[id]/advance completes final phase and finishes run', async ({ request }) => {
    const finalizePhaseRunId = phaseRuns[2].id
    const res = await request.post(`/api/workflows/runs/${runId}/advance`, {
      headers: API_KEY_HEADER,
      data: {
        phase_run_id: finalizePhaseRunId,
        output: { document: 'final output' },
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('completed')
  })

  test('GET /api/workflows/runs/[id] confirms completed run', async ({ request }) => {
    const res = await request.get(`/api/workflows/runs/${runId}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.run.status).toBe('completed')
    expect(body.run.completed_at).toBeDefined()
    expect(body.phases[0].status).toBe('completed')
    expect(body.phases[1].status).toBe('completed')
    expect(body.phases[2].status).toBe('completed')
  })

  // ── Rejection Flow ──

  let rejectRunId: number
  let rejectPhaseRuns: Array<{ id: number; phase_id: number; status: string; phase_name: string }>

  test('rejection flow: start new run', async ({ request }) => {
    const res = await request.post('/api/workflows/runs', {
      headers: API_KEY_HEADER,
      data: { template_id: templateId },
    })
    expect(res.status()).toBe(201)
    rejectRunId = (await res.json()).runId
  })

  test('rejection flow: advance to approval gate', async ({ request }) => {
    // Get phase runs
    const getRes = await request.get(`/api/workflows/runs/${rejectRunId}`, {
      headers: API_KEY_HEADER,
    })
    rejectPhaseRuns = (await getRes.json()).phases

    const res = await request.post(`/api/workflows/runs/${rejectRunId}/advance`, {
      headers: API_KEY_HEADER,
      data: {
        phase_run_id: rejectPhaseRuns[0].id,
        output: { data: 'to review' },
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('paused')
  })

  test('rejection flow: reject phase fails the run', async ({ request }) => {
    // Refresh phase runs
    const getRes = await request.get(`/api/workflows/runs/${rejectRunId}`, {
      headers: API_KEY_HEADER,
    })
    rejectPhaseRuns = (await getRes.json()).phases

    const res = await request.post(`/api/workflows/runs/${rejectRunId}/reject`, {
      headers: API_KEY_HEADER,
      data: {
        phase_run_id: rejectPhaseRuns[1].id,
        reason: 'Quality not sufficient',
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('failed')
    expect(body.reason).toBe('Quality not sufficient')
  })

  test('rejection flow: confirms failed run status', async ({ request }) => {
    const res = await request.get(`/api/workflows/runs/${rejectRunId}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.run.status).toBe('failed')
    expect(body.phases[1].status).toBe('rejected')
    expect(body.phases[1].validation_error).toBe('Quality not sufficient')
  })

  // ── Cleanup ──

  test('DELETE /api/workflows cascades to phases and runs', async ({ request }) => {
    const res = await request.delete('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { id: templateId },
    })
    expect(res.status()).toBe(200)

    // Verify template is gone
    const getRes = await request.get('/api/workflows', { headers: API_KEY_HEADER })
    const body = await getRes.json()
    const found = body.templates.find((t: { id: number }) => t.id === templateId)
    expect(found).toBeUndefined()
  })
})
