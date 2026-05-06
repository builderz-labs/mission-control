import { getDatabase, ProvisionJob } from './db'

function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function listProvisionJobs(filters: { tenant_id?: number; status?: string; limit?: number } = {}) {
  const db = getDatabase()
  const where: string[] = ['1=1']
  const params: any[] = []

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

  const rows = db.prepare(`
    SELECT pj.*, t.slug as tenant_slug, t.display_name as tenant_display_name
    FROM provision_jobs pj
    JOIN tenants t ON t.id = pj.tenant_id
    WHERE ${where.join(' AND ')}
    ORDER BY pj.created_at DESC, pj.id DESC
    LIMIT ?
  `).all(...params) as Array<ProvisionJob & { tenant_slug: string; tenant_display_name: string }>

  return rows.map((row) => ({
    ...row,
    request_json: parseJsonField(row.request_json, {}),
    plan_json: parseJsonField(row.plan_json, []),
    result_json: parseJsonField(row.result_json, null),
  }))
}

export function getProvisionJob(jobId: number) {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT pj.*, t.slug as tenant_slug, t.display_name as tenant_display_name, t.linux_user, t.openclaw_home, t.workspace_root
    FROM provision_jobs pj
    JOIN tenants t ON t.id = pj.tenant_id
    WHERE pj.id = ?
  `).get(jobId) as any

  if (!row) return null

  const events = db.prepare(`
    SELECT * FROM provision_events WHERE job_id = ? ORDER BY created_at ASC, id ASC
  `).all(jobId)

  return {
    ...row,
    request_json: parseJsonField(row.request_json, {}),
    plan_json: parseJsonField(row.plan_json, []),
    result_json: parseJsonField(row.result_json, null),
    events,
  }
}
