import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { listProvisionJobs } from '@/lib/super-admin'

/**
 * GET /api/super/provision-jobs - List provisioning jobs
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const tenant_id = searchParams.get('tenant_id')
  const status = searchParams.get('status') || undefined
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)

  const jobs = listProvisionJobs({
    tenant_id: tenant_id ? parseInt(tenant_id, 10) : undefined,
    status,
    limit,
  })

  return NextResponse.json({ jobs })
}

/**
 * POST /api/super/provision-jobs - Queue an additional bootstrap/update job for an existing tenant
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const tenantId = Number(body.tenant_id)
    const dryRun = body.dry_run !== false
    const jobType = String(body.job_type || 'bootstrap')

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
    }

    if (!['bootstrap', 'update', 'decommission'].includes(jobType)) {
      return NextResponse.json({ error: 'Invalid job_type' }, { status: 400 })
    }

    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as any
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const plan = body.plan_json && Array.isArray(body.plan_json) ? body.plan_json : []
    const result = db.prepare(`
      INSERT INTO provision_jobs (tenant_id, job_type, status, dry_run, requested_by, request_json, plan_json, updated_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, (unixepoch()))
    `).run(
      tenantId,
      jobType,
      dryRun ? 1 : 0,
      auth.user.username,
      JSON.stringify(body.request_json || {}),
      JSON.stringify(plan),
    )

    const id = Number(result.lastInsertRowid)
    return NextResponse.json({
      job: db.prepare('SELECT * FROM provision_jobs WHERE id = ?').get(id),
    }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to queue job' }, { status: 500 })
  }
}
