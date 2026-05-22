import { describe, it, expect } from 'vitest'
import { loadOrgTenantMap, resolveTenant } from '@/lib/clerk-tenant-map'

describe('loadOrgTenantMap', () => {
  it('returns dev fallback when CLERK_ORG_TENANT_MAP is unset', () => {
    const map = loadOrgTenantMap({})
    expect(map.default).toEqual({ tenantId: 1, workspaceId: 1 })
  })

  it('returns dev fallback when CLERK_ORG_TENANT_MAP is blank/whitespace', () => {
    const map = loadOrgTenantMap({ CLERK_ORG_TENANT_MAP: '   ' })
    expect(map.default).toEqual({ tenantId: 1, workspaceId: 1 })
  })

  it('parses well-formed JSON map', () => {
    const map = loadOrgTenantMap({
      CLERK_ORG_TENANT_MAP: JSON.stringify({
        ceremonia: { tenantId: 1, workspaceId: 1 },
        eric: { tenantId: 2, workspaceId: 4 },
      }),
    })
    expect(map.ceremonia).toEqual({ tenantId: 1, workspaceId: 1 })
    expect(map.eric).toEqual({ tenantId: 2, workspaceId: 4 })
  })

  it('returns fallback on invalid JSON', () => {
    const map = loadOrgTenantMap({ CLERK_ORG_TENANT_MAP: 'not-json{{{' })
    expect(map.default).toEqual({ tenantId: 1, workspaceId: 1 })
  })

  it('returns fallback when JSON is not an object', () => {
    const map = loadOrgTenantMap({ CLERK_ORG_TENANT_MAP: JSON.stringify(['a', 'b']) })
    expect(map.default).toEqual({ tenantId: 1, workspaceId: 1 })
  })

  it('drops bindings with non-numeric tenantId/workspaceId', () => {
    const map = loadOrgTenantMap({
      CLERK_ORG_TENANT_MAP: JSON.stringify({
        bad: { tenantId: 'one', workspaceId: 2 },
        good: { tenantId: 3, workspaceId: 5 },
      }),
    })
    expect(map.bad).toBeUndefined()
    expect(map.good).toEqual({ tenantId: 3, workspaceId: 5 })
  })

  it('drops bindings with non-integer or non-positive ids', () => {
    const map = loadOrgTenantMap({
      CLERK_ORG_TENANT_MAP: JSON.stringify({
        zero: { tenantId: 0, workspaceId: 1 },
        neg: { tenantId: -1, workspaceId: 1 },
        frac: { tenantId: 1.5, workspaceId: 1 },
        ok: { tenantId: 7, workspaceId: 7 },
      }),
    })
    expect(map.zero).toBeUndefined()
    expect(map.neg).toBeUndefined()
    expect(map.frac).toBeUndefined()
    expect(map.ok).toEqual({ tenantId: 7, workspaceId: 7 })
  })

  it('falls back to dev map when all bindings are invalid', () => {
    const map = loadOrgTenantMap({
      CLERK_ORG_TENANT_MAP: JSON.stringify({ bad: { tenantId: 'x', workspaceId: 'y' } }),
    })
    expect(map.default).toEqual({ tenantId: 1, workspaceId: 1 })
  })
})

describe('resolveTenant', () => {
  const map = {
    ceremonia: { tenantId: 1, workspaceId: 1 },
    eric: { tenantId: 2, workspaceId: 4 },
  }

  it('returns null when orgSlug is null', () => {
    expect(resolveTenant(null, map)).toBeNull()
  })

  it('returns null when orgSlug is empty string', () => {
    expect(resolveTenant('', map)).toBeNull()
  })

  it('returns null for unknown orgSlug (fail closed)', () => {
    expect(resolveTenant('unknown', map)).toBeNull()
  })

  it('returns binding for known orgSlug', () => {
    expect(resolveTenant('ceremonia', map)).toEqual({ tenantId: 1, workspaceId: 1 })
    expect(resolveTenant('eric', map)).toEqual({ tenantId: 2, workspaceId: 4 })
  })

  it('reads from env-derived map when no map arg passed', () => {
    // Using process.env directly; default fallback yields the dev map
    const result = resolveTenant('default')
    expect(result).toEqual({ tenantId: 1, workspaceId: 1 })
  })
})
