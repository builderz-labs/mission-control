import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-integrations-put-'))
  return { stateDir, envPath: path.join(stateDir, '.env') }
})

vi.mock('@/lib/config', () => ({ config: { openclawStateDir: paths.stateDir } }))
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 1, username: 'admin', role: 'admin' } })),
}))
vi.mock('@/lib/workspace-isolation', () => ({ denyUnscopedResourceForStrictWorkspace: vi.fn(() => null) }))
vi.mock('@/lib/db', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/provider-subscriptions', () => ({ detectProviderSubscriptions: vi.fn(() => ({})) }))
vi.mock('@/lib/plugins', () => ({ getPluginIntegrations: vi.fn(() => []), getPluginCategories: vi.fn(() => []) }))

import { PUT } from '@/app/api/integrations/route'

function put(vars: Record<string, unknown>) {
  return PUT(new Request('http://localhost/api/integrations', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vars }),
  }) as any)
}

const ORIGINAL = '# comment\nBRAVE_API_KEY=old\n'

describe('PUT /api/integrations value validation', () => {
  beforeEach(() => {
    writeFileSync(paths.envPath, ORIGINAL, 'utf8')
  })

  afterAll(() => {
    rmSync(paths.stateDir, { recursive: true, force: true })
  })

  it.each([
    ['LF', 'ok\nNODE_OPTIONS=--require=/tmp/x.js'],
    ['CR', 'ok\rNODE_OPTIONS=x'],
    ['NUL', 'ok\u0000x'],
  ])('rejects a value containing %s with 400 and leaves the file unchanged', async (_label, value) => {
    const response = await put({ GITHUB_TOKEN: 'fine', BRAVE_API_KEY: value })
    expect(response.status).toBe(400)
    expect(readFileSync(paths.envPath, 'utf8')).toBe(ORIGINAL)
  })

  it('replaces an existing key and appends a new one', async () => {
    const response = await put({ BRAVE_API_KEY: 'new', GITHUB_TOKEN: 'ghp_x' })
    expect(response.status).toBe(200)
    const content = readFileSync(paths.envPath, 'utf8')
    expect(content).toBe('# comment\nBRAVE_API_KEY=new\n\nGITHUB_TOKEN=ghp_x')
    expect(content.match(/BRAVE_API_KEY=/g)).toHaveLength(1)
  })

  it('returns 409, not 500, when an existing value already holds a lone CR', async () => {
    const poisoned = 'BRAVE_API_KEY=old\rX=1\n'
    writeFileSync(paths.envPath, poisoned, 'utf8')

    const response = await put({ OPENAI_API_KEY: 'sk-new' })

    expect(response.status).toBe(409)
    expect(readFileSync(paths.envPath, 'utf8')).toBe(poisoned)
  })
})
