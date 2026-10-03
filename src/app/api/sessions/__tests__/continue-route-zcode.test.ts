import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
  launch: null as null | { bin: string; prefixArgs: string[]; env: Record<string, string> },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'operator', username: 'tester' } })),
}))
vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: vi.fn(() => null),
}))
vi.mock('@/lib/command', () => ({ runCommand: mocks.runCommand }))
// Only the launch probe is faked: the session-id shape guard stays real so the
// argv injection check is tested against the shipped regex.
vi.mock('@/lib/zcode-sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zcode-sessions')>()
  return { ...actual, getZcodeLaunch: () => mocks.launch }
})

import { POST } from '@/app/api/sessions/continue/route'

const SESSION = 'sess_33333333-3333-4333-8333-333333333333'

function post(body: unknown) {
  return POST(new Request('http://localhost/api/sessions/continue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any)
}

describe('ZCode session continue route', () => {
  beforeEach(() => {
    mocks.runCommand.mockReset()
    mocks.runCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    mocks.launch = {
      bin: process.execPath,
      prefixArgs: ['C:/ZCode/resources/glm/zcode.cjs'],
      env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: 'C:/ZCode/resources/config/provider/zcode-builtin.json' },
    }
  })

  it('resumes through the resolved launch entry and returns the JSON reply', async () => {
    mocks.runCommand.mockResolvedValueOnce({
      stdout: `startup noise\n{"sessionId":"${SESSION}","response":"continued"}`,
      stderr: '',
      code: 0,
    })

    const response = await post({ kind: 'zcode', id: SESSION, prompt: 'continue' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, reply: 'continued' })

    const [bin, args, options] = mocks.runCommand.mock.calls[0]
    expect(bin).toBe(process.execPath)
    expect(args).toEqual(['C:/ZCode/resources/glm/zcode.cjs', '--json', '--resume', SESSION, '-p', 'continue'])
    expect(options.env.CI).toBe('1')
    expect(options.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE).toContain('zcode-builtin.json')
  })

  it('rejects ids ZCode never mints, before touching the CLI', async () => {
    const traversal = await post({ kind: 'zcode', id: 'sess_../../etc/passwd', prompt: 'p' })
    expect(traversal.status).toBe(400)

    const foreign = await post({ kind: 'zcode', id: '9a3c1f2e-1111-4111-8111-111111111111', prompt: 'p' })
    expect(foreign.status).toBe(400)
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })

  it('fails with 503 rather than silently using another provider', async () => {
    mocks.launch = null
    const response = await post({ kind: 'zcode', id: SESSION, prompt: 'p' })
    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('ZCODE_CLI_BIN')
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })
})
