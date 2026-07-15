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

describe('gateway and local host runtime isolation', () => {
  it('guards deployment gateway configuration before reads, RPC, or mutation work', () => {
    const file = 'src/app/api/gateway-config/route.ts'
    expectGuardBefore(file, 'GET', 'request.nextUrl.searchParams')
    expectGuardBefore(file, 'PUT', 'gatewayConfigMutationLimiter(limitKey)')
  })

  it('guards gateway status, control, and discovery before host access', () => {
    expectGuardBefore('src/app/api/gateways/control/route.ts', 'GET', 'const gateways:')
    expectGuardBefore('src/app/api/gateways/control/route.ts', 'POST', 'gatewayControlLimiter(limitKey)')
    expectGuardBefore('src/app/api/gateways/discover/route.ts', 'GET', 'execFileSync(')
  })

  it('guards local apps and instruction files before host access or parsing', () => {
    expectGuardBefore('src/app/api/local/terminal/route.ts', 'POST', 'request.json()')
    expectGuardBefore('src/app/api/local/flight-deck/route.ts', 'GET', 'resolveFlightDeckInstallPath()')
    expectGuardBefore('src/app/api/local/flight-deck/route.ts', 'POST', 'resolveFlightDeckInstallPath()')
    expectGuardBefore('src/app/api/local/agents-doc/route.ts', 'GET', 'process.cwd()')
  })
})
