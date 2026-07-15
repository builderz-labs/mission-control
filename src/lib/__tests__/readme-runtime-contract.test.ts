import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const readme = readFileSync(join(root, 'README.md'), 'utf8')

describe('README runtime contract', () => {
  it('documents the shipped workspace and OpenAPI routes', () => {
    expect(readme).toContain('workspace-aware')
    expect(readme).toContain('Strict workspaces block')
    expect(readme).toContain('interactive reference at `/docs`')
    expect(readme).toContain('OpenAPI JSON at `/api/docs`')
    expect(readme).not.toContain('main runtime is self-hosted and single-tenant')
    expect(readme).not.toContain('`/api-docs`')
  })

  it('does not embed the inaccurate single-tenant blueprint', () => {
    expect(readme).not.toContain('docs/mission-control-blueprint')
  })
})
