import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as InstanceType<typeof Database> | null,
  memoryDir: '/tmp/mission-control-isolation-test',
  auditEvents: [] as unknown[],
}))

vi.mock('@/lib/config', () => ({
  config: {
    get memoryDir() { return state.memoryDir },
  },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => state.db,
  logAuditEvent: (event: unknown) => state.auditEvents.push(event),
}))

import type { User } from '@/lib/auth'
import { rebuildIndex, searchMemory } from '@/lib/memory-search'
import {
  denyUnscopedResourceForStrictWorkspace,
  resolveSharedRuntimeWorkspaceId,
  resolveWorkspaceMemoryAccess,
} from '@/lib/workspace-isolation'

const sharedUser = {
  id: 1,
  username: 'shared-user',
  role: 'admin',
  workspace_id: 1,
  tenant_id: 10,
} as User

const strictUser = {
  id: 2,
  username: 'strict-user',
  role: 'admin',
  workspace_id: 2,
  tenant_id: 10,
} as User

let tempRoot = ''

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mc-isolation-'))
  state.memoryDir = tempRoot
  state.db = new Database(':memory:')
  state.db.exec(`
    CREATE TABLE workspaces (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, isolation TEXT NOT NULL);
    INSERT INTO workspaces (id, tenant_id, isolation) VALUES (1, 10, 'shared'), (2, 10, 'strict');
  `)
})

afterAll(() => {
  state.db?.close()
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('workspace isolation policy', () => {
  it('keeps shared memory on the common root and scopes strict memory by workspace', () => {
    expect(resolveWorkspaceMemoryAccess(sharedUser)).toEqual({
      isolation: 'shared',
      root: tempRoot,
      scope: 'shared',
    })
    expect(resolveWorkspaceMemoryAccess(strictUser)).toEqual({
      isolation: 'strict',
      root: join(tempRoot + '-workspaces', '2'),
      scope: 'workspace:2',
    })
  })

  it('allows shared workspaces but denies unowned resources to strict workspaces', async () => {
    expect(denyUnscopedResourceForStrictWorkspace(sharedUser, 'local_sessions', '/api/sessions')).toBeNull()

    const denied = denyUnscopedResourceForStrictWorkspace(strictUser, 'local_sessions', '/api/sessions')
    expect(denied?.status).toBe(403)
    expect(await denied?.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('no workspace ownership metadata'),
    }))
    expect(state.auditEvents).toContainEqual(expect.objectContaining({
      action: 'workspace_isolation_denied',
      target_id: 2,
      detail: expect.objectContaining({
        resource: 'local_sessions',
        route: '/api/sessions',
      }),
    }))
  })

  it('fails closed when workspace and tenant context do not match', () => {
    const mismatched = { ...strictUser, tenant_id: 999 }
    const denied = denyUnscopedResourceForStrictWorkspace(mismatched, 'session_transcripts', '/api/sessions/transcript')
    expect(denied?.status).toBe(403)
    expect(resolveWorkspaceMemoryAccess(mismatched)).toBeNull()
  })

  it('resolves only explicit or unambiguous shared runtime ownership', () => {
    expect(resolveSharedRuntimeWorkspaceId()).toBe(1)
    expect(resolveSharedRuntimeWorkspaceId(1)).toBe(1)
    expect(resolveSharedRuntimeWorkspaceId(2)).toBeNull()
    expect(resolveSharedRuntimeWorkspaceId(999)).toBeNull()

    state.db?.prepare(
      "INSERT INTO workspaces (id, tenant_id, isolation) VALUES (3, 10, 'shared')",
    ).run()
    expect(resolveSharedRuntimeWorkspaceId()).toBeNull()
    state.db?.prepare('DELETE FROM workspaces WHERE id = 3').run()
  })
})

describe('workspace-scoped memory search', () => {
  it('keeps FTS rows and metadata isolated by scope', async () => {
    const sharedRoot = join(tempRoot, 'shared-fixture')
    const strictRoot = join(tempRoot, 'strict-fixture')
    mkdirSync(sharedRoot, { recursive: true })
    mkdirSync(strictRoot, { recursive: true })
    writeFileSync(join(sharedRoot, 'shared.md'), '# Shared\n\nsharedonlytoken')
    writeFileSync(join(strictRoot, 'strict.md'), '# Strict\n\nstrictonlytoken')

    await rebuildIndex(sharedRoot, [], 'shared')
    await rebuildIndex(strictRoot, [], 'workspace:2')

    const strictOwn = await searchMemory(strictRoot, [], 'strictonlytoken', { scope: 'workspace:2' })
    const strictLeak = await searchMemory(strictRoot, [], 'sharedonlytoken', { scope: 'workspace:2' })
    const sharedOwn = await searchMemory(sharedRoot, [], 'sharedonlytoken', { scope: 'shared' })

    expect(strictOwn.results.map((row) => row.path)).toEqual(['strict.md'])
    expect(strictLeak.results).toEqual([])
    expect(sharedOwn.results.map((row) => row.path)).toEqual(['shared.md'])
    expect(strictOwn.indexedFiles).toBe(1)
    expect(sharedOwn.indexedFiles).toBe(1)
  })
})

describe('direct session API coverage', () => {
  it('guards every deployment-global session route', () => {
    const files = [
      'src/app/api/sessions/route.ts',
      'src/app/api/sessions/continue/route.ts',
      'src/app/api/sessions/[id]/control/route.ts',
      'src/lib/session-transcript-route.ts',
      'src/app/api/sessions/transcript/gateway/route.ts',
      'src/app/api/sessions/transcript/aggregate/route.ts',
      'src/app/api/claude/sessions/route.ts',
      'src/app/api/chat/session-prefs/route.ts',
    ]

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).toContain('denyUnscopedResourceForStrictWorkspace')
    }
  })

  it('guards indirect global session consumers', () => {
    const statusRoute = readFileSync(join(process.cwd(), 'src/app/api/status/route.ts'), 'utf8')
    const chatRoute = readFileSync(join(process.cwd(), 'src/app/api/chat/messages/route.ts'), 'utf8')
    const ptyRoute = readFileSync(join(process.cwd(), 'src/app/api/pty/attach/route.ts'), 'utf8')
    const ptyWebSocket = readFileSync(join(process.cwd(), 'src/lib/pty-websocket.ts'), 'utf8')

    expect(statusRoute).toContain("const includeGlobalRuntime = isolation === 'shared'")
    expect(statusRoute).toContain('if (includeGlobalRuntime) {')
    expect(chatRoute).toContain('const sessions = strictWorkspace ? [] : getAllGatewaySessions()')
    expect(chatRoute).toContain('if (!strictWorkspace && !sessionKey)')
    expect(chatRoute).toContain('if (strictWorkspace && !sessionKey)')
    expect(ptyRoute).toContain("'terminal_sessions'")
    expect(ptyWebSocket).toContain("'terminal_sessions'")
  })

  it('guards remaining runtime filesystem consumers', () => {
    const filesRoute = readFileSync(join(process.cwd(), 'src/app/api/agents/[id]/files/route.ts'), 'utf8')
    const memoryRoute = readFileSync(join(process.cwd(), 'src/app/api/memory/route.ts'), 'utf8')
    const agentMemoryRoute = readFileSync(join(process.cwd(), 'src/app/api/agents/[id]/memory/route.ts'), 'utf8')
    const soulRoute = readFileSync(join(process.cwd(), 'src/app/api/agents/[id]/soul/route.ts'), 'utf8')
    const tokensRoute = readFileSync(join(process.cwd(), 'src/app/api/tokens/route.ts'), 'utf8')
    const hermesRoute = readFileSync(join(process.cwd(), 'src/app/api/hermes/route.ts'), 'utf8')
    const claudeTasksRoute = readFileSync(join(process.cwd(), 'src/app/api/claude-tasks/route.ts'), 'utf8')

    expect(filesRoute).toContain("'agent_filesystem'")
    expect(filesRoute).toContain('atomicReplaceFileSync(safePath, content)')
    expect(memoryRoute).toContain('atomicReplaceFileSync(fullPath, content)')
    expect(agentMemoryRoute).toContain('atomicReplaceFileSync(safeWorkingPath, newContent)')
    expect(agentMemoryRoute).toContain("atomicReplaceFileSync(safeWorkingPath, '')")
    expect(soulRoute).toContain("const auth = requireRole(request, 'viewer')")
    expect(soulRoute).toContain('if (!isStrictWorkspace)')
    expect(soulRoute).toContain("atomicReplaceFileSync(safeSoulPath, newSoulContent || '')")
    expect(tokensRoute).toContain("const tokenData = await loadTokenData(workspaceId, isolation === 'shared')")
    expect(tokensRoute).toContain('if (!isStrictWorkspace)')
    expect(hermesRoute.match(/'runtime_configuration'/g)).toHaveLength(2)
    expect(claudeTasksRoute).toContain("'runtime_tasks'")
  })

  it('guards deployment-global runtime configuration operations', () => {
    const cronRoute = readFileSync(join(process.cwd(), 'src/app/api/cron/route.ts'), 'utf8')
    const integrationsRoute = readFileSync(join(process.cwd(), 'src/app/api/integrations/route.ts'), 'utf8')

    expect(cronRoute.match(/'runtime_configuration'/g)).toHaveLength(2)
    expect(integrationsRoute.match(/'runtime_configuration'/g)).toHaveLength(4)
  })

  it('guards deployment-global host administration operations', () => {
    const expectedOperations = new Map([
      ['src/app/api/backup/route.ts', 3],
      ['src/app/api/cleanup/route.ts', 2],
      ['src/app/api/diagnostics/route.ts', 1],
      ['src/app/api/logs/route.ts', 2],
      ['src/app/api/system-monitor/route.ts', 1],
    ])

    for (const [file, operations] of expectedOperations) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source.match(/'host_administration'/g), file).toHaveLength(operations)
    }
  })

  it('guards deployment-global gateway and local host operations', () => {
    const runtimeFiles = new Map([
      ['src/app/api/gateway-config/route.ts', 2],
      ['src/app/api/gateways/control/route.ts', 2],
      ['src/app/api/gateways/discover/route.ts', 1],
    ])
    const hostFiles = new Map([
      ['src/app/api/local/terminal/route.ts', 1],
      ['src/app/api/local/flight-deck/route.ts', 2],
      ['src/app/api/local/agents-doc/route.ts', 1],
    ])

    for (const [file, operations] of runtimeFiles) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source.match(/'runtime_configuration'/g), file).toHaveLength(operations)
    }
    for (const [file, operations] of hostFiles) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source.match(/'host_administration'/g), file).toHaveLength(operations)
    }
  })

  it('guards the deployment-global gateway registry and health data', () => {
    const expectedOperations = new Map([
      ['src/app/api/gateways/route.ts', 4],
      ['src/app/api/gateways/connect/route.ts', 1],
      ['src/app/api/gateways/health/route.ts', 1],
      ['src/app/api/gateways/health/history/route.ts', 1],
    ])

    for (const [file, operations] of expectedOperations) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source.match(/["']runtime_configuration["']/g), file).toHaveLength(operations)
    }
  })

  it('fails closed for deployment-global background dispatch and scheduling', () => {
    const dispatch = readFileSync(join(process.cwd(), 'src/lib/task-dispatch.ts'), 'utf8')
    const scheduler = readFileSync(join(process.cwd(), 'src/app/api/scheduler/route.ts'), 'utf8')

    expect(dispatch.match(/JOIN workspaces w ON w\.id = t\.workspace_id/g)).toHaveLength(3)
    expect(dispatch.match(/AND w\.isolation = 'shared'/g)).toHaveLength(3)
    expect(scheduler.match(/'host_administration'/g)).toHaveLength(2)
  })

  it('guards deployment-global spawn, pipeline execution, and agent sync', () => {
    const spawn = readFileSync(join(process.cwd(), 'src/app/api/spawn/route.ts'), 'utf8')
    const pipelines = readFileSync(join(process.cwd(), 'src/app/api/pipelines/run/route.ts'), 'utf8')
    const agentSync = readFileSync(join(process.cwd(), 'src/app/api/agents/sync/route.ts'), 'utf8')

    expect(spawn).toContain("'runtime_tasks'")
    expect(spawn).toContain("'host_administration'")
    expect(pipelines).toContain("action === 'start' || action === 'advance'")
    expect(pipelines).toContain("'runtime_tasks'")
    expect(agentSync.match(/'runtime_configuration'/g)).toHaveLength(2)
  })

  it('binds global agent synchronization to shared workspace ownership', () => {
    const gatewaySync = readFileSync(join(process.cwd(), 'src/lib/agent-sync.ts'), 'utf8')
    const localSync = readFileSync(join(process.cwd(), 'src/lib/local-agent-sync.ts'), 'utf8')
    const scheduler = readFileSync(join(process.cwd(), 'src/lib/scheduler.ts'), 'utf8')

    expect(gatewaySync).toContain('resolveSharedRuntimeWorkspaceId(requestedWorkspaceId)')
    expect(gatewaySync.match(/workspace_id/g)?.length).toBeGreaterThanOrEqual(4)
    expect(localSync).toContain('resolveSharedRuntimeWorkspaceId(requestedWorkspaceId)')
    expect(localSync.match(/workspace_id/g)?.length).toBeGreaterThanOrEqual(4)
    expect(scheduler).toContain('resolveSharedRuntimeWorkspaceId(requestedWorkspaceId)')
    expect(scheduler).toContain("if (r.error) return { ok: false, message: r.error }")
  })

  it('keeps scheduler routing, review, and heartbeat mutations workspace-scoped', () => {
    const dispatch = readFileSync(join(process.cwd(), 'src/lib/task-dispatch.ts'), 'utf8')
    const scheduler = readFileSync(join(process.cwd(), 'src/lib/scheduler.ts'), 'utf8')

    expect(dispatch).toContain("WHERE workspace_id = ?\n        AND hidden = 0")
    expect(dispatch).toContain("WHERE t.status = 'review'\n      AND w.isolation = 'shared'")
    expect(scheduler).toContain('SELECT id, name, status, last_seen, workspace_id FROM agents')
    expect(scheduler).toContain("VALUES ('agent_status_change', 'agent', ?, 'heartbeat', ?, ?)")
    expect(scheduler).toContain("VALUES ('system', 'heartbeat', ?, ?, 'agent', ?, ?)")
  })
})
