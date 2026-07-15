import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function preparedTemplateSql(path: string): string[] {
  return [...source(path).matchAll(/\.prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1])
}

describe('workspace-owned SQL regressions', () => {
  it('scopes pipeline template reads and validation', () => {
    const pipelines = source('src/app/api/pipelines/route.ts')
    const runs = source('src/app/api/pipelines/run/route.ts')

    expect(pipelines).toContain('FROM workflow_templates WHERE workspace_id = ?')
    expect(pipelines).toContain('AND workspace_id = ?`')
    expect(runs.match(/FROM workflow_templates[^\n]+workspace_id = \?/g)).toHaveLength(2)
  })

  it('scopes reusable activity and status aggregates', () => {
    const db = source('src/lib/db.ts')
    const status = source('src/app/api/status/route.ts')
    const diagnostics = source('src/app/api/diagnostics/route.ts')

    expect(db).toContain('SELECT * FROM activities\n      WHERE workspace_id = ?')
    expect(status).toContain("pipeline_runs WHERE status = 'running' AND workspace_id = ?")
    expect(status).toContain('webhooks WHERE workspace_id = ?')
    expect(diagnostics).toContain('agents WHERE workspace_id = ? GROUP BY status')
  })

  it('scopes every token-usage analytics query', () => {
    for (const file of ['src/lib/agent-evals.ts', 'src/lib/agent-optimizer.ts']) {
      const tokenQueries = preparedTemplateSql(file).filter((sql) => sql.includes('token_usage'))
      expect(tokenQueries.length, file).toBeGreaterThan(0)
      for (const sql of tokenQueries) {
        expect(sql, file).toContain('workspace_id = ?')
      }
    }
  })

  it('scopes background task and integration mutations', () => {
    const dispatch = source('src/lib/task-dispatch.ts')
    const github = source('src/lib/github-sync-engine.ts')
    const recurring = source('src/lib/recurring-tasks.ts')
    const webhooks = source('src/lib/webhooks.ts')

    expect(dispatch).not.toMatch(/(?:FROM|UPDATE) tasks WHERE id = \?(?! AND workspace_id)/)
    expect(dispatch).not.toMatch(/FROM comments\s+WHERE task_id = \?(?![\s\S]{0,120}workspace_id)/)
    expect(github).toContain('UPDATE tasks SET github_synced_at = ? WHERE id = ? AND workspace_id = ?')
    expect(github).toContain('WHERE id = ? AND workspace_id = ?\n    `).run(created.number')
    expect(recurring).toContain('WHERE id = ? AND workspace_id = ?')
    expect(webhooks).toContain('webhook_deliveries SET next_retry_at = ? WHERE id = ? AND workspace_id = ?')
  })
})
