// Read-only queries for tenants and provision jobs.
// No writes, no side effects — safe to call from any context.

import { getDatabase, Tenant, ProvisionJob } from '../db'
import { SqlParam } from '../types/sql'
import { parseJsonField } from './provision-utils'

export type TenantWithLatestJob = Omit<Tenant, 'config'> & {
  config: Record<string, unknown>
  latest_job_id: number | null
  latest_job_status: string | null
  latest_job_created_at: number | null
}

export function listTenants(): TenantWithLatestJob[] {
  const db = getDatabase()

  type RawRow = Tenant & {
    latest_job_id: number | null
    latest_job_status: string | null
    latest_job_created_at: number | null
  }

  const rows = db
    .prepare(`
      SELECT t.*, pj.id as latest_job_id, pj.status as latest_job_status, pj.created_at as latest_job_created_at
      FROM tenants t
      LEFT JOIN provision_jobs pj ON pj.id = (
        SELECT p2.id FROM provision_jobs p2 WHERE p2.tenant_id = t.id ORDER BY p2.created_at DESC, p2.id DESC LIMIT 1
      )
      ORDER BY t.created_at DESC, t.id DESC
    `)
    .all() as RawRow[]

  return rows.map((row) => ({
    ...row,
    config: parseJsonField(row.config as string | null | undefined, {}),
  }))
}

export type ProvisionJobRow = Omit<ProvisionJob, 'request_json' | 'plan_json' | 'result_json'> & {
  request_json: Record<string, unknown>
  plan_json: unknown[]
  result_json: unknown
  tenant_slug: string
  tenant_display_name: string
}

export function listProvisionJobs(
  filters: { tenant_id?: number; status?: string; limit?: number } = {},
): ProvisionJobRow[] {
  const db = getDatabase()
  const where: string[] = ['1=1']
  const params: SqlParam[] = []

  if (filters.tenant_id) {
    where.push('pj.tenant_id = ?')
    params.push(filters.tenant_id)
  }
  if (filters.status) {
    where.push('pj.status = ?')
    params.push(filters.status)
  }

  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500)
  params.push(limit)

  const rows = db
    .prepare(`
      SELECT pj.*, t.slug as tenant_slug, t.display_name as tenant_display_name
      FROM provision_jobs pj
      JOIN tenants t ON t.id = pj.tenant_id
      WHERE ${where.join(' AND ')}
      ORDER BY pj.created_at DESC, pj.id DESC
      LIMIT ?
    `)
    .all(...params) as Array<ProvisionJob & { tenant_slug: string; tenant_display_name: string }>

  return rows.map((row) => ({
    ...row,
    request_json: parseJsonField(row.request_json as string | null | undefined, {}),
    plan_json: parseJsonField(row.plan_json as string | null | undefined, []),
    result_json: parseJsonField(row.result_json as string | null | undefined, null),
  }))
}

export function getProvisionJob(jobId: number): Record<string, unknown> | null {
  const db = getDatabase()
  const row = db
    .prepare(`
      SELECT pj.*, t.slug as tenant_slug, t.display_name as tenant_display_name, t.linux_user, t.openclaw_home, t.workspace_root
      FROM provision_jobs pj
      JOIN tenants t ON t.id = pj.tenant_id
      WHERE pj.id = ?
    `)
    .get(jobId) as Record<string, unknown> | undefined

  if (!row) return null

  const events = db
    .prepare(`
      SELECT id, job_id, level, step_key, message, data, created_at FROM provision_events WHERE job_id = ? ORDER BY created_at ASC, id ASC
    `)
    .all(jobId)

  return {
    ...row,
    request_json: parseJsonField(row.request_json as string | null, {}),
    plan_json: parseJsonField(row.plan_json as string | null, []),
    result_json: parseJsonField(row.result_json as string | null, null),
    events,
  }
}
