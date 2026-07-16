import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  COMMAND_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  appendBounded,
} = require('../../../ops/provisioner-limits.cjs') as {
  COMMAND_TIMEOUT_MS: number
  MAX_OUTPUT_BYTES: number
  appendBounded: (current: string, chunk: string | Buffer, maxBytes?: number) => {
    value: string
    exceeded: boolean
  }
}

describe('privileged provisioner command boundary', () => {
  it('does not interpolate the configured group into a shell command', () => {
    const source = readFileSync(resolve(process.cwd(), 'ops/mc-provisioner-daemon.js'), 'utf8')
    expect(source).not.toContain('execSync(`getent group')
    expect(source).toContain("execFileSync('/usr/bin/getent', ['group', SOCKET_GROUP]")
  })

  it('executes only exact canonical command paths', () => {
    const source = readFileSync(resolve(process.cwd(), 'ops/mc-provisioner-daemon.js'), 'utf8')
    expect(source).toContain("case '/usr/sbin/useradd': return '/usr/sbin/useradd'")
    expect(source).toContain('const command = resolveAllowedCommand(requestedCommand)')
    expect(source).toContain('runWithRetry(command, args)')
    expect(source).not.toContain('runWithRetry(requestedCommand, args)')
  })

  it('enforces socket, request, output, and connection limits', () => {
    const source = readFileSync(resolve(process.cwd(), 'ops/mc-provisioner-daemon.js'), 'utf8')
    expect(source).toContain('socket.setTimeout(IDLE_SOCKET_TIMEOUT_MS')
    expect(source).toContain('socket.setTimeout(0)')
    expect(source).toContain('> MAX_REQUEST_BYTES')
    expect(source).toContain('appendBounded(target, chunk, MAX_OUTPUT_BYTES)')
    expect(source).toContain('server.maxConnections = MAX_CONNECTIONS')
  })
})

describe('provisioner resource limits', () => {
  it('uses a fixed command deadline that clients cannot extend', () => {
    const source = readFileSync(resolve(process.cwd(), 'ops/mc-provisioner-daemon.js'), 'utf8')
    expect(COMMAND_TIMEOUT_MS).toBe(20000)
    expect(source).toContain('}, COMMAND_TIMEOUT_MS)')
    expect(source).not.toContain('req.timeoutMs')
  })

  it('bounds captured output by UTF-8 byte length', () => {
    const exact = appendBounded('', 'éé', 4)
    expect(exact).toEqual({ value: 'éé', exceeded: false })

    const overflow = appendBounded('abc', Buffer.from('def'), 5)
    expect(Buffer.byteLength(overflow.value, 'utf8')).toBe(5)
    expect(overflow.value).toBe('abcde')
    expect(overflow.exceeded).toBe(true)

    const multibyteOverflow = appendBounded('', 'éé', 3)
    expect(Buffer.byteLength(multibyteOverflow.value, 'utf8')).toBeLessThanOrEqual(3)
    expect(multibyteOverflow.exceeded).toBe(true)
    expect(MAX_OUTPUT_BYTES).toBeGreaterThan(0)
  })
})
