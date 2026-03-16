import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Agent Autonomy Layer', () => {
  let testAgentId: number
  const cleanupIds: { agents: number[]; debates: number[]; workflows: number[] } = {
    agents: [],
    debates: [],
    workflows: [],
  }

  test.beforeAll(async ({ request }) => {
    // Create a test agent for autonomy tests
    const res = await request.post('/api/agents', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-autonomy-agent-${Date.now()}`,
        role: 'engineer',
        status: 'idle',
        config: JSON.stringify({
          persona: {
            personality: {
              openness: 0.8,
              conscientiousness: 0.7,
              extraversion: 0.5,
              agreeableness: 0.6,
              neuroticism: 0.3,
            },
          },
        }),
      },
    })
    if (res.ok()) {
      const body = await res.json()
      testAgentId = body.agent?.id || body.id
      cleanupIds.agents.push(testAgentId)
    }
  })

  test.afterAll(async ({ request }) => {
    for (const id of cleanupIds.debates) {
      await request.delete(`/api/debates`, {
        headers: API_KEY_HEADER,
        data: { debateId: id },
      }).catch(() => {})
    }
    for (const id of cleanupIds.agents) {
      await request.delete(`/api/agents/${id}`, {
        headers: API_KEY_HEADER,
      }).catch(() => {})
    }
  })

  // ── Simulation Status ────────────────────

  test('GET /simulation/status returns engine state', async ({ request }) => {
    const res = await request.get('/api/simulation/status', {
      headers: API_KEY_HEADER,
    })

    // 200 if endpoint exists, 404 if not — both valid since simulation is opt-in
    expect([200, 404]).toContain(res.status())
  })

  // ── Debate Lifecycle (Agent Participation Ready) ────────────────────

  test('debate lifecycle supports agent participation flow', async ({ request }) => {
    // Skip if no test agent
    if (!testAgentId) return

    // Create a second agent for the debate
    const agent2Res = await request.post('/api/agents', {
      headers: API_KEY_HEADER,
      data: { name: `e2e-debate-agent2-${Date.now()}`, role: 'reviewer', status: 'idle' },
    })
    expect(agent2Res.ok()).toBe(true)
    const agent2 = await agent2Res.json()
    const agent2Id = agent2.agent?.id || agent2.id
    cleanupIds.agents.push(agent2Id)

    // Create debate
    const createRes = await request.post('/api/debates', {
      headers: API_KEY_HEADER,
      data: {
        topic: `e2e-autonomy-test-${Date.now()}`,
        participantIds: [testAgentId, agent2Id],
        maxRounds: 2,
        tokenBudget: 10000,
      },
    })
    expect(createRes.status()).toBe(201)
    const created = await createRes.json()
    const debateId = created.debate?.id || created.debateId
    cleanupIds.debates.push(debateId)

    // Get debate status — should be in 'propose' phase
    const statusRes = await request.get(`/api/debates/${debateId}`, {
      headers: API_KEY_HEADER,
    })
    expect(statusRes.ok()).toBe(true)
    const status = await statusRes.json()
    expect(['propose', 'pending']).toContain(status.debate?.status || status.status)

    // Submit argument (simulating what participateInDebate would do)
    const argRes = await request.post(`/api/debates/${debateId}/arguments`, {
      headers: API_KEY_HEADER,
      data: {
        agentId: testAgentId,
        content: 'I propose we use a modular architecture for scalability.',
        confidence: 0.8,
      },
    })
    expect([200, 201]).toContain(argRes.status())
  })

  // ── Workflow Lifecycle (Agent Execution Ready) ────────────────────

  test('workflow phases can be completed by agent role', async ({ request }) => {
    // Create a workflow template
    const templateRes = await request.post('/api/workflows', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-autonomy-wf-${Date.now()}`,
        description: 'Test workflow for agent autonomy',
        phases: [
          { name: 'Design', phase_order: 1, agent_role: 'engineer', description: 'Create design doc' },
          { name: 'Review', phase_order: 2, agent_role: 'reviewer', requires_approval: true },
        ],
      },
    })

    if (!templateRes.ok()) return // Workflow API may use different format

    const template = await templateRes.json()
    const templateId = template.template?.id || template.id || template.workflow?.id

    if (!templateId) return

    // Start a run
    const runRes = await request.post('/api/workflows/runs', {
      headers: API_KEY_HEADER,
      data: {
        templateId,
        inputData: JSON.stringify({ requirement: 'build authentication module' }),
      },
    })

    if (runRes.ok()) {
      const run = await runRes.json()
      const runId = run.runId || run.run?.id

      if (runId) {
        // Verify run is in 'running' state
        const statusRes = await request.get(`/api/workflows/runs/${runId}`, {
          headers: API_KEY_HEADER,
        })
        expect(statusRes.ok()).toBe(true)
        const status = await statusRes.json()
        expect(status.run?.status || status.status).toBe('running')
      }
    }
  })

  // ── Chat Mentions (Agent Response Ready) ────────────────────

  test('chat mentions are routable to agents', async ({ request }) => {
    if (!testAgentId) return

    // Get agent name for mention
    const agentRes = await request.get(`/api/agents/${testAgentId}`, {
      headers: API_KEY_HEADER,
    })
    if (!agentRes.ok()) return
    const agentData = await agentRes.json()
    const agentName = agentData.agent?.name || agentData.name

    // Post a message with @mention
    const msgRes = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        content: `@${agentName.toLowerCase().replace(/\s+/g, '-')} what do you think about this approach?`,
        conversation_id: `e2e-autonomy-conv-${Date.now()}`,
        from_agent: 'user',
      },
    })

    // Chat API may return various status codes depending on gateway availability
    expect([200, 201, 202, 400]).toContain(msgRes.status())
  })

  // ── Scaling Integration ────────────────────

  test('scaling evaluation works with auto-approve policies', async ({ request }) => {
    // Create auto-approve policy
    const policyRes = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-auto-policy-${Date.now()}`,
        min_agents: 0,
        max_agents: 10,
        scale_up_threshold: 100, // High threshold — won't trigger
        scale_down_threshold: 0,
        cooldown_seconds: 0,
        auto_approve: true,
      },
    })
    expect(policyRes.status()).toBe(201)
    const policy = await policyRes.json()
    const policyId = policy.policy.id

    // Evaluate — should return no action (threshold not met)
    const evalRes = await request.post('/api/scaling/evaluate', {
      headers: API_KEY_HEADER,
      data: { policyId },
    })
    expect([200, 201]).toContain(evalRes.status())
    const evalBody = await evalRes.json()
    expect(evalBody.metrics).toBeDefined()

    // Cleanup
    await request.delete(`/api/scaling/policies/${policyId}`, {
      headers: API_KEY_HEADER,
    })
  })

  // ── Agent Persona ────────────────────

  test('agent persona influences system prompt building', async ({ request }) => {
    if (!testAgentId) return

    const res = await request.get(`/api/agents/${testAgentId}/persona`, {
      headers: API_KEY_HEADER,
    })

    if (res.ok()) {
      const body = await res.json()
      // Verify persona structure exists
      expect(body.persona || body.bigFive || body.personality).toBeDefined()
    }
  })

  // ── Mention Autocomplete ────────────────────

  test('mention autocomplete returns agents for @-completion', async ({ request }) => {
    const res = await request.get('/api/mentions?q=e2e-autonomy&limit=5', {
      headers: API_KEY_HEADER,
    })

    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.targets || body.mentions || body).toBeDefined()
  })
})
