import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Agent Squad client security contract', () => {
  it('routes every agents API request through the shared authenticated client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/agent-squad-panel.tsx'),
      'utf8',
    )

    expect(source).toContain("apiFetch<{ agents: Agent[] }>('/api/agents')")
    expect(source.match(/apiFetch\('\/api\/agents'/g)).toHaveLength(3)
    expect(source).not.toMatch(/fetch\(['"]\/api\/agents/)
  })
})
