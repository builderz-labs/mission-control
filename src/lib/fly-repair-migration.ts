import type { Migration } from './migrations'

// 061 has already shipped locally. Preserve it and migrate existing data forward.
export const flyRepairMigration: Migration = {
  id: '062_fly_queue_deadline_and_resource_peaks',
  up(db) {
    db.exec(`
      ALTER TABLE fly_submissions ADD COLUMN queue_expires_at INTEGER NOT NULL DEFAULT 0;
      UPDATE fly_submissions SET queue_expires_at=created_at+86400;
      CREATE TRIGGER fly_submission_deadline AFTER INSERT ON fly_submissions
        WHEN NEW.queue_expires_at=0 BEGIN
        UPDATE fly_submissions SET queue_expires_at=NEW.created_at+86400 WHERE id=NEW.id;
      END;
      ALTER TABLE fly_worker_jobs ADD COLUMN peak_cpu_percent REAL NOT NULL DEFAULT 0;
      ALTER TABLE fly_worker_jobs ADD COLUMN peak_memory_bytes INTEGER NOT NULL DEFAULT 0;
      UPDATE fly_worker_jobs SET peak_cpu_percent=COALESCE(cpu_percent,0),peak_memory_bytes=COALESCE(memory_bytes,0);
    `)
  },
}
