import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Nodes client security contract', () => {
  it('routes node and device trust controls through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/nodes-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(3)
    expect(source).not.toMatch(/fetch\(['"]\/api\/nodes/)
    expect(source).toContain('const payload = err instanceof ApiError ? err.payload : null')
    expect(source).toContain('`Request failed (${err.status})`')
    expect(source).toContain("err.code !== 'NETWORK_ERROR'")
    expect(source).toContain("err.code !== 'PARSE_ERROR'")
    expect(source).toContain("apiFetch<{")
    expect(source).toContain("}>('/api/nodes?action=devices')")
    expect(source).toContain('// silent fallback')
  })
})
