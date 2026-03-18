import { describe, it, expect } from 'vitest'
import {
  createTaskSchema,
  createAgentSchema,
  createWebhookSchema,
  createAlertSchema,
  spawnAgentSchema,
  createUserSchema,
  qualityReviewSchema,
  createPipelineSchema,
  createWorkflowSchema,
  createMessageSchema,
} from '@/lib/validation'

describe('createTaskSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = createTaskSchema.safeParse({ title: 'Fix bug' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe('Fix bug')
      expect(result.data.status).toBe('inbox')
      expect(result.data.priority).toBe('medium')
      expect(result.data.tags).toEqual([])
      expect(result.data.metadata).toEqual({})
    }
  })

  it('rejects missing title', () => {
    const result = createTaskSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects invalid status', () => {
    const result = createTaskSchema.safeParse({ title: 'X', status: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid statuses', () => {
    for (const status of ['inbox', 'assigned', 'in_progress', 'review', 'quality_review', 'done']) {
      const result = createTaskSchema.safeParse({ title: 'T', status })
      expect(result.success).toBe(true)
    }
  })

  it('accepts outcome and feedback fields', () => {
    const result = createTaskSchema.safeParse({
      title: 'Investigate flaky test',
      status: 'done',
      outcome: 'partial',
      feedback_rating: 4,
      feedback_notes: 'Needs follow-up monitoring',
      retry_count: 2,
      completed_at: 1735600000,
    })
    expect(result.success).toBe(true)
  })

  it('accepts implementation target metadata fields', () => {
    const result = createTaskSchema.safeParse({
      title: 'Route this task',
      metadata: {
        implementation_repo: 'builderz-labs/mission-control',
        code_location: '/apps/api',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid feedback_rating', () => {
    const result = createTaskSchema.safeParse({
      title: 'Invalid rating test',
      feedback_rating: 6,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-string implementation target metadata fields', () => {
    const result = createTaskSchema.safeParse({
      title: 'Bad metadata',
      metadata: {
        implementation_repo: 123,
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('createAgentSchema', () => {
  it('accepts valid input', () => {
    const result = createAgentSchema.safeParse({ name: 'agent-1' })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = createAgentSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('createWebhookSchema', () => {
  it('accepts valid input', () => {
    const result = createWebhookSchema.safeParse({
      name: 'My Hook',
      url: 'https://example.com/hook',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid URL', () => {
    const result = createWebhookSchema.safeParse({
      name: 'Hook',
      url: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })
})

describe('createAlertSchema', () => {
  const validAlert = {
    name: 'CPU Alert',
    entity_type: 'agent' as const,
    condition_field: 'cpu',
    condition_operator: 'greater_than' as const,
    condition_value: '90',
  }

  it('accepts valid input', () => {
    const result = createAlertSchema.safeParse(validAlert)
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const { name, ...rest } = validAlert
    const result = createAlertSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects missing entity_type', () => {
    const { entity_type, ...rest } = validAlert
    const result = createAlertSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})

describe('spawnAgentSchema', () => {
  const validSpawn = {
    task: 'Do something',
    label: 'worker-1',
  }

  it('accepts valid input with default timeout', () => {
    const result = spawnAgentSchema.safeParse(validSpawn)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timeoutSeconds).toBe(300)
    }
  })

  it('accepts an explicit model when provided', () => {
    const result = spawnAgentSchema.safeParse({ ...validSpawn, model: 'sonnet' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model).toBe('sonnet')
    }
  })

  it('rejects timeout below minimum (10)', () => {
    const result = spawnAgentSchema.safeParse({ ...validSpawn, timeoutSeconds: 5 })
    expect(result.success).toBe(false)
  })

  it('rejects timeout above maximum (3600)', () => {
    const result = spawnAgentSchema.safeParse({ ...validSpawn, timeoutSeconds: 9999 })
    expect(result.success).toBe(false)
  })
})

describe('createUserSchema', () => {
  it('accepts valid input', () => {
    const result = createUserSchema.safeParse({
      username: 'alice',
      password: 'secure-pass-12chars',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.role).toBe('operator')
    }
  })

  it('rejects missing username', () => {
    const result = createUserSchema.safeParse({ password: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects missing password', () => {
    const result = createUserSchema.safeParse({ username: 'x' })
    expect(result.success).toBe(false)
  })
})

describe('qualityReviewSchema', () => {
  it('accepts valid input', () => {
    const result = qualityReviewSchema.safeParse({
      taskId: 1,
      status: 'approved',
      notes: 'Looks good',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid status', () => {
    const result = qualityReviewSchema.safeParse({
      taskId: 1,
      status: 'pending',
      notes: 'N/A',
    })
    expect(result.success).toBe(false)
  })
})

describe('createPipelineSchema', () => {
  it('accepts valid input with 2+ steps', () => {
    const result = createPipelineSchema.safeParse({
      name: 'Deploy',
      steps: [
        { template_id: 1 },
        { template_id: 2 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects fewer than 2 steps', () => {
    const result = createPipelineSchema.safeParse({
      name: 'Deploy',
      steps: [{ template_id: 1 }],
    })
    expect(result.success).toBe(false)
  })
})

describe('createWorkflowSchema', () => {
  it('accepts valid input', () => {
    const result = createWorkflowSchema.safeParse({
      name: 'Summarize',
      task_prompt: 'Summarize the document',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model).toBe('sonnet')
    }
  })

  it('rejects missing name', () => {
    const result = createWorkflowSchema.safeParse({ task_prompt: 'Do it' })
    expect(result.success).toBe(false)
  })

  it('rejects missing task_prompt', () => {
    const result = createWorkflowSchema.safeParse({ name: 'W' })
    expect(result.success).toBe(false)
  })
})

describe('createMessageSchema', () => {
  it('accepts valid input', () => {
    const result = createMessageSchema.safeParse({
      to: 'bob',
      message: 'Hello',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.to).toBe('bob')
      expect(result.data.message).toBe('Hello')
    }
  })

  it('rejects missing to', () => {
    const result = createMessageSchema.safeParse({ message: 'Hi' })
    expect(result.success).toBe(false)
  })

  it('rejects missing message', () => {
    const result = createMessageSchema.safeParse({ to: 'bob' })
    expect(result.success).toBe(false)
  })
})
