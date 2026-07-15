import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function handlerBody(source: string, method: string): string {
  const start = source.indexOf(`export async function ${method}(`)
  expect(start, `${method} handler`).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('background dispatch workspace isolation', () => {
  it('filters dispatch and deferred reconciliation at the authoritative workspace join', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/task-dispatch.ts'), 'utf8')
    const dispatchStart = source.indexOf('export async function dispatchAssignedTasks()')
    const reconciliationStart = source.indexOf('export async function reconcileDeferredTaskCompletions(')
    const reconciliationEnd = source.indexOf('// Direct Claude API dispatch', reconciliationStart)
    const dispatchEnd = source.indexOf('// Auto-routing:', dispatchStart)
    const reconciliation = source.slice(reconciliationStart, reconciliationEnd)
    const dispatch = source.slice(dispatchStart, dispatchEnd)

    for (const boundary of [reconciliation, dispatch]) {
      expect(boundary).toContain('JOIN workspaces w ON w.id = t.workspace_id')
      expect(boundary).toContain("AND w.isolation = 'shared'")
    }
  })

  it('guards scheduler reads and triggers before global work', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/scheduler/route.ts'), 'utf8')
    const cases = [
      ['GET', 'getSchedulerStatus()'],
      ['POST', 'request.json()'],
    ] as const

    for (const [method, sensitiveOperation] of cases) {
      const handler = handlerBody(source, method)
      const authIndex = handler.indexOf('requireRole(')
      const guardIndex = handler.indexOf('denyUnscopedResourceForStrictWorkspace(')
      const sensitiveIndex = handler.indexOf(sensitiveOperation)
      expect(guardIndex, `${method} guard after auth`).toBeGreaterThan(authIndex)
      expect(guardIndex, `${method} guard before work`).toBeLessThan(sensitiveIndex)
    }
  })
})
