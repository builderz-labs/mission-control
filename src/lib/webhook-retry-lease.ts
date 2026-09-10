export const WEBHOOK_RETRY_LEASE_SECONDS = 120
export const WEBHOOK_RETRY_BATCH_LIMIT = 50

export interface DueWebhookRetry {
  id: number
  webhook_id: number
  event_type: string
  payload: string
  attempt: number
  w_id: number
  w_name: string
  w_url: string
  w_secret: string | null
  w_events: string
  w_enabled: number
  w_consecutive_failures: number
  wd_workspace_id: number
  leaseUntil: number
}

interface SqliteDb {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { changes: number }
  }
  transaction: <T>(fn: () => T) => { immediate: () => T }
}

const SELECT_DUE = `
  SELECT wd.id, wd.webhook_id, wd.event_type, wd.payload, wd.attempt,
         w.id as w_id, w.name as w_name, w.url as w_url, w.secret as w_secret,
         w.events as w_events, w.enabled as w_enabled, w.consecutive_failures as w_consecutive_failures,
         wd.workspace_id as wd_workspace_id
  FROM webhook_deliveries wd
  JOIN webhooks w ON w.id = wd.webhook_id AND w.workspace_id = wd.workspace_id AND w.enabled = 1
  WHERE wd.next_retry_at IS NOT NULL AND wd.next_retry_at <= ?
  ORDER BY wd.next_retry_at ASC, wd.id ASC
  LIMIT 1
`

export function claimDueWebhookRetry(db: SqliteDb, now: number): DueWebhookRetry | null {
  const leaseUntil = now + WEBHOOK_RETRY_LEASE_SECONDS
  return db.transaction(() => {
    const row = db.prepare(SELECT_DUE).get(now) as Omit<DueWebhookRetry, 'leaseUntil'> | undefined
    if (!row) return null
    const result = db.prepare(`
      UPDATE webhook_deliveries SET next_retry_at = ?
      WHERE id = ? AND workspace_id = ? AND next_retry_at IS NOT NULL AND next_retry_at <= ?
    `).run(leaseUntil, row.id, row.wd_workspace_id, now)
    if (!result.changes) return null
    return { ...row, leaseUntil }
  }).immediate()
}

export function releaseWebhookRetryClaim(
  db: SqliteDb,
  claimed: Pick<DueWebhookRetry, 'id' | 'wd_workspace_id' | 'leaseUntil'>,
): void {
  db.prepare(
    `UPDATE webhook_deliveries SET next_retry_at = NULL WHERE id = ? AND workspace_id = ? AND next_retry_at = ?`,
  ).run(claimed.id, claimed.wd_workspace_id, claimed.leaseUntil)
}
