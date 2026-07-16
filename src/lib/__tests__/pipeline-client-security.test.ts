import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Pipeline client security contract', () => {
  it('routes definition and execution controls through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/pipeline-tab.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(8)
    expect(source).toContain('`/api/pipelines?id=${id}`')
    expect(source).not.toMatch(/fetch\((?:['"`])\/api\/(?:workflows|pipelines)/)

    expect(source).toContain('function pipelineError')
    expect(source).toContain('function isPipelineNetworkFailure')
    expect(source).toContain("apiFetch<PipelineMutationResult>('/api/pipelines/run'")
    expect(source.match(/raw: true/g)).toHaveLength(4)
    expect(source.match(/fetchData\(\)/g)).toHaveLength(6)
  })
})
