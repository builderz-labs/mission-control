import { expect, test } from '@playwright/test'
import { API_KEY_HEADER, createTestTask, deleteTestTask } from './helpers'

test.describe('Task Regression Metrics API', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  test('returns baseline vs post p95 latency and intervention trend', async ({ request }) => {
    const baselineTaskA = await createTestTask(request, {
      status: 'done',
      retry_count: 0,
      outcome: 'success',
    })
    expect(baselineTaskA.res.status()).toBe(201)
    cleanup.push(baselineTaskA.id)

    const baselineTaskB = await createTestTask(request, {
      status: 'done',
      retry_count: 1,
      outcome: 'partial',
      error_message: 'Needs operator check',
    })
    expect(baselineTaskB.res.status()).toBe(201)
    cleanup.push(baselineTaskB.id)

    await new Promise((resolve) => setTimeout(resolve, 1200))
    const betaStart = Math.floor(Date.now() / 1000)

    const postTaskA = await createTestTask(request, {
      status: 'done',
      retry_count: 2,
      outcome: 'failed',
      error_message: 'Escalated',
    })
    expect(postTaskA.res.status()).toBe(201)
    cleanup.push(postTaskA.id)

    const postTaskB = await createTestTask(request, {
      status: 'done',
      retry_count: 1,
      outcome: 'abandoned',
      error_message: 'Manual rollback',
    })
    expect(postTaskB.res.status()).toBe(201)
    cleanup.push(postTaskB.id)

    const res = await request.get(`/api/tasks/regression?beta_start=${betaStart}&lookback_seconds=3600`, {
      headers: API_KEY_HEADER,
    })
    const responseText = await res.text()
    expect(res.status(), responseText).toBe(200)

    const body = JSON.parse(responseText)
    expect(body.metric_definitions).toBeTruthy()
    expect(body.windows?.baseline?.sample_size).toBeGreaterThan(0)
    expect(body.windows?.post?.sample_size).toBeGreaterThan(0)
    expect(typeof body.windows?.baseline?.latency_seconds?.p95).toBe('number')
    expect(typeof body.windows?.post?.latency_seconds?.p95).toBe('number')
    expect(body.windows?.post?.interventions?.rate).toBeGreaterThan(body.windows?.baseline?.interventions?.rate)
  })

  test('requires beta_start and auth', async ({ request }) => {
    const unauth = await request.get('/api/tasks/regression?beta_start=1700000000')
    expect(unauth.status()).toBe(401)

    const missing = await request.get('/api/tasks/regression', { headers: API_KEY_HEADER })
    expect(missing.status()).toBe(400)
  })
})
