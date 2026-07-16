import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Context inventory client security contract', () => {
  it('routes tenant, OS-user, and project inventory through the shared client', () => {
    const source = readFileSync(join(process.cwd(), 'src/store/index.ts'), 'utf8')

    expect(source).toContain("apiFetch<{ tenants?: Tenant[] }>('/api/super/tenants'")
    expect(source).toContain("apiFetch<{ users?: OsUser[] }>('/api/super/os-users'")
    expect(source).toContain("apiFetch<{ projects?: Project[] }>('/api/projects'")
    expect(source).not.toMatch(
      /fetch\(['"]\/api\/(?:super\/tenants|super\/os-users|projects)/,
    )
    expect(source.match(/Array\.isArray\(data\?\./g)).toHaveLength(3)
    expect((source.match(/\} catch \{\}/g) || []).length).toBeGreaterThanOrEqual(3)
  })
})
