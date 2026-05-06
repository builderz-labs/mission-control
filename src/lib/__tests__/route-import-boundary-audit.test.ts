import { describe, it, expect } from 'vitest'

const { analyzeRouteFile, detectStaticRiskyImports, detectExportedMethods } = require('../../../scripts/route-import-boundary-audit.cjs')

// --- detectExportedMethods ---

describe('detectExportedMethods', () => {
  it('detects async GET', () => {
    const content = `export async function GET(req: NextRequest) { return NextResponse.json({}) }`
    expect(detectExportedMethods(content)).toContain('GET')
  })

  it('detects sync GET', () => {
    const content = `export function GET(req: NextRequest) { return NextResponse.json({}) }`
    expect(detectExportedMethods(content)).toContain('GET')
  })

  it('detects POST', () => {
    const content = `export async function POST(req: NextRequest) {}`
    expect(detectExportedMethods(content)).toContain('POST')
  })

  it('detects multiple methods', () => {
    const content = `
export async function GET(req: NextRequest) {}
export async function POST(req: NextRequest) {}
export async function DELETE(req: NextRequest) {}
`
    const methods = detectExportedMethods(content)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })

  it('does not detect non-exported functions', () => {
    const content = `async function GET(req: NextRequest) {}`
    expect(detectExportedMethods(content)).not.toContain('GET')
  })
})

// --- detectStaticRiskyImports ---

describe('detectStaticRiskyImports', () => {
  it('detects static super-admin import', () => {
    const content = `import { createTenantAndBootstrapJob, listTenants } from '@/lib/super-admin'`
    expect(detectStaticRiskyImports(content)).toContain('@/lib/super-admin')
  })

  it('detects static fs import', () => {
    const content = `import fs from 'fs'`
    expect(detectStaticRiskyImports(content)).toContain('fs')
  })

  it('detects static child_process import', () => {
    const content = `import { execFileSync } from 'child_process'`
    expect(detectStaticRiskyImports(content)).toContain('child_process')
  })

  it('detects node: prefixed imports', () => {
    const content = `import fs from 'node:fs'`
    expect(detectStaticRiskyImports(content)).toContain('node:fs')
  })

  it('ignores dynamic import of super-admin', () => {
    const content = `
import { listTenants } from '@/lib/tenant-queries'
const { createTenantAndBootstrapJob } = await import('@/lib/super-admin')
`
    expect(detectStaticRiskyImports(content)).not.toContain('@/lib/super-admin')
  })

  it('ignores type-only import of super-admin', () => {
    const content = `import type { ProvisionJobAction } from '@/lib/super-admin'`
    expect(detectStaticRiskyImports(content)).not.toContain('@/lib/super-admin')
  })

  it('ignores type-only import with braces', () => {
    const content = `import type { Foo, Bar } from '@/lib/super-admin'`
    expect(detectStaticRiskyImports(content)).not.toContain('@/lib/super-admin')
  })

  it('returns empty array for clean route', () => {
    const content = `
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
export async function GET(req: NextRequest) { return NextResponse.json({}) }
`
    expect(detectStaticRiskyImports(content)).toHaveLength(0)
  })
})

// --- analyzeRouteFile ---

describe('analyzeRouteFile', () => {
  it('risk 0 for clean DB-only GET route', () => {
    const content = `
import { NextRequest, NextResponse } from 'next/server'
import { listTenants } from '@/lib/tenant-queries'
export async function GET(req: NextRequest) { return NextResponse.json({ tenants: listTenants() }) }
`
    const result = analyzeRouteFile(content, 'src/app/api/super/tenants/route.ts')
    expect(result.risk_level).toBe(0)
    expect(result.risky_static_imports).toHaveLength(0)
    expect(result.methods).toContain('GET')
  })

  it('risk 2 for GET route with static super-admin import', () => {
    const content = `
import { NextRequest, NextResponse } from 'next/server'
import { listTenants } from '@/lib/super-admin'
export async function GET(req: NextRequest) { return NextResponse.json({ tenants: listTenants() }) }
`
    const result = analyzeRouteFile(content, 'src/app/api/super/tenants/route.ts')
    expect(result.risk_level).toBe(2)
    expect(result.risky_static_imports).toContain('@/lib/super-admin')
    expect(result.methods).toContain('GET')
    expect(result.recommendation).toMatch(/GET route/)
  })

  it('risk 1 for POST-only route with static super-admin import', () => {
    const content = `
import { NextRequest, NextResponse } from 'next/server'
import { createTenantDecommissionJob } from '@/lib/super-admin'
export async function POST(req: NextRequest) {}
`
    const result = analyzeRouteFile(content, 'src/app/api/super/tenants/[id]/decommission/route.ts')
    expect(result.risk_level).toBe(1)
    expect(result.risky_static_imports).toContain('@/lib/super-admin')
    expect(result.methods).not.toContain('GET')
    expect(result.recommendation).toMatch(/Non-GET/)
  })

  it('risk 0 for GET with only dynamic super-admin import', () => {
    const content = `
import { NextRequest, NextResponse } from 'next/server'
import { listTenants } from '@/lib/tenant-queries'
export async function GET(req: NextRequest) { return NextResponse.json({ tenants: listTenants() }) }
export async function POST(req: NextRequest) {
  const { createTenantAndBootstrapJob } = await import('@/lib/super-admin')
  return NextResponse.json({})
}
`
    const result = analyzeRouteFile(content, 'src/app/api/super/tenants/route.ts')
    expect(result.risk_level).toBe(0)
    expect(result.risky_static_imports).toHaveLength(0)
  })

  it('populates file path and methods on result', () => {
    const content = `
import { NextRequest, NextResponse } from 'next/server'
export async function GET(req: NextRequest) {}
export async function POST(req: NextRequest) {}
`
    const result = analyzeRouteFile(content, 'src/app/api/example/route.ts')
    expect(result.file).toBe('src/app/api/example/route.ts')
    expect(result.methods).toEqual(expect.arrayContaining(['GET', 'POST']))
  })
})
