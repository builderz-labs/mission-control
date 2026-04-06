import { getErrorMessage, toError } from '@/lib/types/sql'
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

    const tenant = db.prepare('SELECT id, slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, gateway_port, dashboard_port, config, created_by, created_at, updated_at FROM tenants WHERE id = ?').get(tenantId) as { id: number; slug: string; display_name: string; linux_user: string | null; plan_tier: string; status: string } | undefined
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
      job: db.prepare('SELECT id, tenant_id, job_type, status, dry_run, requested_by, approved_by, runner_host, idempotency_key, request_json, plan_json, result_json, error_text, started_at, completed_at, created_at, updated_at FROM provision_jobs WHERE id = ?').get(id),
    }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to queue job' }, { status: 500 })
  }
}
