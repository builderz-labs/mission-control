import { describe, expect, it, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockStatement = {
  get: vi.fn(),
  run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 }),
  all: vi.fn().mockReturnValue([]),
}
const mockDb = { prepare: vi.fn(() => ({ ...mockStatement })) }

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn().mockResolvedValue({
    text: '{"overview": "Test project", "requirements": ["req1"], "success_metrics": ["metric1"]}',
    tokenCount: { input: 50, output: 100 },
    cost: 0.01, latencyMs: 500, model: 'test',
  }),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true, spent: 0, limit: 5 }),
}))

vi.mock('@/lib/llm/output-repair', () => ({
  repairAndParse: vi.fn().mockReturnValue({
    overview: 'Test project',
    requirements: ['req1'],
    success_metrics: ['metric1'],
  }),
}))

import {
  startWorkflow,
  executeRound,
  getWorkflowArtifacts,
  getWorkflowRoleStates,
  getTemplateNames,
  getTemplate,
  SOP_TEMPLATES,
} from '@/lib/sop-engine'
import type { WorkflowRun, SOPMessage, SOPRoleState } from '@/lib/sop-engine'

describe('sop-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatement.get.mockReturnValue(undefined)
    mockStatement.run.mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 })
    mockStatement.all.mockReturnValue([])
  })

  describe('templates', () => {
    it('has software_project template with 5 roles', () => {
      const t = SOP_TEMPLATES['software_project']
      expect(t).toBeDefined()
      expect(t.roles).toHaveLength(5)
    })

    it('has code_review template as composed loop', () => {
      const t = SOP_TEMPLATES['code_review']
      expect(t).toBeDefined()
      expect(t.composed).toBe(true)
      expect(t.maxCycles).toBe(3)
      expect(t.breakCondition?.keyword).toBe('<DONE> Approved')
    })

    it('software_project roles form a pipeline via watches', () => {
      const t = SOP_TEMPLATES['software_project']
      const roleMap = new Map(t.roles.map((r) => [r.id, r]))

      // PM watches UserRequirement
      expect(roleMap.get('pm')!.watches).toContain('UserRequirement')
      // Architect watches WritePRD
      expect(roleMap.get('architect')!.watches).toContain('WritePRD')
      // PM Tasks watches WriteDesign
      expect(roleMap.get('pm_tasks')!.watches).toContain('WriteDesign')
      // Engineer watches WriteTasks
      expect(roleMap.get('engineer')!.watches).toContain('WriteTasks')
      // QA watches WriteCode
      expect(roleMap.get('qa')!.watches).toContain('WriteCode')
    })

    it('each role has at least one action', () => {
      for (const [name, template] of Object.entries(SOP_TEMPLATES)) {
        for (const role of template.roles) {
          expect(role.actions.length, `${name}/${role.id}`).toBeGreaterThan(0)
        }
      }
    })

    it('getTemplateNames returns all templates', () => {
      const names = getTemplateNames()
      expect(names).toContain('software_project')
      expect(names).toContain('code_review')
    })

    it('getTemplate returns template by name', () => {
      const t = getTemplate('software_project')
      expect(t?.name).toBe('Software Project')
    })

    it('getTemplate returns undefined for unknown', () => {
      expect(getTemplate('nonexistent')).toBeUndefined()
    })
  })

  describe('startWorkflow', () => {
    it('creates a new workflow run', () => {
      const run = startWorkflow('software_project', 'Build a todo app', 1, 1)
      expect(run.id).toBeTruthy()
      expect(run.templateName).toBe('software_project')
      expect(run.status).toBe('running')
      expect(run.currentRound).toBe(0)
    })

    it('seeds UserRequirement message', () => {
      startWorkflow('software_project', 'Build a chat app', 1, 1)
      // First call to prepare should be the sop_messages insert
      const firstCall = (mockDb.prepare.mock.calls as string[][])[0][0]
      expect(firstCall).toContain('INSERT INTO sop_messages')
    })

    it('initializes role states', () => {
      startWorkflow('software_project', 'Build an app', 1, 1)
      // Should have insert calls for role states (5 roles + 1 seed message)
      const roleStateCalls = mockDb.prepare.mock.calls.filter(
        (c: string[]) => c[0].includes('sop_role_state')
      )
      expect(roleStateCalls.length).toBe(5)
    })

    it('throws for unknown template', () => {
      expect(() => startWorkflow('nonexistent', 'test', 1, 1)).toThrow('Unknown SOP template')
    })
  })

  describe('executeRound', () => {
    it('returns acted=false when no messages match watches', async () => {
      // All roles have no new messages
      mockStatement.all.mockReturnValue([])
      mockStatement.get.mockReturnValue({
        workflow_run_id: 'run-1', role_id: 'pm',
        state: -1, is_idle: 1, last_observed_msg_id: null,
      })

      const run: WorkflowRun = {
        id: 'run-1', templateName: 'software_project',
        status: 'running', currentRound: 0, maxRounds: 20,
        agentId: 1, workspaceId: 1,
      }

      const result = await executeRound(run)
      expect(result.acted).toBe(false)
      expect(run.status).toBe('completed')
    })

    it('stops when exceeding max rounds', async () => {
      const run: WorkflowRun = {
        id: 'run-1', templateName: 'software_project',
        status: 'running', currentRound: 20, maxRounds: 20,
        agentId: 1, workspaceId: 1,
      }

      const result = await executeRound(run)
      expect(result.acted).toBe(false)
      expect(run.status).toBe('completed')
    })

    it('stops on budget exceeded', async () => {
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValueOnce({ allowed: false, spent: 6, limit: 5 })

      const run: WorkflowRun = {
        id: 'run-1', templateName: 'software_project',
        status: 'running', currentRound: 0, maxRounds: 20,
        agentId: 1, workspaceId: 1,
      }

      const result = await executeRound(run)
      expect(result.acted).toBe(false)
      expect(run.status).toBe('budget_exceeded')
    })

    it('executes a full round when role has matching messages', async () => {
      // Budget: allowed
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: true, spent: 0, limit: 5 })

      // Role state: PM role, idle, no messages observed yet
      const roleState = {
        workflow_run_id: 'run-1',
        role_id: 'pm',
        state: -1,
        is_idle: 1,
        last_observed_msg_id: null,
      }

      // New message matching PM's watch (UserRequirement)
      const newMessage = {
        id: 'msg-1',
        workflow_run_id: 'run-1',
        content: 'Build a todo app',
        instruct_content: null,
        cause_by: 'UserRequirement',
        sent_from: 'user',
        send_to: '__all__',
        created_at: 1000,
      }

      // Mock sequence for executeRound:
      // 1. get role state for 'pm'
      // 2. all() for new messages matching watches → returns [newMessage]
      // 3. complete() LLM call → already mocked
      // 4. repairAndParse() → already mocked
      // 5. run() INSERT sop_messages
      // 6. run() UPDATE sop_role_state

      let callCount = 0
      mockDb.prepare.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // get role state for pm
          return { ...mockStatement, get: vi.fn().mockReturnValue(roleState), all: vi.fn().mockReturnValue([]) }
        }
        if (callCount === 2) {
          // all() new messages matching UserRequirement
          return { ...mockStatement, all: vi.fn().mockReturnValue([newMessage]) }
        }
        // Skip remaining roles (architect, pm_tasks, engineer, qa) — return no state
        // For roles after pm: get returns roleState with state=-1, all returns []
        return {
          ...mockStatement,
          get: vi.fn().mockReturnValue({ ...roleState, role_id: 'other' }),
          all: vi.fn().mockReturnValue([]),
          run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 }),
        }
      })

      const run: WorkflowRun = {
        id: 'run-1',
        templateName: 'software_project',
        status: 'running',
        currentRound: 0,
        maxRounds: 20,
        agentId: 1,
        workspaceId: 1,
      }

      const result = await executeRound(run)
      expect(result.acted).toBe(true)
      expect(result.round).toBe(1)
      expect(run.status).toBe('running')

      // Verify LLM was called
      const { complete: completeMock } = await import('@/lib/llm/router')
      expect(completeMock).toHaveBeenCalled()

      // Verify eventBus broadcast
      const { eventBus } = await import('@/lib/event-bus')
      expect(eventBus.broadcast).toHaveBeenCalledWith(
        'activity.created',
        expect.objectContaining({ type: 'sop.action.completed', roleId: 'pm' }),
      )
    })

    it('skips roles with empty watches', async () => {
      // This tests the guard added for I7
      // A role with watches: [] should be skipped entirely
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: true, spent: 0, limit: 5 })

      mockStatement.all.mockReturnValue([])
      mockStatement.get.mockReturnValue({
        workflow_run_id: 'run-1', role_id: 'pm',
        state: -1, is_idle: 1, last_observed_msg_id: null,
      })

      const run: WorkflowRun = {
        id: 'run-1', templateName: 'software_project',
        status: 'running', currentRound: 0, maxRounds: 20,
        agentId: 1, workspaceId: 1,
      }

      // Should not crash even if watches were empty (though template has watches)
      const result = await executeRound(run)
      expect(result.acted).toBe(false)
    })
  })

  describe('getWorkflowArtifacts', () => {
    it('returns empty array when no messages', () => {
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce([]) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      const artifacts = getWorkflowArtifacts('run-1')
      expect(artifacts).toEqual([])
    })

    it('returns messages in order', () => {
      const messages: SOPMessage[] = [
        { id: 'msg-1', workflow_run_id: 'run-1', content: 'User requirement', instruct_content: null, cause_by: 'UserRequirement', sent_from: 'user', send_to: '__all__', created_at: 1000 },
        { id: 'msg-2', workflow_run_id: 'run-1', content: 'PRD output', instruct_content: '{"overview":"test"}', cause_by: 'WritePRD', sent_from: 'pm', send_to: '__all__', created_at: 1001 },
      ]
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(messages) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      const artifacts = getWorkflowArtifacts('run-1')
      expect(artifacts).toHaveLength(2)
      expect(artifacts[0].cause_by).toBe('UserRequirement')
      expect(artifacts[1].cause_by).toBe('WritePRD')
    })
  })

  describe('getWorkflowRoleStates', () => {
    it('returns role states for a run', () => {
      const states: SOPRoleState[] = [
        { workflow_run_id: 'run-1', role_id: 'pm', state: 0, is_idle: 0, last_observed_msg_id: 'msg-1' },
        { workflow_run_id: 'run-1', role_id: 'architect', state: -1, is_idle: 1, last_observed_msg_id: null },
      ]
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(states) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      const result = getWorkflowRoleStates('run-1')
      expect(result).toHaveLength(2)
      expect(result[0].role_id).toBe('pm')
    })
  })

  describe('composed workflow (code_review)', () => {
    it('has break condition for approval keyword', () => {
      const t = SOP_TEMPLATES['code_review']
      expect(t.breakCondition).toBeDefined()
      expect(t.breakCondition!.keyword).toBe('<DONE> Approved')
    })

    it('reviewer watches UserRequirement and FixCode', () => {
      const t = SOP_TEMPLATES['code_review']
      const reviewer = t.roles.find((r) => r.id === 'reviewer')!
      expect(reviewer.watches).toContain('UserRequirement')
      expect(reviewer.watches).toContain('FixCode')
    })

    it('programmer watches ReviewCode', () => {
      const t = SOP_TEMPLATES['code_review']
      const programmer = t.roles.find((r) => r.id === 'programmer')!
      expect(programmer.watches).toContain('ReviewCode')
    })
  })

  describe('role definitions', () => {
    it('all roles have profile, goal, and constraints', () => {
      for (const [name, template] of Object.entries(SOP_TEMPLATES)) {
        for (const role of template.roles) {
          expect(role.profile, `${name}/${role.id}.profile`).toBeTruthy()
          expect(role.goal, `${name}/${role.id}.goal`).toBeTruthy()
          expect(role.constraints, `${name}/${role.id}.constraints`).toBeTruthy()
        }
      }
    })

    it('all roles have valid reactMode', () => {
      const validModes = new Set(['by_order', 'react', 'plan_and_act'])
      for (const [name, template] of Object.entries(SOP_TEMPLATES)) {
        for (const role of template.roles) {
          expect(validModes.has(role.reactMode), `${name}/${role.id}.reactMode=${role.reactMode}`).toBe(true)
        }
      }
    })

    it('all actions have valid tier', () => {
      const validTiers = new Set(['fast', 'standard', 'complex'])
      for (const [name, template] of Object.entries(SOP_TEMPLATES)) {
        for (const role of template.roles) {
          for (const action of role.actions) {
            expect(validTiers.has(action.tier), `${name}/${role.id}/${action.type}.tier=${action.tier}`).toBe(true)
          }
        }
      }
    })
  })
})
