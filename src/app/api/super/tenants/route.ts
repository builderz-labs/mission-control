import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createTenantAndBootstrapJob, listTenants } from '@/lib/super-admin'

/**
 * GET /api/super/tenants - List tenants and latest provisioning status
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ tenants: listTenants() })
}

/**
 * POST /api/super/tenants - Create tenant and queue bootstrap job
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const created = createTenantAndBootstrapJob(body, auth.user.username)
    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return NextResponse.json({ error: 'Tenant slug or linux user already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error?.message || 'Failed to create tenant bootstrap job' }, { status: 400 })
  }
}
