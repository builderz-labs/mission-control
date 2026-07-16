import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readRoute = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('privileged identity mutation rate limits', () => {
  it.each([
    ['src/app/api/auth/users/route.ts', 3],
    ['src/app/api/auth/access-requests/route.ts', 1],
    ['src/app/api/tokens/rotate/route.ts', 1],
  ])('guards every privileged mutation in %s', (path, expectedGuards) => {
    const source = readRoute(path)
    expect(source.match(/identitySecurityMutationLimiter\(/g)).toHaveLength(expectedGuards)
    expect(source).not.toContain('mutationLimiter(request)')
  })

  it('defines the shared limiter as critical and keyed by authenticated admin identity', () => {
    const source = readRoute('src/lib/rate-limit.ts')
    const definition = source.slice(
      source.indexOf('export const identitySecurityMutationLimiter'),
      source.indexOf('/** Local skill writes'),
    )

    expect(definition).toContain('createKeyedRateLimiter')
    expect(definition).toContain('critical: true')
    expect(definition).toContain('maxRequests: 20')
  })

  it.each([
    ['src/app/api/auth/users/route.ts', ':users`'],
    ['src/app/api/auth/access-requests/route.ts', ':access-requests`'],
    ['src/app/api/tokens/rotate/route.ts', ':api-key`'],
  ])('isolates the quota domain in %s', (path, domain) => {
    expect(readRoute(path)).toContain(domain)
  })
})
