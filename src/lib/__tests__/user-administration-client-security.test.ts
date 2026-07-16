import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('User administration client security contract', () => {
  it('routes identity and access mutations through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/user-management-panel.tsx'),
      'utf8',
    )

    expect(source).toContain("apiFetch<{ users?: UserRecord[] }>('/api/auth/users'")
    expect(source).toContain(
      "apiFetch<{ requests?: AccessRequest[] }>('/api/auth/access-requests?status=all'",
    )
    expect(source.match(/apiFetch<UserMutationResult>\('\/api\/auth\/users'/g)).toHaveLength(3)
    expect(source).toContain(
      "apiFetch<UserMutationResult>('/api/auth/access-requests'",
    )
    expect(source).not.toMatch(/fetch\(['"]\/api\/auth\/(?:users|access-requests)/)

    expect(source).toContain('function userAdminError')
    expect(source).toContain('error instanceof ApiError')
    expect(source).toContain('err.status === 403')
    expect(source).toContain("t('adminAccessRequired')")
    expect(source.match(/userAdminError\(err\)/g)).toHaveLength(4)
    expect(source).not.toContain('const body: any')
  })
})
