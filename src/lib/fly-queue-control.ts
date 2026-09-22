import type Database from 'better-sqlite3'

/** Only unlaunched, unowned queued work may be released to a local coordinator. */
export function releaseQueuedFlySubmission(db: Database.Database, workspace: number, id: string, state: 'cancelled' | 'expired') {
  return db.transaction(() => {
    const row = db.prepare(`SELECT task_id,state FROM fly_submissions s WHERE id=? AND workspace_id=? AND state IN ('queued','cancelled','expired')
      AND NOT EXISTS (SELECT 1 FROM fly_worker_jobs j WHERE j.submission_id=s.id AND j.state IN ('creating','running','cleaning'))`)
      .get(id,workspace) as { task_id: number; state: string } | undefined
    if (!row) return { released: false, safe_local_fallback: false }
    if (row.state !== 'queued') return { released: true, safe_local_fallback: true }
    const reason = state === 'expired' ? 'Queue deadline reached before launch' : 'Queued submission cancelled by operator'
    db.prepare('UPDATE fly_submissions SET state=?,reason=?,updated_at=unixepoch() WHERE id=?').run(state,reason,id)
    db.prepare("UPDATE tasks SET status='failed',error_message=?,updated_at=unixepoch() WHERE id=? AND workspace_id=?").run(reason,row.task_id,workspace)
    return { released: true, safe_local_fallback: true }
  }).immediate()
}

export function expireFlyQueue(db: Database.Database) {
  const rows = db.prepare("SELECT id,workspace_id FROM fly_submissions WHERE state='queued' AND queue_expires_at<=unixepoch()")
    .all() as Array<{ id: string; workspace_id: number }>
  for (const row of rows) releaseQueuedFlySubmission(db,row.workspace_id,row.id,'expired')
}
