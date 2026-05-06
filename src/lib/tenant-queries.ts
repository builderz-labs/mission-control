import { getDatabase, Tenant } from './db'

function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function listTenants() {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT t.*, pj.id as latest_job_id, pj.status as latest_job_status, pj.created_at as latest_job_created_at
    FROM tenants t
    LEFT JOIN provision_jobs pj ON pj.id = (
      SELECT p2.id FROM provision_jobs p2 WHERE p2.tenant_id = t.id ORDER BY p2.created_at DESC, p2.id DESC LIMIT 1
    )
    ORDER BY t.created_at DESC, t.id DESC
  `).all() as Array<Tenant & { latest_job_id: number | null; latest_job_status: string | null; latest_job_created_at: number | null }>

  return rows.map((row) => ({
    ...row,
    config: parseJsonField(row.config, {}),
  }))
}
