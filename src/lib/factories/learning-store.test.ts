import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FactorySnapshot } from './types'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import { recordFactorySnapshotExperience } from './learning-store'

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE experience_events (
    id INTEGER PRIMARY KEY, workspace_id INTEGER, experience_id TEXT, project_id TEXT,
    factory_instance_id TEXT, stage_id TEXT, action_type TEXT, worker_kind TEXT, worker_identity TEXT,
    inputs TEXT, artifact_refs TEXT, checks TEXT, metrics TEXT, outcome TEXT, cost TEXT,
    evidence_refs TEXT, source_revision TEXT, observed_at INTEGER, created_at INTEGER,
    UNIQUE(workspace_id, experience_id)
  )`)
})
afterEach(() => db.close())

it('deduplicates passive snapshot evidence within a workspace and revision', () => {
  const snapshot = {
    snapshot_version: '1.0', instance_id: 'marketing:fixture', module_id: 'marketing-factory',
    observed_at: new Date().toISOString(),
    source: { authority: 'fixture', native_id: 'fixture', revision: 'revision-a', adapter_version: '1' },
    freshness: { state: 'fresh', last_success_at: new Date().toISOString(), last_error: null },
    lifecycle: { process_stage_id: null, native_stage: 'REVIEW', canonical_phase: 'design', status: 'blocked' },
    compatibility: { native_version: '1', contract_coverage: 'partial', warnings: [] },
    gates: [], checks: [], artifacts: [], review_queues: [], next_actions: [],
    blockers: [], risks: [], metrics: [], available_commands: [],
  } satisfies FactorySnapshot
  recordFactorySnapshotExperience(1, snapshot)
  recordFactorySnapshotExperience(1, snapshot)
  recordFactorySnapshotExperience(2, snapshot)
  const rows = db.prepare('SELECT workspace_id, COUNT(*) AS count FROM experience_events GROUP BY workspace_id').all()
  expect(rows).toEqual([{ workspace_id: 1, count: 1 }, { workspace_id: 2, count: 1 }])
})
