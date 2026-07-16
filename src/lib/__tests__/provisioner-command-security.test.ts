import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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
    expect(source).toContain('runWithRetry(command, args, timeoutMs)')
    expect(source).not.toContain('runWithRetry(requestedCommand, args, timeoutMs)')
  })
})
