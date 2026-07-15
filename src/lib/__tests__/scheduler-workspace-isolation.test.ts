import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('scheduler workspace isolation', () => {
  it('selects auto-route candidates from the task workspace only', () => {
    const dispatch = source('src/lib/task-dispatch.ts')
    const start = dispatch.indexOf('export async function autoRouteInboxTasks()')
    const route = dispatch.slice(start)

    expect(route).toContain('WHERE workspace_id = ?')
    expect(route).toContain('.all(task.workspace_id)')
    expect(route).not.toContain('// Get all non-hidden, non-offline agents')
    expect(route.match(/WHERE id = \? AND workspace_id = \?/g)).toHaveLength(2)
    expect(route).toContain("alt.agent.name, now, task.id, task.workspace_id")
    expect(route).toContain("best.name, now, task.id, task.workspace_id")
  })

  it('excludes strict tasks before automated reviewer runtime access', () => {
    const dispatch = source('src/lib/task-dispatch.ts')
    const start = dispatch.indexOf('export async function runAegisReviews()')
    const end = dispatch.indexOf('export async function requeueStaleTasks()')
    const review = dispatch.slice(start, end)

    expect(review).toContain('JOIN workspaces w ON w.id = t.workspace_id')
    expect(review).toContain("AND w.isolation = 'shared'")
    expect(review.indexOf("AND w.isolation = 'shared'")).toBeLessThan(review.indexOf("callOpenClawGateway<any>("))
    expect(review.match(/WHERE id = \? AND workspace_id = \?/g)?.length).toBeGreaterThanOrEqual(6)
  })

  it('carries agent ownership through every heartbeat side effect', () => {
    const scheduler = source('src/lib/scheduler.ts')
    const start = scheduler.indexOf('async function runHeartbeatCheck()')
    const end = scheduler.indexOf('/** Sync live agent statuses')
    const heartbeat = scheduler.slice(start, end)

    expect(heartbeat).toContain('SELECT id, name, status, last_seen, workspace_id FROM agents')
    expect(heartbeat).toContain('WHERE id = ? AND workspace_id = ?')
    expect(heartbeat).toContain('description, workspace_id)')
    expect(heartbeat).toContain('source_id, workspace_id)')
    expect(heartbeat).toContain('agent.id, agent.workspace_id')
    expect(heartbeat).toContain('marked_offline_count: names.length')
    expect(heartbeat).not.toContain('detail: { marked_offline: names }')
  })
})
