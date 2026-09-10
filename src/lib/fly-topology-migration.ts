import type { Migration } from './migrations'

// The worker app is a trust boundary, not a project boundary. Recording it per job
// lets one controller finish work on a retiring app while new work launches elsewhere.
export const flyTopologyMigration: Migration = {
  id: '063_fly_worker_app_and_fair_share',
  up(db) {
    db.exec(`
      ALTER TABLE fly_worker_jobs ADD COLUMN worker_app TEXT;
      CREATE INDEX idx_fly_jobs_active_app ON fly_worker_jobs(state, worker_app);
      CREATE INDEX idx_fly_jobs_repository_day ON fly_worker_jobs(repository, created_at);
    `)
    db.prepare("UPDATE fly_worker_jobs SET worker_app=? WHERE worker_app IS NULL")
      .run(process.env.MC_FLY_WORKER_APP || 'unknown')
  },
}
