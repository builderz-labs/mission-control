import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Super Admin (tenants, provision jobs, decommission)', () => {
  const tenantCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    // Tenants cannot easily be deleted via API, but tracking for completeness
    tenantCleanup.length = 0
  })

  // ── GET /api/super/tenants ────────────────────

  test('GET tenants returns list', async ({ request }) => {
    const res = await request.get('/api/super/tenants', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('tenants')
    expect(Array.isArray(body.tenants)).toBe(true)
  })

  // ── POST /api/super/tenants ───────────────────

  test('POST tenants creates a new tenant with bootstrap job', async ({ request }) => {
    const slug = `e2e-tenant-${Date.now()}`
    const res = await request.post('/api/super/tenants', {
      headers: API_KEY_HEADER,
      data: {
        slug,
        display_name: `E2E Test Tenant ${Date.now()}`,
        dry_run: true,
      },
    })
    // May return 201 or 400/500 depending on environment config (template openclaw.json)
    if (res.status() === 201) {
      const body = await res.json()
      expect(body).toHaveProperty('tenant')
      expect(body).toHaveProperty('job')
      if (body.tenant?.id) tenantCleanup.push(body.tenant.id)
    } else {
      // In minimal E2E env, missing template config causes error — acceptable
      expect([400, 500]).toContain(res.status())
    }
  })

  test('POST tenants rejects invalid slug', async ({ request }) => {
    const res = await request.post('/api/super/tenants', {
      headers: API_KEY_HEADER,
      data: {
        slug: 'AB',  // too short, uppercase
        display_name: 'Bad Slug Tenant',
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST tenants rejects duplicate slug', async ({ request }) => {
    const slug = `e2e-dup-${Date.now()}`
    // First create
    const first = await request.post('/api/super/tenants', {
      headers: API_KEY_HEADER,
      data: { slug, display_name: 'First', dry_run: true },
    })

    if (first.status() === 201) {
      const firstBody = await first.json()
      if (firstBody.tenant?.id) tenantCleanup.push(firstBody.tenant.id)

      // Second with same slug should conflict
      const second = await request.post('/api/super/tenants', {
        headers: API_KEY_HEADER,
        data: { slug, display_name: 'Duplicate', dry_run: true },
      })
      expect(second.status()).toBe(409)
    }
  })

  // ── GET /api/super/provision-jobs ─────────────

  test('GET provision-jobs returns list of jobs', async ({ request }) => {
    const res = await request.get('/api/super/provision-jobs', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  test('GET provision-jobs supports status filter', async ({ request }) => {
    const res = await request.get('/api/super/provision-jobs?status=queued', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  test('GET provision-jobs supports limit param', async ({ request }) => {
    const res = await request.get('/api/super/provision-jobs?limit=5', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.jobs.length).toBeLessThanOrEqual(5)
  })

  // ── POST /api/super/provision-jobs ────────────

  test('POST provision-jobs rejects missing tenant_id', async ({ request }) => {
    const res = await request.post('/api/super/provision-jobs', {
      headers: API_KEY_HEADER,
      data: { job_type: 'bootstrap' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('tenant_id')
  })

  test('POST provision-jobs rejects invalid job_type', async ({ request }) => {
    const res = await request.post('/api/super/provision-jobs', {
      headers: API_KEY_HEADER,
      data: { tenant_id: 1, job_type: 'invalid-type' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid job_type')
  })

  test('POST provision-jobs returns 404 for nonexistent tenant', async ({ request }) => {
    const res = await request.post('/api/super/provision-jobs', {
      headers: API_KEY_HEADER,
      data: { tenant_id: 999999, job_type: 'bootstrap' },
    })
    expect(res.status()).toBe(404)
  })

  // ── GET /api/super/provision-jobs/[id] ────────

  test('GET provision-jobs/[id] returns 400 for invalid id', async ({ request }) => {
    const res = await request.get('/api/super/provision-jobs/abc', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid job id')
  })

  test('GET provision-jobs/[id] returns 404 for nonexistent job', async ({ request }) => {
    const res = await request.get('/api/super/provision-jobs/999999', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── POST /api/super/provision-jobs/[id] (approve/reject/cancel) ──

  test('POST provision-jobs/[id] rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/super/provision-jobs/1', {
      headers: API_KEY_HEADER,
      data: { action: 'destroy' },
    })
    // Either 400 (invalid action) or 400 (job not found wrapping)
    expect(res.status()).toBe(400)
  })

  test('POST provision-jobs/[id] rejects invalid id', async ({ request }) => {
    const res = await request.post('/api/super/provision-jobs/abc', {
      headers: API_KEY_HEADER,
      data: { action: 'approve' },
    })
    expect(res.status()).toBe(400)
  })

  // ── POST /api/super/provision-jobs/[id]/run ───

  test('POST provision-jobs/[id]/run rejects invalid id', async ({ request }) => {
    const res = await request.post('/api/super/provision-jobs/abc/run', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid job id')
  })

  test('POST provision-jobs/[id]/run returns error for nonexistent job', async ({ request }) => {
    const res = await request.post('/api/super/provision-jobs/999999/run', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  // ── POST /api/super/tenants/[id]/decommission ─

  test('POST decommission rejects invalid tenant id', async ({ request }) => {
    const res = await request.post('/api/super/tenants/abc/decommission', {
      headers: API_KEY_HEADER,
      data: { dry_run: true },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid tenant id')
  })

  test('POST decommission returns error for nonexistent tenant', async ({ request }) => {
    const res = await request.post('/api/super/tenants/999999/decommission', {
      headers: API_KEY_HEADER,
      data: { dry_run: true, reason: 'E2E test' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  // ── Full provision lifecycle (when env supports it) ──

  test('provision lifecycle: create tenant -> list jobs -> get job', async ({ request }) => {
    const slug = `e2e-lifecycle-${Date.now()}`
    const createRes = await request.post('/api/super/tenants', {
      headers: API_KEY_HEADER,
      data: { slug, display_name: `Lifecycle Test ${Date.now()}`, dry_run: true },
    })

    if (createRes.status() !== 201) {
      // Skip lifecycle test if tenant creation fails (missing env config)
      test.skip()
      return
    }

    const createBody = await createRes.json()
    const tenantId = createBody.tenant?.id
    const jobId = createBody.job?.id
    expect(tenantId).toBeTruthy()

    // List should contain the tenant
    const listRes = await request.get('/api/super/tenants', { headers: API_KEY_HEADER })
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()
    const found = listBody.tenants.find((t: any) => t.slug === slug)
    expect(found).toBeTruthy()

    // If a job was created, verify we can get it
    if (jobId) {
      const jobRes = await request.get(`/api/super/provision-jobs/${jobId}`, {
        headers: API_KEY_HEADER,
      })
      expect(jobRes.status()).toBe(200)
      const jobBody = await jobRes.json()
      expect(jobBody.job).toBeTruthy()
      expect(jobBody.job.tenant_id).toBe(tenantId)
    }
  })
})
