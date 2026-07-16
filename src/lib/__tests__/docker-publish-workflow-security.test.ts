import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Docker publication workflow contracts', () => {
  const source = readFileSync(
    join(process.cwd(), '.github/workflows/docker-publish.yml'),
    'utf8',
  )

  it('cancels superseded publications without sharing branch and tag groups', () => {
    expect(source).toContain(
      "group: docker-publish-${{ github.event_name == 'workflow_run' && format('branch-{0}', github.event.workflow_run.head_branch) || format('{0}-{1}', github.ref_type, github.ref_name) }}",
    )
    expect(source).toContain('cancel-in-progress: true')
    expect(source).not.toContain('cancel-in-progress: false')
  })
})
