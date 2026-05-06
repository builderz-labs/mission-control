import { describe, it, expect } from 'vitest'

const { scoreRouteCandidate, planPatches, proposedHelperName } = require('../../../scripts/boundary-patch-planner.cjs')

// Helpers to build minimal route objects
function makeRoute(overrides: {
  file?: string
  methods?: string[]
  risky_static_imports?: string[]
  risk_level?: number
}) {
  return {
    file: 'src/app/api/example/route.ts',
    methods: ['GET'],
    risky_static_imports: [],
    risk_level: 0,
    recommendation: '',
    ...overrides,
  }
}

function makeAuditResult(routes: ReturnType<typeof makeRoute>[]) {
  const risky = routes.filter((r) => r.risky_static_imports.length > 0)
  const getRoutes = risky.filter((r) => r.risk_level === 2)
  return {
    agent: 'Route Import Boundary Audit v1',
    label: 'OBSERVE ONLY',
    status: getRoutes.length > 0 ? 'WARN' : 'PASS',
    risk_level: getRoutes.length > 0 ? 2 : 0,
    summary: {
      routes_scanned: routes.length,
      routes_with_risky_imports: risky.length,
      get_routes_with_risky_imports: getRoutes.length,
    },
    routes: risky,
    recommendations: [],
  }
}

// --- scoreRouteCandidate ---

describe('scoreRouteCandidate', () => {
  it('returns null for risk_level < 2', () => {
    const route = makeRoute({ risk_level: 1, risky_static_imports: ['@/lib/super-admin'], methods: ['POST'] })
    expect(scoreRouteCandidate(route)).toBeNull()
  })

  it('GET + single super-admin scores higher than GET + child_process', () => {
    const superAdmin = makeRoute({
      risk_level: 2,
      risky_static_imports: ['@/lib/super-admin'],
      methods: ['GET'],
    })
    const childProc = makeRoute({
      risk_level: 2,
      risky_static_imports: ['child_process'],
      methods: ['GET'],
    })
    const scoreA = scoreRouteCandidate(superAdmin)!.score
    const scoreB = scoreRouteCandidate(childProc)!.score
    expect(scoreA).toBeGreaterThan(scoreB)
  })

  it('GET + single super-admin scores higher than GET + multiple imports', () => {
    const single = makeRoute({
      risk_level: 2,
      risky_static_imports: ['@/lib/super-admin'],
      methods: ['GET'],
    })
    const multi = makeRoute({
      risk_level: 2,
      risky_static_imports: ['@/lib/super-admin', 'fs', '@/lib/command'],
      methods: ['GET'],
    })
    expect(scoreRouteCandidate(single)!.score).toBeGreaterThan(scoreRouteCandidate(multi)!.score)
  })

  it('GET-only scores higher than GET+POST with same import', () => {
    const getOnly = makeRoute({
      risk_level: 2,
      risky_static_imports: ['fs'],
      methods: ['GET'],
    })
    const mixed = makeRoute({
      risk_level: 2,
      risky_static_imports: ['fs'],
      methods: ['GET', 'POST'],
    })
    expect(scoreRouteCandidate(getOnly)!.score).toBeGreaterThan(scoreRouteCandidate(mixed)!.score)
  })

  it('child_process import is deprioritized with avoid note', () => {
    const route = makeRoute({
      risk_level: 2,
      risky_static_imports: ['child_process'],
      methods: ['GET'],
    })
    const result = scoreRouteCandidate(route)!
    expect(result.score).toBeLessThan(scoreRouteCandidate(makeRoute({
      risk_level: 2,
      risky_static_imports: ['fs'],
      methods: ['GET'],
    }))!.score)
    expect(result.avoidNotes.some((n: string) => n.includes('child_process'))).toBe(true)
  })

  it('node:child_process is also deprioritized', () => {
    const route = makeRoute({
      risk_level: 2,
      risky_static_imports: ['node:child_process'],
      methods: ['GET'],
    })
    const result = scoreRouteCandidate(route)!
    expect(result.avoidNotes.some((n: string) => n.includes('node:child_process'))).toBe(true)
  })

  it('avoid path pattern reduces score', () => {
    const normal = makeRoute({
      file: 'src/app/api/memory/context/route.ts',
      risk_level: 2,
      risky_static_imports: ['fs'],
      methods: ['GET'],
    })
    const avoidable = makeRoute({
      file: 'src/app/api/backup/route.ts',
      risk_level: 2,
      risky_static_imports: ['fs'],
      methods: ['GET'],
    })
    expect(scoreRouteCandidate(normal)!.score).toBeGreaterThan(scoreRouteCandidate(avoidable)!.score)
    expect(scoreRouteCandidate(avoidable)!.avoidNotes.some((n: string) => n.includes('backup'))).toBe(true)
  })

  it('mixed route with 3 write methods accumulates penalties', () => {
    const heavy = makeRoute({
      risk_level: 2,
      risky_static_imports: ['fs'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    })
    const getOnly = makeRoute({
      risk_level: 2,
      risky_static_imports: ['fs'],
      methods: ['GET'],
    })
    expect(scoreRouteCandidate(getOnly)!.score).toBeGreaterThan(scoreRouteCandidate(heavy)!.score)
  })
})

// --- planPatches ---

describe('planPatches', () => {
  it('produces null top_recommendation when no risk_level 2 candidates', () => {
    const audit = makeAuditResult([
      makeRoute({ risk_level: 1, risky_static_imports: ['@/lib/super-admin'], methods: ['POST'] }),
    ])
    const result = planPatches(audit)
    expect(result.top_recommendation).toBeNull()
    expect(result.ranked_candidates).toHaveLength(0)
  })

  it('status is PASS and risk_level is 0 when no candidates', () => {
    const audit = makeAuditResult([])
    const result = planPatches(audit)
    expect(result.status).toBe('PASS')
    expect(result.risk_level).toBe(0)
  })

  it('status is WARN and risk_level is 1 when candidates exist', () => {
    const audit = makeAuditResult([
      makeRoute({ risk_level: 2, risky_static_imports: ['@/lib/super-admin'], methods: ['GET'] }),
    ])
    const result = planPatches(audit)
    expect(result.status).toBe('WARN')
    expect(result.risk_level).toBe(1)
  })

  it('emits OBSERVE ONLY label', () => {
    const audit = makeAuditResult([])
    expect(planPatches(audit).label).toBe('OBSERVE ONLY')
  })

  it('top recommendation is super-admin route when competing with child_process route', () => {
    const audit = makeAuditResult([
      makeRoute({
        file: 'src/app/api/super/example/route.ts',
        risk_level: 2,
        risky_static_imports: ['@/lib/super-admin'],
        methods: ['GET'],
      }),
      makeRoute({
        file: 'src/app/api/other/route.ts',
        risk_level: 2,
        risky_static_imports: ['child_process'],
        methods: ['GET'],
      }),
    ])
    const result = planPatches(audit)
    expect(result.top_recommendation?.route).toBe('src/app/api/super/example/route.ts')
  })

  it('output shape has all required fields', () => {
    const audit = makeAuditResult([
      makeRoute({ risk_level: 2, risky_static_imports: ['fs'], methods: ['GET'] }),
    ])
    const result = planPatches(audit)
    expect(result).toHaveProperty('agent')
    expect(result).toHaveProperty('label')
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('risk_level')
    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('top_recommendation')
    expect(result).toHaveProperty('ranked_candidates')
    expect(result).toHaveProperty('recommendations')
    expect(result.summary).toHaveProperty('audit_status')
    expect(result.summary).toHaveProperty('audit_risk_level')
    expect(result.summary).toHaveProperty('candidates_considered')
    expect(result.summary).toHaveProperty('recommended_candidates')
  })

  it('top_recommendation has all required fields when present', () => {
    const audit = makeAuditResult([
      makeRoute({ risk_level: 2, risky_static_imports: ['fs'], methods: ['GET'] }),
    ])
    const top = planPatches(audit).top_recommendation!
    expect(top).toHaveProperty('route')
    expect(top).toHaveProperty('reason')
    expect(top).toHaveProperty('proposed_helper')
    expect(top).toHaveProperty('expected_files_to_change')
    expect(top).toHaveProperty('constraints')
    expect(top).toHaveProperty('validation')
    expect(Array.isArray(top.expected_files_to_change)).toBe(true)
    expect(Array.isArray(top.constraints)).toBe(true)
    expect(Array.isArray(top.validation)).toBe(true)
  })

  it('ranked_candidates are sorted highest score first', () => {
    const audit = makeAuditResult([
      makeRoute({
        file: 'src/app/api/z-route/route.ts',
        risk_level: 2,
        risky_static_imports: ['child_process'],
        methods: ['GET'],
      }),
      makeRoute({
        file: 'src/app/api/a-route/route.ts',
        risk_level: 2,
        risky_static_imports: ['@/lib/super-admin'],
        methods: ['GET'],
      }),
    ])
    const result = planPatches(audit)
    expect(result.ranked_candidates[0].risky_static_imports).toContain('@/lib/super-admin')
  })
})

// --- proposedHelperName ---

describe('proposedHelperName', () => {
  it('derives helper name from two-segment path', () => {
    expect(proposedHelperName('src/app/api/memory/context/route.ts')).toBe('src/lib/memory-context-queries.ts')
  })

  it('derives helper name from single-segment path', () => {
    expect(proposedHelperName('src/app/api/agents/route.ts')).toBe('src/lib/agents-queries.ts')
  })

  it('strips dynamic segments', () => {
    expect(proposedHelperName('src/app/api/agents/[id]/route.ts')).toBe('src/lib/agents-queries.ts')
  })

  it('handles super namespace', () => {
    expect(proposedHelperName('src/app/api/super/tenants/route.ts')).toBe('src/lib/super-tenants-queries.ts')
  })
})
