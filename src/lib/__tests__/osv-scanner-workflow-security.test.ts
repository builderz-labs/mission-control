import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('OSV-Scanner workflow security contract', () => {
  it('compares the pnpm lockfile on pull requests with a pinned reusable workflow', () => {
    const source = readFileSync(
      join(process.cwd(), '.github/workflows/osv-scanner.yml'),
      'utf8',
    )

    expect(source).toContain('pull_request:')
    expect(source).toContain('merge_group:')
    expect(source).not.toContain('push:')
    expect(source).toContain('actions: read')
    expect(source).toContain('contents: read')
    expect(source).toContain('security-events: write')
    expect(source).not.toContain('contents: write')
    expect(source).not.toContain('pull-requests: write')
    expect(source).toContain('--lockfile=./pnpm-lock.yaml')
    expect(source).toContain('upload-sarif: true')
    expect(source).toContain('fail-on-vuln: true')

    const actionRefs = [...source.matchAll(/uses:\s+\S+@(\S+)/g)].map((match) => match[1])
    expect(actionRefs).toEqual(['9a498708959aeaef5ef730655706c5a1df1edbc2'])
  })
})
