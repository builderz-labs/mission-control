import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function handlerBody(source: string, method: string): string {
  const start = source.indexOf(`export async function ${method}(`)
  expect(start, `${method} handler`).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

function expectGuardBefore(file: string, method: string, sensitiveOperation: string) {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
  const handler = handlerBody(source, method)
  const authIndex = handler.indexOf('requireRole(')
  const guardIndex = handler.indexOf('denyUnscopedResourceForStrictWorkspace(')
  const sensitiveIndex = handler.indexOf(sensitiveOperation)

  expect(authIndex, `${file} ${method} authenticates`).toBeGreaterThanOrEqual(0)
  expect(guardIndex, `${file} ${method} is guarded`).toBeGreaterThan(authIndex)
  expect(sensitiveIndex, `${file} ${method} sensitive operation exists`).toBeGreaterThanOrEqual(0)
  expect(guardIndex, `${file} ${method} guard ordering`).toBeLessThan(sensitiveIndex)
}

describe('deployment gateway registry isolation', () => {
  it('guards gateway registry CRUD before database access or default seeding', () => {
    const file = 'src/app/api/gateways/route.ts'
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      expectGuardBefore(file, method, 'getDatabase()')
    }
  })

  it('guards gateway credential resolution before database and body access', () => {
    expectGuardBefore('src/app/api/gateways/connect/route.ts', 'POST', 'getDatabase()')
  })

  it('guards probes and health history before global database access', () => {
    expectGuardBefore('src/app/api/gateways/health/route.ts', 'POST', 'getDatabase()')
    expectGuardBefore('src/app/api/gateways/health/history/route.ts', 'GET', 'getDatabase()')
  })
})
