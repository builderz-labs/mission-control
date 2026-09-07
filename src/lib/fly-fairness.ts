import type Database from 'better-sqlite3'

export type FlyQueuedRow = { id: string; payload: string; session_id: string | null }

const ACTIVE = "state IN ('creating','running','cleaning')"

function share(limit: number, contenders: number): number {
  return Math.max(1, Math.floor(limit / Math.max(1, contenders)))
}

function ratio(key: string, fallback: number): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback
}

function repositoryOf(row: { payload: string }): string {
  try { return String(JSON.parse(row.payload).repository || '') } catch { return '' }
}

function tally(rows: Array<{ key: string | null; n: number }>): Map<string, number> {
  return new Map(rows.filter(row => row.key).map(row => [row.key as string, row.n]))
}

/**
 * Work-conserving fair share. One project or agent session may use the whole pool
 * while nothing else is waiting, and yields to an equal share once others queue.
 * Capacity is never left idle: contended candidates are only deprioritised.
 */
export function flyFairOrder<T extends FlyQueuedRow>(db: Database.Database, queued: T[], limit: number): T[] {
  if (queued.length < 2) return queued
  const repositories = tally(db.prepare(`SELECT repository AS key, COUNT(*) AS n FROM fly_worker_jobs
    WHERE ${ACTIVE} GROUP BY repository`).all() as Array<{ key: string; n: number }>)
  const sessions = tally(db.prepare(`SELECT s.session_id AS key, COUNT(*) AS n FROM fly_worker_jobs j
    JOIN fly_submissions s ON s.id=j.submission_id WHERE j.${ACTIVE} GROUP BY s.session_id`)
    .all() as Array<{ key: string | null; n: number }>)
  const queuedRepositories = new Set(queued.map(repositoryOf).filter(Boolean))
  const queuedSessions = new Set(queued.map(row => row.session_id).filter(Boolean) as string[])
  const repositoryShare = share(limit, new Set([...repositories.keys(), ...queuedRepositories]).size)
  const sessionShare = share(limit, new Set([...sessions.keys(), ...queuedSessions]).size)
  const fair: T[] = []
  const deferred: T[] = []
  for (const row of queued) {
    const repository = repositoryOf(row)
    const session = row.session_id
    const overRepository = (repositories.get(repository) || 0) >= repositoryShare
    const overSession = Boolean(session) && (sessions.get(session as string) || 0) >= sessionShare
    if (overRepository || overSession) { deferred.push(row); continue }
    repositories.set(repository, (repositories.get(repository) || 0) + 1)
    if (session) sessions.set(session, (sessions.get(session) || 0) + 1)
    fair.push(row)
  }
  return [...fair, ...deferred]
}

/** True when a project other than this one is waiting for the shared pool. */
export function flyQueueIsContended(db: Database.Database, repository: string): boolean {
  const row = db.prepare(`SELECT 1 AS n FROM fly_submissions WHERE state='queued'
    AND json_extract(payload,'$.repository')<>? LIMIT 1`).get(repository) as { n: number } | undefined
  return Boolean(row)
}

/**
 * Daily spend already committed to one repository. Used only while other projects
 * are queued, so an uncontended project still reaches the full daily budget.
 */
export function flyRepositorySpendToday(db: Database.Database, repository: string, since: number): number {
  return (db.prepare(`SELECT COALESCE(SUM(CASE WHEN ${ACTIVE}
    THEN MAX(estimated_cost_usd,observed_cost_usd) ELSE observed_cost_usd END),0) AS n
    FROM fly_worker_jobs WHERE repository=? AND (created_at>=? OR completed_at>=? OR ${ACTIVE})`)
    .get(repository, since, since) as { n: number }).n
}

export function flyRepositoryDailyCap(dailyBudget: number): number {
  return dailyBudget * ratio('MC_FLY_REPO_DAILY_SHARE', 0.6)
}
