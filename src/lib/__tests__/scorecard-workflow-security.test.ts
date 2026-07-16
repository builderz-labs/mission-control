import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('OpenSSF Scorecard workflow security contract', () => {
  it('keeps results repository-local with constrained permissions and immutable actions', () => {
    const source = readFileSync(
      join(process.cwd(), '.github/workflows/scorecard.yml'),
      'utf8',
    )

    expect(source).toContain('push:')
    expect(source).toContain('schedule:')
    expect(source).not.toContain('pull_request:')
    expect(source).toContain('actions: read')
    expect(source).toContain('checks: read')
    expect(source).toContain('contents: read')
    expect(source).toContain('issues: read')
    expect(source).toContain('pull-requests: read')
    expect(source).toContain('security-events: write')
    expect(source).not.toContain('id-token: write')
    expect(source).toContain('persist-credentials: false')
    expect(source).toContain('publish_results: false')
    expect(source).toContain('results_format: sarif')
    expect(source).toContain('retention-days: 5')
    expect(source).toContain('sarif_file: results.sarif')

    const actionRefs = [...source.matchAll(/uses:\s+\S+@(\S+)/g)].map((match) => match[1])
    expect(actionRefs).toHaveLength(4)
    for (const ref of actionRefs) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/)
    }
  })
})
