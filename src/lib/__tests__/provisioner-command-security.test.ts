import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('privileged provisioner command boundary', () => {
  it('does not interpolate the configured group into a shell command', () => {
    const source = readFileSync(resolve(process.cwd(), 'ops/mc-provisioner-daemon.js'), 'utf8')
    expect(source).not.toContain('execSync(`getent group')
    expect(source).toContain("execFileSync('/usr/bin/getent', ['group', SOCKET_GROUP]")
  })
})
