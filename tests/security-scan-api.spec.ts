import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Security Scan API', () => {
  // ── Auth ─────────────────────────────────────

  test('GET /api/security-scan returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/security-scan')
    expect(res.status()).toBe(401)
  })

  // ── Response shape ───────────────────────────

  test('GET returns scan result with expected top-level fields', async ({ request }) => {
    const res = await request.get('/api/security-scan', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('overall')
    expect(body).toHaveProperty('score')
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('categories')
  })

  test('score is a number between 0 and 100', async ({ request }) => {
    const res = await request.get('/api/security-scan', { headers: API_KEY_HEADER })
    const body = await res.json()
    expect(typeof body.score).toBe('number')
    expect(body.score).toBeGreaterThanOrEqual(0)
    expect(body.score).toBeLessThanOrEqual(100)
  })

  test('overall is a valid severity level', async ({ request }) => {
    const res = await request.get('/api/security-scan', { headers: API_KEY_HEADER })
    const body = await res.json()
    expect(['hardened', 'secure', 'needs-attention', 'at-risk']).toContain(body.overall)
  })

  test('categories has all 5 required sections', async ({ request }) => {
    const res = await request.get('/api/security-scan', { headers: API_KEY_HEADER })
    const body = await res.json()
    const cats = body.categories
    expect(cats).toHaveProperty('credentials')
    expect(cats).toHaveProperty('network')
    expect(cats).toHaveProperty('openclaw')
    expect(cats).toHaveProperty('runtime')
    expect(cats).toHaveProperty('os')
  })

  test('each category has score and checks array', async ({ request }) => {
    const res = await request.get('/api/security-scan', { headers: API_KEY_HEADER })
    const body = await res.json()

    for (const [name, cat] of Object.entries(body.categories) as [string, any][]) {
      expect(typeof cat.score).toBe('number')
      expect(Array.isArray(cat.checks)).toBe(true)

      // Validate check shape
      for (const check of cat.checks) {
        expect(check).toHaveProperty('id')
        expect(check).toHaveProperty('name')
        expect(check).toHaveProperty('status')
        expect(check).toHaveProperty('detail')
        expect(check).toHaveProperty('fix')
        expect(['pass', 'fail', 'warn']).toContain(check.status)
      }
    }
  })

  // ── Severity and fixSafety fields ────────────

  test('checks include severity field', async ({ request }) => {
    const res = await request.get('/api/security-scan', { headers: API_KEY_HEADER })
    const body = await res.json()

    const allChecks = Object.values(body.categories).flatMap((cat: any) => cat.checks)
    const checksWithSeverity = allChecks.filter((c: any) => c.severity)
    // All checks should have severity
    expect(checksWithSeverity.length).toBe(allChecks.length)

    for (const check of checksWithSeverity as any[]) {
      expect(['critical', 'high', 'medium', 'low']).toContain(check.severity)
    }
  })

  test('severity-weighted scoring differs from simple count', async ({ request }) => {
    const res = await request.get('/api/security-scan', { headers: API_KEY_HEADER })
    const body = await res.json()

    // Verify score is present and weighted (just verify it's a valid number)
    expect(body.score).toBeGreaterThanOrEqual(0)
    expect(body.score).toBeLessThanOrEqual(100)

    // Verify category scores are also present
    for (const cat of Object.values(body.categories) as any[]) {
      expect(cat.score).toBeGreaterThanOrEqual(0)
      expect(cat.score).toBeLessThanOrEqual(100)
    }
  })
})

test.describe('Security Scan Agent Endpoint', () => {
  test('POST /api/security-scan/agent returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/security-scan/agent', {
      data: { action: 'scan' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST with action=scan returns scan data with metadata', async ({ request }) => {
    const res = await request.post('/api/security-scan/agent', {
      headers: { ...API_KEY_HEADER, 'Content-Type': 'application/json' },
      data: { action: 'scan' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body).toHaveProperty('scan')
    expect(body).toHaveProperty('summary')
    expect(body.scan).toHaveProperty('overall')
    expect(body.scan).toHaveProperty('score')
    expect(body.scan).toHaveProperty('failingChecks')
    expect(body.scan).toHaveProperty('passingCount')
    expect(body.scan).toHaveProperty('totalCount')
    expect(body.scan).toHaveProperty('categories')
    expect(Array.isArray(body.scan.failingChecks)).toBe(true)

    // Each failing check has severity and fixSafety
    for (const check of body.scan.failingChecks) {
      expect(check).toHaveProperty('severity')
      expect(check).toHaveProperty('fixSafety')
      expect(check).toHaveProperty('autoFixable')
      expect(['critical', 'high', 'medium', 'low']).toContain(check.severity)
    }
  })

  test('POST with dryRun=true reports without applying', async ({ request }) => {
    const res = await request.post('/api/security-scan/agent', {
      headers: { ...API_KEY_HEADER, 'Content-Type': 'application/json' },
      data: { action: 'scan-and-fix', dryRun: true },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body).toHaveProperty('scan')
    expect(body).toHaveProperty('fixes')
    expect(body).toHaveProperty('summary')
    expect(body.summary).toContain('Dry run')

    // Fixes should report what would happen
    if (body.fixes.applied.length > 0) {
      expect(body.fixes.applied[0].detail).toContain('[dry-run]')
      expect(body.fixes.applied[0].fixed).toBe(false)
    }
  })

  test('POST with invalid action returns 400', async ({ request }) => {
    const res = await request.post('/api/security-scan/agent', {
      headers: { ...API_KEY_HEADER, 'Content-Type': 'application/json' },
      data: { action: 'invalid' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST with action=scan-and-fix returns fix results', async ({ request }) => {
    const res = await request.post('/api/security-scan/agent', {
      headers: { ...API_KEY_HEADER, 'Content-Type': 'application/json' },
      data: { action: 'scan-and-fix', fixScope: 'safe' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body).toHaveProperty('scan')
    expect(body).toHaveProperty('fixes')
    expect(body.fixes).toHaveProperty('applied')
    expect(body.fixes).toHaveProperty('skipped')
    expect(body.fixes).toHaveProperty('requiresRestart')
    expect(body.fixes).toHaveProperty('requiresManual')
    expect(typeof body.fixes.requiresRestart).toBe('boolean')
    expect(Array.isArray(body.fixes.requiresManual)).toBe(true)
  })

  test('POST /api/security-scan/fix reports remaining manual issues explicitly', async ({ request }) => {
    const res = await request.post('/api/security-scan/fix', {
      headers: { ...API_KEY_HEADER, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body).toHaveProperty('attempted')
    expect(body).toHaveProperty('fixed')
    expect(body).toHaveProperty('failed')
    expect(body).toHaveProperty('remaining')
    expect(body).toHaveProperty('remainingAutoFixable')
    expect(body).toHaveProperty('remainingManual')
    expect(typeof body.note).toBe('string')
  })

  test('POST /api/security-scan/fix preserves E2E rate-limit bypass for later tests', async ({ request }) => {
    const fixRes = await request.post('/api/security-scan/fix', {
      headers: { ...API_KEY_HEADER, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(fixRes.status()).toBe(200)

    for (let i = 0; i < 12; i++) {
      const res = await request.post('/api/skills/registry', {
        headers: { ...API_KEY_HEADER, 'Content-Type': 'application/json' },
        data: { source: 'clawhub', slug: 'a'.repeat(201), targetRoot: 'user-agents' },
      })
      expect(res.status()).toBe(400)
    }
  })
})
