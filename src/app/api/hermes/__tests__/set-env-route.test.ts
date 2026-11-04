import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hermes-set-env-'))
  const hermesHome = path.join(dataDir, '.hermes')
  fs.mkdirSync(hermesHome, { recursive: true })
  return { dataDir, hermesHome, envPath: path.join(hermesHome, '.env') }
})

vi.mock('@/lib/config', () => ({ config: { dataDir: paths.dataDir, homeDir: '' } }))
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 1, username: 'admin', role: 'admin', tenant_id: 1, workspace_id: 1 } })),
}))
vi.mock('@/lib/workspace-isolation', () => ({ denyUnscopedResourceForStrictWorkspace: vi.fn(() => null) }))
vi.mock('@/lib/db', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ extractClientIp: vi.fn(() => '127.0.0.1'), hermesMutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/hermes-sessions', () => ({
  isHermesInstalled: vi.fn(() => true),
  isHermesGatewayRunning: vi.fn(() => false),
  scanHermesSessions: vi.fn(() => []),
}))
vi.mock('@/lib/hermes-tasks', () => ({ getHermesTasks: vi.fn(() => ({ cronJobs: [] })) }))
vi.mock('@/lib/hermes-memory', () => ({ getHermesMemory: vi.fn(() => ({ agentMemoryEntries: 0 })) }))

import { POST } from '@/app/api/hermes/route'

function setEnv(value: unknown, key = 'OPENAI_API_KEY') {
  return POST(new Request('http://localhost/api/hermes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set-env', key, value }),
  }) as any)
}

const ORIGINAL = 'EXISTING_SETTING=keep\nOPENAI_API_KEY=old-key\n'

describe('POST /api/hermes set-env', () => {
  beforeEach(() => {
    writeFileSync(paths.envPath, ORIGINAL, 'utf8')
  })

  afterAll(() => {
    rmSync(paths.dataDir, { recursive: true, force: true })
  })

  it.each([
    ['LF', 'sk-good\nANTHROPIC_BASE_URL=https://attacker.example'],
    ['CR', 'sk-good\rANTHROPIC_BASE_URL=https://attacker.example'],
    ['CRLF', 'sk-good\r\nANTHROPIC_BASE_URL=https://attacker.example'],
    ['NUL', 'sk-good\u0000ANTHROPIC_BASE_URL=x'],
  ])('rejects a value containing %s with 400 and leaves the file unchanged', async (_label, value) => {
    const response = await setEnv(value)
    expect(response.status).toBe(400)
    expect(readFileSync(paths.envPath, 'utf8')).toBe(ORIGINAL)
  })

  it('writes a normal value for a new key', async () => {
    const response = await setEnv('sk-ant-123', 'ANTHROPIC_API_KEY')
    expect(response.status).toBe(200)
    expect(readFileSync(paths.envPath, 'utf8')).toBe(`${ORIGINAL}ANTHROPIC_API_KEY=sk-ant-123\n`)
  })

  it('replaces an existing key in place instead of duplicating it', async () => {
    const response = await setEnv('new-key')
    expect(response.status).toBe(200)
    const content = readFileSync(paths.envPath, 'utf8')
    expect(content).toBe('EXISTING_SETTING=keep\nOPENAI_API_KEY=new-key\n')
    expect(content.match(/OPENAI_API_KEY=/g)).toHaveLength(1)
  })

  it('writes replacement-pattern characters literally', async () => {
    const response = await setEnv('a$&b$1c')
    expect(response.status).toBe(200)
    expect(readFileSync(paths.envPath, 'utf8')).toBe('EXISTING_SETTING=keep\nOPENAI_API_KEY=a$&b$1c\n')
  })

  it('quotes values that dotenv would otherwise reinterpret', async () => {
    const response = await setEnv('abc #def')
    expect(response.status).toBe(200)
    expect(readFileSync(paths.envPath, 'utf8')).toBe('EXISTING_SETTING=keep\nOPENAI_API_KEY="abc #def"\n')
  })

  it('creates the file when it does not exist', async () => {
    rmSync(paths.envPath)
    const response = await setEnv('fresh')
    expect(response.status).toBe(200)
    expect(readFileSync(paths.envPath, 'utf8')).toBe('OPENAI_API_KEY=fresh\n')
  })
})
