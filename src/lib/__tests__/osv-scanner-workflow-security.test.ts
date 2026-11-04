import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('OSV-Scanner workflow security contract', () => {
  it('compares the pnpm lockfile on pull requests with SHA-pinned actions', () => {
    const source = readFileSync(
      join(process.cwd(), '.github/workflows/osv-scanner.yml'),
      'utf8',
    )

    expect(source).toContain('pull_request:')
    expect(source).toContain('merge_group:')
    expect(source).not.toContain('push:')
    expect(source).not.toContain('pull_request_target')
    expect(source).toContain('actions: read')
    expect(source).toContain('contents: read')
    expect(source).toContain('security-events: write')
    expect(source).not.toContain('contents: write')
    expect(source).not.toContain('pull-requests: write')
    expect(source).toContain('persist-credentials: false')
    expect(source).toContain('--lockfile=./pnpm-lock.yaml')
    expect(source).toContain('--fail-on-vuln=true')
    expect(source).toContain('upload-sarif@')
    // Scan results stay in files; exporting them as job outputs exceeds the 1 MB limit.
    expect(source).not.toContain('outputs:')

    const actionRefs = [...source.matchAll(/uses:\s+\S+@(\S+)/g)].map((match) => match[1])
    expect(actionRefs.length).toBeGreaterThan(0)
    for (const ref of actionRefs) expect(ref).toMatch(/^[0-9a-f]{40}$/)
  })
})
