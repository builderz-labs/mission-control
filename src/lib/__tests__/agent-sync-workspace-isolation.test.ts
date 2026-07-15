import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('agent sync workspace ownership', () => {
  it('scopes gateway config reconciliation by workspace on every database operation', () => {
    const sync = source('src/lib/agent-sync.ts')

    expect(sync).toContain('resolveSharedRuntimeWorkspaceId(requestedWorkspaceId)')
    expect(sync).toContain('WHERE name = ? AND workspace_id = ?')
    expect(sync).toContain('config, workspace_id)')
    expect(sync).toContain('WHERE workspace_id = ?')
    expect(sync).toContain('findByName.get(mapped.name, workspaceId)')
    expect(sync).toContain('mapped.name, workspaceId)')
  })

  it('scopes local disk reconciliation by workspace on reads and writes', () => {
    const sync = source('src/lib/local-agent-sync.ts')

    expect(sync).toContain("WHERE source = 'local' AND workspace_id = ?")
    expect(sync).toContain('updated_at, workspace_id)')
    expect(sync).toContain('WHERE id = ? AND workspace_id = ?')
    expect(sync).toContain('existing.id, workspaceId)')
    expect(sync).toContain('row.id, workspaceId)')
  })

  it('propagates authenticated ownership and fails closed for ambiguous automation', () => {
    const route = source('src/app/api/agents/sync/route.ts')
    const schedulerRoute = source('src/app/api/scheduler/route.ts')
    const scheduler = source('src/lib/scheduler.ts')
    const gatewaySync = source('src/lib/agent-sync.ts')

    expect(route).toContain('syncLocalAgents(auth.user.workspace_id)')
    expect(route).toContain('syncAgentsFromConfig(auth.user.username, auth.user.workspace_id)')
    expect(route).toContain('previewSyncDiff(auth.user.workspace_id)')
    expect(schedulerRoute).toContain('triggerTask(taskId, auth.user.workspace_id)')
    expect(gatewaySync).toContain("error: 'Global agent sync requires one unambiguous shared workspace'")
    expect(scheduler).toContain("if (r.error) return { ok: false, message: r.error }")
  })
})
