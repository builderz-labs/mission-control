import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('CodeQL workflow security contract', () => {
  it('uses least privilege, immutable actions, and the JavaScript/TypeScript analyzer', () => {
    const source = readFileSync(
      join(process.cwd(), '.github/workflows/codeql.yml'),
      'utf8',
    )

    expect(source).toContain('pull_request:')
    expect(source).toContain('push:')
    expect(source).toContain('schedule:')
    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('contents: read')
    expect(source).toContain('actions: read')
    expect(source).toContain('security-events: write')
    expect(source).not.toContain('contents: write')
    expect(source).not.toContain('pull-requests: write')
    expect(source).toContain('languages: javascript-typescript')
    expect(source).toContain('queries: security-extended')
    expect(source).not.toContain('autobuild')

    const actionRefs = [...source.matchAll(/uses:\s+\S+@(\S+)/g)].map((match) => match[1])
    expect(actionRefs).toHaveLength(3)
    for (const ref of actionRefs) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/)
    }
  })
})
