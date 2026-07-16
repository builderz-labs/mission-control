import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Docker publication workflow contracts', () => {
  const source = readFileSync(
    join(process.cwd(), '.github/workflows/docker-publish.yml'),
    'utf8',
  )

  it('publishes only direct protected refs and isolates their concurrency', () => {
    expect(source).toContain('group: docker-publish-${{ github.ref }}')
    expect(source).toContain('cancel-in-progress: true')
    expect(source).not.toContain('cancel-in-progress: false')
    expect(source).not.toContain('workflow_run:')
    expect(source).not.toContain('github.event.workflow_run')
  })
})
