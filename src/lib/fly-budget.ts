import type Database from 'better-sqlite3'

export function flyBudgetPeriods(now = Date.now()) {
  const date = new Date(now)
  return { day: Math.floor(now / 86400000) * 86400,
    month: Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000) }
}

/** Conservative overlap accounting: a crossing-period job is counted in both periods. */
export function flyCommittedSpend(db: Database.Database, since: number): number {
  return (db.prepare(`SELECT COALESCE(SUM(CASE WHEN state IN ('creating','running','cleaning')
    THEN MAX(estimated_cost_usd,observed_cost_usd) ELSE observed_cost_usd END),0) AS n
    FROM fly_worker_jobs WHERE created_at>=? OR completed_at>=? OR state IN ('creating','running','cleaning')`)
    .get(since, since) as { n: number }).n
}

