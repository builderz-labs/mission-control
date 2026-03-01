import { APIRequestContext } from '@playwright/test'

export const API_KEY_HEADER = { 'x-api-key': 'test-api-key-e2e-12345' }

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// --- Task helpers ---

export async function createTestTask(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const title = `e2e-task-${uid()}`
  const res = await request.post('/api/tasks', {
    headers: API_KEY_HEADER,
    data: { title, ...overrides },
  })
  const body = await res.json()
  return { id: body.task?.id as number, title, res, body }
}

export async function deleteTestTask(request: APIRequestContext, id: number) {
  return request.delete(`/api/tasks/${id}`, { headers: API_KEY_HEADER })
}

// --- Agent helpers ---

export async function createTestAgent(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const name = `e2e-agent-${uid()}`
  const res = await request.post('/api/agents', {
    headers: API_KEY_HEADER,
    data: { name, role: 'tester', ...overrides },
  })
  const body = await res.json()
  return { id: body.agent?.id as number, name, res, body }
}

export async function deleteTestAgent(request: APIRequestContext, id: number) {
  return request.delete(`/api/agents/${id}`, { headers: API_KEY_HEADER })
}

// --- Workflow helpers ---

export async function createTestWorkflow(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const name = `e2e-wf-${uid()}`
  const res = await request.post('/api/workflows', {
    headers: API_KEY_HEADER,
    data: { name, task_prompt: 'Test prompt for e2e', ...overrides },
  })
  const body = await res.json()
  return { id: body.template?.id as number, name, res, body }
}

export async function deleteTestWorkflow(request: APIRequestContext, id: number) {
  return request.delete('/api/workflows', {
    headers: API_KEY_HEADER,
    data: { id },
  })
}

// --- Webhook helpers ---

export async function createTestWebhook(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const name = `e2e-webhook-${uid()}`
  const res = await request.post('/api/webhooks', {
    headers: API_KEY_HEADER,
    data: { name, url: 'https://example.com/hook', ...overrides },
  })
  const body = await res.json()
  return { id: body.id as number, name, res, body }
}

export async function deleteTestWebhook(request: APIRequestContext, id: number) {
  return request.delete('/api/webhooks', {
    headers: API_KEY_HEADER,
    data: { id },
  })
}

// --- Alert helpers ---

export async function createTestAlert(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const name = `e2e-alert-${uid()}`
  const res = await request.post('/api/alerts', {
    headers: API_KEY_HEADER,
    data: {
      name,
      entity_type: 'task',
      condition_field: 'status',
      condition_operator: 'equals',
      condition_value: 'inbox',
      ...overrides,
    },
  })
  const body = await res.json()
  return { id: body.rule?.id as number, name, res, body }
}

export async function deleteTestAlert(request: APIRequestContext, id: number) {
  return request.delete('/api/alerts', {
    headers: API_KEY_HEADER,
    data: { id },
  })
}

// --- User helpers ---

export async function createTestUser(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const username = `e2e-user-${uid()}`
  const res = await request.post('/api/auth/users', {
    headers: API_KEY_HEADER,
    data: { username, password: 'testpass123', display_name: username, ...overrides },
  })
  const body = await res.json()
  return { id: body.user?.id as number, username, res, body }
}

export async function deleteTestUser(request: APIRequestContext, id: number) {
  return request.delete('/api/auth/users', {
    headers: API_KEY_HEADER,
    data: { id },
  })
}
