import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Standup client security contract', () => {
  it('uses the implemented standup route through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/standup-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(2)
    expect(source).not.toMatch(/fetch\([`'"]\/api\/standup/)
    expect(source).not.toContain('/api/standup/history')
    expect(source).toContain("apiFetch<{ standup: StandupReport }>('/api/standup'")
    expect(source).toContain(
      "apiFetch<{ history?: StandupHistory[] }>('/api/standup')",
    )
    expect(source).toContain("method: 'POST'")
    expect(source).toContain("setError(err instanceof Error ? err.message : 'An error occurred')")
    expect(source).toContain("log.error('Failed to fetch standup history:', err)")
    expect(source).toContain('id: string')
    expect(source).toContain('history.summary.totalCompleted')
    expect(source).toContain('history.summary.totalInProgress')
    expect(source).toContain('history.summary.totalBlocked')
  })
})
