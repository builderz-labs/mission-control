import type Database from 'better-sqlite3'

export type FlyActivityJob = {
  id: string; task_id: number; title: string; state: string; session_id: string | null;
  swarm_id: string | null; machine_id: string | null; image_kind: string;
  runtime_seconds: number; observed_cost_usd: number; estimated_cost_usd: number;
  cpu_percent: number | null; memory_bytes: number | null; heartbeat_at: number | null;
}
export type FlyActivity = {
  submissions: number; active_workers: number; queued: number; estimated_compute_usd: number;
  oldest_queue_seconds: number; states: Record<string, number>; jobs: FlyActivityJob[];
}

/** Bound response size without truncating session totals or leaking another workspace. */
export function buildFlyActivity(db: Database.Database, workspace: number, session: string | null = null): FlyActivity {
  const scope = [workspace,session,session]
  const counts = db.prepare(`SELECT state,COUNT(*) AS n,MIN(created_at) AS oldest FROM fly_submissions
    WHERE workspace_id=? AND (? IS NULL OR session_id=?) GROUP BY state`).all(...scope) as Array<{state:string;n:number;oldest:number}>
  const totals = db.prepare(`SELECT COALESCE(SUM(j.observed_cost_usd),0) AS cost,
    COALESCE(SUM(j.state IN ('creating','running','cleaning')),0) AS active
    FROM fly_worker_jobs j JOIN fly_submissions s ON s.id=j.submission_id AND s.workspace_id=j.workspace_id
    WHERE s.workspace_id=? AND (? IS NULL OR s.session_id=?)`).get(...scope) as { cost: number; active: number }
  const jobs = db.prepare(`SELECT j.id,j.task_id,t.title,j.state,s.session_id,s.swarm_id,j.machine_id,j.image_kind,
    j.runtime_seconds,j.observed_cost_usd,j.estimated_cost_usd,j.cpu_percent,j.memory_bytes,j.heartbeat_at
    FROM fly_worker_jobs j JOIN fly_submissions s ON s.id=j.submission_id AND s.workspace_id=j.workspace_id
    JOIN tasks t ON t.id=j.task_id AND t.workspace_id=j.workspace_id
    WHERE s.workspace_id=? AND (? IS NULL OR s.session_id=?)
    ORDER BY j.created_at DESC,j.id DESC LIMIT 100`).all(...scope) as FlyActivityJob[]
  const queued = counts.find(row => row.state === 'queued')
  return { submissions: counts.reduce((sum,row) => sum+row.n,0), active_workers: totals.active,
    queued: queued?.n || 0, estimated_compute_usd: totals.cost,
    oldest_queue_seconds: queued ? Math.max(0,Math.floor(Date.now()/1000)-queued.oldest) : 0,
    states: Object.fromEntries(counts.map(row => [row.state,row.n])), jobs }
}
