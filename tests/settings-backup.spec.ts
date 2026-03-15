import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Settings & Backup', () => {
  // ── GET /api/settings ─────────────────────────

  test('GET settings returns grouped settings with defaults', async ({ request }) => {
    const res = await request.get('/api/settings', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('settings')
    expect(body).toHaveProperty('grouped')
    expect(Array.isArray(body.settings)).toBe(true)
    expect(body.settings.length).toBeGreaterThan(0)

    // Each setting should have expected shape
    const first = body.settings[0]
    expect(first).toHaveProperty('key')
    expect(first).toHaveProperty('value')
    expect(first).toHaveProperty('category')
    expect(first).toHaveProperty('description')
    expect(first).toHaveProperty('is_default')
  })

  test('GET settings grouped object contains retention category', async ({ request }) => {
    const res = await request.get('/api/settings', { headers: API_KEY_HEADER })
    const body = await res.json()
    expect(body.grouped).toHaveProperty('retention')
    expect(Array.isArray(body.grouped.retention)).toBe(true)
    expect(body.grouped.retention.length).toBeGreaterThan(0)
  })

  // ── PUT /api/settings ─────────────────────────

  test('PUT settings updates a setting value', async ({ request }) => {
    const key = 'general.site_name'
    const newValue = `E2E Test MC ${Date.now()}`

    const res = await request.put('/api/settings', {
      headers: API_KEY_HEADER,
      data: { settings: { [key]: newValue } },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.updated).toContain(key)
    expect(body.count).toBeGreaterThanOrEqual(1)

    // Verify the value was persisted
    const getRes = await request.get('/api/settings', { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    const setting = getBody.settings.find((s: any) => s.key === key)
    expect(setting).toBeTruthy()
    expect(setting.value).toBe(newValue)
    expect(setting.is_default).toBe(false)
  })

  test('PUT settings can update multiple settings at once', async ({ request }) => {
    const res = await request.put('/api/settings', {
      headers: API_KEY_HEADER,
      data: {
        settings: {
          'retention.activities_days': '60',
          'retention.audit_log_days': '120',
        },
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(body.updated).toContain('retention.activities_days')
    expect(body.updated).toContain('retention.audit_log_days')
  })

  test('PUT settings rejects missing settings field', async ({ request }) => {
    const res = await request.put('/api/settings', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  // ── DELETE /api/settings ──────────────────────

  test('DELETE settings resets a setting to default', async ({ request }) => {
    const key = 'general.site_name'

    // First set it to a non-default value
    await request.put('/api/settings', {
      headers: API_KEY_HEADER,
      data: { settings: { [key]: 'Custom Name' } },
    })

    // Delete to reset
    const res = await request.delete('/api/settings', {
      headers: API_KEY_HEADER,
      data: { key },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.reset).toBe(key)
    expect(body).toHaveProperty('default_value')

    // Verify it's back to default
    const getRes = await request.get('/api/settings', { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    const setting = getBody.settings.find((s: any) => s.key === key)
    expect(setting.is_default).toBe(true)
  })

  test('DELETE settings returns 404 for non-stored key', async ({ request }) => {
    const res = await request.delete('/api/settings', {
      headers: API_KEY_HEADER,
      data: { key: 'nonexistent.setting.xyz' },
    })
    expect(res.status()).toBe(404)
  })

  test('DELETE settings returns 400 when key is missing', async ({ request }) => {
    const res = await request.delete('/api/settings', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/backup ───────────────────────────

  test('GET backup lists existing backups', async ({ request }) => {
    const res = await request.get('/api/backup', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('backups')
    expect(body).toHaveProperty('dir')
    expect(Array.isArray(body.backups)).toBe(true)
  })

  // ── POST /api/backup ──────────────────────────

  test('POST backup creates a new database backup', async ({ request }) => {
    const res = await request.post('/api/backup', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body).toHaveProperty('backup')
    expect(body.backup).toHaveProperty('name')
    expect(body.backup.name).toContain('mc-backup-')
    expect(body.backup.name).toMatch(/\.db$/)
    expect(body.backup).toHaveProperty('size')
    expect(body.backup.size).toBeGreaterThan(0)
    expect(body.backup).toHaveProperty('created_at')

    // Verify it appears in the list
    const listRes = await request.get('/api/backup', { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    const found = listBody.backups.find((b: any) => b.name === body.backup.name)
    expect(found).toBeTruthy()

    // Cleanup: delete the backup we just created
    await request.delete('/api/backup', {
      headers: API_KEY_HEADER,
      data: { name: body.backup.name },
    })
  })

  // ── DELETE /api/backup ────────────────────────

  test('DELETE backup rejects invalid name', async ({ request }) => {
    const res = await request.delete('/api/backup', {
      headers: API_KEY_HEADER,
      data: { name: '../etc/passwd' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid backup name')
  })

  test('DELETE backup returns 404 for nonexistent backup', async ({ request }) => {
    const res = await request.delete('/api/backup', {
      headers: API_KEY_HEADER,
      data: { name: 'nonexistent-backup-file.db' },
    })
    expect(res.status()).toBe(404)
  })

  test('DELETE backup returns 400 when body is missing', async ({ request }) => {
    const res = await request.delete('/api/backup', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(400)
  })
})
