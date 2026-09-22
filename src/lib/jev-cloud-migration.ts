import { randomUUID } from 'node:crypto'
import type { Migration } from './migrations'

const entities = [
  'policies', 'evaluations', 'setup_sessions', 'setup_messages', 'setup_revisions',
  'setup_revision_policies',
] as const

export const jevCloudMigration: Migration = {
  id: '069_jev_cloud_outbox',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jev_cloud_origin (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        instance_id TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS jev_cloud_outbox (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
        workspace_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
        payload TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        synced_at INTEGER,
        next_attempt_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_jev_cloud_pending
        ON jev_cloud_outbox(synced_at,next_attempt_at,sequence);
      CREATE INDEX IF NOT EXISTS idx_jev_cloud_workspace
        ON jev_cloud_outbox(workspace_id,synced_at);
    `)
    db.prepare('INSERT OR IGNORE INTO jev_cloud_origin(singleton,instance_id) VALUES(1,?)').run(randomUUID())
    // Static, allowlisted identifiers only. Triggers enqueue identities atomically;
    // free-text content is redacted and frozen by the synchronizer before delivery.
    for (const entity of entities) {
      for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
        const row = operation === 'DELETE' ? 'OLD' : 'NEW'
        const action = operation === 'DELETE' ? 'delete' : 'upsert'
        db.exec(`CREATE TRIGGER IF NOT EXISTS jev_cloud_${entity}_${operation.toLowerCase()}
          AFTER ${operation} ON jev_${entity} BEGIN
            INSERT INTO jev_cloud_outbox(workspace_id,entity_type,entity_id,operation)
            VALUES(${row}.workspace_id,'${entity}',CAST(${row}.id AS TEXT),'${action}');
          END;`)
      }
      db.exec(`INSERT INTO jev_cloud_outbox(workspace_id,entity_type,entity_id,operation)
        SELECT workspace_id,'${entity}',CAST(id AS TEXT),'upsert' FROM jev_${entity} AS entity
        WHERE NOT EXISTS (SELECT 1 FROM jev_cloud_outbox AS event
          WHERE event.entity_type='${entity}' AND event.entity_id=CAST(entity.id AS TEXT));`)
    }
  },
}
