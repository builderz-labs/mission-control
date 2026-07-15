import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('deployment-global runtime execution isolation', () => {
  it('denies spawn execution and host-log history before global resource access', () => {
    const route = source('src/app/api/spawn/route.ts')
    const post = route.slice(route.indexOf('export async function POST'), route.indexOf('// Get spawn history'))
    const get = route.slice(route.indexOf('export async function GET'))

    expect(post.indexOf("'runtime_tasks'")).toBeGreaterThan(-1)
    expect(post.indexOf("'runtime_tasks'")).toBeLessThan(post.indexOf('heavyLimiter(request)'))
    expect(post.indexOf("'runtime_tasks'")).toBeLessThan(post.indexOf('validateBody(request'))
    expect(post.indexOf("'runtime_tasks'")).toBeLessThan(post.indexOf("callOpenClawGateway('sessions_spawn'"))
    expect(get.indexOf("'host_administration'")).toBeGreaterThan(-1)
    expect(get.indexOf("'host_administration'")).toBeLessThan(get.indexOf('heavyLimiter(request)'))
    expect(get.indexOf("'host_administration'")).toBeLessThan(get.indexOf('readdir(config.logsDir)'))
  })

  it('denies only pipeline actions that invoke the global CLI', () => {
    const route = source('src/app/api/pipelines/run/route.ts')
    const post = route.slice(route.indexOf('export async function POST'), route.indexOf('/** Spawn a single pipeline step'))

    expect(post).toContain("action === 'start' || action === 'advance'")
    expect(post).toContain("'runtime_tasks'")
    expect(post.indexOf("'runtime_tasks'")).toBeLessThan(post.indexOf("if (action === 'start')"))
    expect(post).toContain("action === 'cancel'")
    expect(route).toContain("SELECT * FROM pipeline_runs WHERE id = ? AND workspace_id = ?")
  })

  it('denies agent synchronization before global config or disk access', () => {
    const route = source('src/app/api/agents/sync/route.ts')
    const post = route.slice(route.indexOf('export async function POST'), route.indexOf('/**\n * GET'))
    const get = route.slice(route.indexOf('export async function GET'))

    expect(post.indexOf("'runtime_configuration'")).toBeGreaterThan(-1)
    expect(post.indexOf("'runtime_configuration'")).toBeLessThan(post.indexOf('syncLocalAgents()'))
    expect(post.indexOf("'runtime_configuration'")).toBeLessThan(post.indexOf('syncAgentsFromConfig('))
    expect(get.indexOf("'runtime_configuration'")).toBeGreaterThan(-1)
    expect(get.indexOf("'runtime_configuration'")).toBeLessThan(get.indexOf('previewSyncDiff()'))
  })
})
