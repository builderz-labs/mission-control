import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Alert Rules client security contract', () => {
  it('uses the shared client while preserving refresh and network feedback', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/alert-rules-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch(?:<[^>]+>)?\('\/api\/alerts'/g)).toHaveLength(5)
    expect(source).not.toMatch(/fetch\(['"]\/api\/alerts/)
    expect(source).toContain("err.code === 'NETWORK_ERROR'")
    expect(source).toContain("t('networkError')")
    expect(source.match(/finally \{ fetchRules\(\) \}/g)).toHaveLength(2)
    expect(source).toContain('fetchRules() // refresh trigger counts')
  })
})
