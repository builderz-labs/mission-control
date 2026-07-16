import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('filesystem race hardening contracts', () => {
  it('opens session and token files directly without access probes', () => {
    const sessions = source('src/app/api/sessions/continue/route.ts')
    const tokens = source('src/app/api/tokens/route.ts')

    expect(sessions).not.toContain('await fs.access(candidate)')
    expect(tokens).not.toContain('await access(DATA_PATH)')
    expect(tokens).toContain('atomicReplaceFileSync(DATA_PATH, JSON.stringify(data, null, 2))')
  })

  it('binds workspace size validation and reads to one descriptor', () => {
    const agentSync = source('src/lib/agent-sync.ts')

    expect(agentSync).toContain("const descriptor = openSync(safePath, 'r')")
    expect(agentSync).toContain('const size = fstatSync(descriptor).size')
    expect(agentSync).toContain("readFileSync(descriptor, 'utf-8')")
  })

  it('uses exclusive initialization for GNAP metadata', () => {
    const gnap = source('src/lib/gnap-sync.ts')

    expect(gnap).toContain("{ flag: 'wx', mode: 0o600 }")
    expect(gnap).not.toContain('if (!fs.existsSync(versionFile))')
    expect(gnap).not.toContain('if (!fs.existsSync(agentsFile))')
  })

  it('writes local agent soul files through no-follow descriptors', () => {
    const localSync = source('src/lib/local-agent-sync.ts')

    expect(localSync).toContain('constants.O_NOFOLLOW')
    expect(localSync).toContain('constants.O_EXCL')
    expect(localSync).not.toContain('const targetPath = existsSync(soulPath)')
  })
})
