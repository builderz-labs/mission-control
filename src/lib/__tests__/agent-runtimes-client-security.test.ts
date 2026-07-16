import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Agent runtimes client security contract', () => {
  it('routes runtime supply-chain controls through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/settings/agent-runtimes-section.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch<RuntimeResponse>\('\/api\/agent-runtimes'/g)).toHaveLength(5)
    expect(source).not.toMatch(/fetch\(['"]\/api\/agent-runtimes/)
    expect(source).toContain('function isRuntimeTransportFailure')
    expect(source).toContain("error.code === 'NETWORK_ERROR' || error.code === 'PARSE_ERROR'")
    expect(source.match(/if \(!isRuntimeTransportFailure\(err\)\) return/g)).toHaveLength(2)
    expect(source).toContain("JSON.stringify({ action: 'job-status', jobId: job.id })")
    expect(source).toContain("JSON.stringify({ action: 'install', runtime: runtimeId, mode: 'local' })")
  })
})
