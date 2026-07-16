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

describe('deployment host administration isolation', () => {
  it('guards whole-deployment backup operations before side effects or parsing', () => {
    const file = 'src/app/api/backup/route.ts'
    expectGuardBefore(file, 'GET', 'ensureDirExists(BACKUP_DIR)')
    expectGuardBefore(file, 'POST', 'backupMutationLimiter(limitKey)')
    expectGuardBefore(file, 'DELETE', 'backupMutationLimiter(limitKey)')
  })

  it('guards global retention operations before database, limiting, or parsing', () => {
    const file = 'src/app/api/cleanup/route.ts'
    expectGuardBefore(file, 'GET', 'getDatabase()')
    expectGuardBefore(file, 'POST', 'heavyLimiter(request)')
  })

  it('guards deployment observability before host work', () => {
    expectGuardBefore('src/app/api/diagnostics/route.ts', 'GET', 'Promise.all([')
    expectGuardBefore('src/app/api/logs/route.ts', 'GET', 'readLimiter(request)')
    expectGuardBefore('src/app/api/logs/route.ts', 'POST', 'mutationLimiter(request)')
    expectGuardBefore('src/app/api/system-monitor/route.ts', 'GET', 'Promise.all([')
  })
})
