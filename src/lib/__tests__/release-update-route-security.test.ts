import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const {
  execFileSyncMock,
  logAuditEventMock,
  readFileSyncMock,
  releaseUpdateLimiterMock,
  requireRoleMock,
} = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  logAuditEventMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  releaseUpdateLimiterMock: vi.fn(),
  requireRoleMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: { execFileSync: execFileSyncMock },
  execFileSync: execFileSyncMock,
}))
vi.mock('fs', () => ({
  default: { readFileSync: readFileSyncMock },
  readFileSync: readFileSyncMock,
}))
vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/db', () => ({ logAuditEvent: logAuditEventMock }))
vi.mock('@/lib/rate-limit', () => ({ releaseUpdateLimiter: releaseUpdateLimiterMock }))
vi.mock('@/lib/version', () => ({ APP_VERSION: '2.0.0' }))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ error: vi.fn() }) },
}))

const admin = {
  user: { id: 7, username: 'admin', role: 'admin', workspace_id: 3, tenant_id: 9 },
}

function request(body: string) {
  return new NextRequest('http://localhost/api/releases/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

function validBody() {
  return JSON.stringify({
    targetVersion: 'v2.1.0',
    confirmation: 'update_mission_control',
  })
}

function commandName(command: string, args: string[]) {
  return `${command} ${args.join(' ')}`
}

describe('release update route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue(admin)
    releaseUpdateLimiterMock.mockReturnValue(null)
    readFileSyncMock.mockReturnValue(JSON.stringify({ version: '2.1.0' }))
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      const name = commandName(command, args)
      if (name === 'git symbolic-ref --quiet --short HEAD') return 'main\n'
      return name === 'git status --porcelain' ? '' : 'SENSITIVE_COMMAND_OUTPUT\n'
    })
  })

  it('authenticates before rate limiting, parsing, or executing commands', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { POST } = await import('@/app/api/releases/update/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(401)
    expect(releaseUpdateLimiterMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('applies the critical identity limiter before parsing or commands', async () => {
    releaseUpdateLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many update attempts' }, { status: 429 }),
    )
    const { POST } = await import('@/app/api/releases/update/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(429)
    expect(releaseUpdateLimiterMock).toHaveBeenCalledWith('9:3:7')
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['missing confirmation', JSON.stringify({ targetVersion: 'v2.1.0' })],
    ['wrong confirmation', JSON.stringify({ targetVersion: 'v2.1.0', confirmation: 'yes' })],
    ['unknown field', JSON.stringify({ targetVersion: 'v2.1.0', confirmation: 'update_mission_control', force: true })],
  ])('rejects %s before executing commands', async (_label, body) => {
    const { POST } = await import('@/app/api/releases/update/route')

    const response = await POST(request(body))

    expect(response.status).toBe(400)
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('refuses a release outside the fetched origin/main history', async () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      const name = commandName(command, args)
      if (name === 'git status --porcelain') return ''
      if (name === 'git symbolic-ref --quiet --short HEAD') return 'main\n'
      if (args[0] === 'merge-base') throw new Error('not an ancestor')
      return ''
    })
    const { POST } = await import('@/app/api/releases/update/route')

    const response = await POST(request(validBody()))

    expect(response.status).toBe(409)
    expect(execFileSyncMock).not.toHaveBeenCalledWith('pnpm', expect.anything(), expect.anything())
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })

  it('returns bounded progress without exposing command output', async () => {
    const { POST } = await import('@/app/api/releases/update/route')

    const response = await POST(request(validBody()))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.steps).toEqual([
      'git fetch origin main',
      'git checkout v2.1.0',
      'pnpm install',
      'pnpm build',
    ])
    expect(JSON.stringify(body)).not.toContain('SENSITIVE_COMMAND_OUTPUT')
    expect(logAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'system.update',
      actor: 'admin',
      actor_id: 7,
      target_type: 'release',
    }))
  })

  it('restores the original ref and sanitizes post-checkout failures', async () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      const name = commandName(command, args)
      if (name === 'git status --porcelain') return ''
      if (name === 'git symbolic-ref --quiet --short HEAD') return 'main\n'
      if (name === 'pnpm install --frozen-lockfile') {
        const error = new Error('SENSITIVE_UPDATE_FAILURE') as Error & { stderr: Buffer }
        error.stderr = Buffer.from('/private/operator/repo token=secret')
        throw error
      }
      return ''
    })
    const { POST } = await import('@/app/api/releases/update/route')

    const response = await POST(request(validBody()))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: 'Update failed',
      steps: ['git fetch origin main', 'git checkout v2.1.0'],
      rollback: { attempted: true, restored: true },
    })
    expect(execFileSyncMock).toHaveBeenCalledWith('git', ['checkout', 'main'], expect.anything())
    expect(JSON.stringify(body)).not.toContain('SENSITIVE_UPDATE_FAILURE')
    expect(JSON.stringify(body)).not.toContain('/private/operator/repo')
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })
})
