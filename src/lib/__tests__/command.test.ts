import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: {
    spawn: spawnMock,
  },
}))

import { runCommand, runOpenClaw } from '@/lib/command'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  }
  kill = vi.fn()
}

describe('runCommand', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('returns a friendly message on ENOENT for openclaw', async () => {
    const child = new FakeChild()
    spawnMock.mockReturnValue(child as any)

    const promise = runCommand('openclaw', ['gateway', 'status'])
    const err = Object.assign(new Error('spawn openclaw ENOENT'), { code: 'ENOENT' })
    child.emit('error', err)

    await expect(promise).rejects.toThrow(/Command not found: openclaw/i)
    await expect(promise).rejects.toThrow(/OPENCLAW_BIN/i)
  })

  it('resolves stdout/stderr on successful exit', async () => {
    const child = new FakeChild()
    spawnMock.mockReturnValue(child as any)

    const promise = runCommand('echo', ['ok'])
    child.stdout.emit('data', Buffer.from('hello'))
    child.stderr.emit('data', Buffer.from('warn'))
    child.emit('close', 0)

    await expect(promise).resolves.toEqual({ stdout: 'hello', stderr: 'warn', code: 0 })
  })

  it('does not pass legacy OPENCLAW_HOME aliases to openclaw subprocesses', async () => {
    const originalOpenClawHome = process.env.OPENCLAW_HOME
    const originalClawdbotHome = process.env.CLAWDBOT_HOME
    process.env.OPENCLAW_HOME = '/Users/doctor/.openclaw'
    process.env.CLAWDBOT_HOME = '/Users/doctor/.openclaw'

    try {
      const child = new FakeChild()
      spawnMock.mockReturnValue(child as any)

      const promise = runOpenClaw(['doctor'])
      child.emit('close', 0)
      await promise

      const options = spawnMock.mock.calls[0]?.[2]
      expect(options.env.OPENCLAW_STATE_DIR).toBeTruthy()
      expect(options.env.OPENCLAW_HOME).toBeUndefined()
      expect(options.env.CLAWDBOT_HOME).toBeUndefined()
    } finally {
      if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
      else process.env.OPENCLAW_HOME = originalOpenClawHome
      if (originalClawdbotHome === undefined) delete process.env.CLAWDBOT_HOME
      else process.env.CLAWDBOT_HOME = originalClawdbotHome
    }
  })
})
