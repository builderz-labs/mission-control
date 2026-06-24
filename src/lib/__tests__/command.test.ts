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

import { runCommand } from '@/lib/command'

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
})
