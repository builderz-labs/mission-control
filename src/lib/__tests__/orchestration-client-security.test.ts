import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Orchestration client security contract', () => {
  it('routes agent and workflow controls through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/orchestration-bar.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(7)
    expect(source).toContain('`/api/workflows?id=${id}`')
    expect(source).not.toMatch(/fetch\((?:['"`])\/api\/(?:agents|spawn|workflows)/)

    expect(source).toContain('function orchestrationError')
    expect(source).toContain('function isOrchestrationNetworkFailure')
    expect(source).toContain('Usage accounting is best-effort')
    expect(source.match(/raw: true/g)).toHaveLength(3)
    expect(source.match(/fetchData\(\)/g)).toHaveLength(4)
  })
})
