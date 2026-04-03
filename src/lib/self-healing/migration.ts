/**
 * Database migration for self-healing tables.
 * Registers with the existing migration system.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrations'

export const selfHealingMigration: Migration = {
  id: '042_self_healing',
  up: (db: Database.Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_name TEXT NOT NULL,
        status TEXT CHECK(status IN ('healthy', 'degraded', 'down')) DEFAULT 'healthy',
        response_time_ms INTEGER,
        error_message TEXT,
        metadata TEXT,
        workspace_id INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_health_checks_service
        ON health_checks(service_name, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_health_checks_status
        ON health_checks(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS circuit_breakers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_name TEXT NOT NULL UNIQUE,
        state TEXT CHECK(state IN ('closed', 'open', 'half_open')) DEFAULT 'closed',
        failure_count INTEGER DEFAULT 0,
        last_failure_at INTEGER,
        last_success_at INTEGER,
        trip_count INTEGER DEFAULT 0,
        cooldown_until INTEGER,
        workspace_id INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_circuit_breakers_state
        ON circuit_breakers(state);

      CREATE TABLE IF NOT EXISTS recovery_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_name TEXT NOT NULL,
        error_type TEXT CHECK(error_type IN ('transient', 'permanent')),
        error_class TEXT CHECK(error_class IN ('user_facing', 'internal')),
        diagnosis TEXT,
        action_taken TEXT,
        result TEXT CHECK(result IN ('recovered', 'failed', 'escalated')),
        attempt_number INTEGER DEFAULT 1,
        workspace_id INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_recovery_logs_service
        ON recovery_logs(service_name, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_recovery_logs_result
        ON recovery_logs(result, created_at DESC);
    `)
  },
}
