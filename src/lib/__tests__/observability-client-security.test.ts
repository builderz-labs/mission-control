import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Observability client security contract', () => {
  it('routes log and memory graph reads through the shared API client', () => {
    const logViewer = readFileSync(
      join(process.cwd(), 'src/components/panels/log-viewer-panel.tsx'),
      'utf8',
    )
    const memoryGraph = readFileSync(
      join(process.cwd(), 'src/components/panels/memory-graph.tsx'),
      'utf8',
    )

    expect(logViewer.match(/apiFetch</g)).toHaveLength(3)
    expect(logViewer).not.toMatch(/fetch\([`'"]\/api\//)
    expect(logViewer).toContain("apiFetch<{ sources?: string[] }>('/api/logs?action=sources')")
    expect(logViewer).toContain("}>('/api/status')")

    expect(memoryGraph.match(/apiFetch</g)).toHaveLength(1)
    expect(memoryGraph).not.toMatch(/fetch\([`'"]\/api\//)
    expect(memoryGraph).toContain("'/api/memory/graph?agent=all'")
    expect(memoryGraph).toContain(
      "setError(err instanceof Error ? err.message : 'Failed to load')",
    )
  })
})
