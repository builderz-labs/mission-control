import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import { deterministicLearningAggregates, recordExperience } from './learning-store'

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE experience_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      experience_id TEXT NOT NULL,
      project_id TEXT,
      factory_instance_id TEXT,
      stage_id TEXT,
      action_type TEXT NOT NULL,
      worker_kind TEXT,
      worker_identity TEXT,
      inputs TEXT NOT NULL DEFAULT '[]',
      artifact_refs TEXT NOT NULL DEFAULT '[]',
      checks TEXT NOT NULL DEFAULT '[]',
      metrics TEXT NOT NULL DEFAULT '[]',
      outcome TEXT,
      cost TEXT NOT NULL DEFAULT '{}',
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      source_revision TEXT,
      observed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(workspace_id, experience_id)
    )
  `)
})

afterEach(() => db.close())

describe('deterministic learning aggregation', () => {
  it('deduplicates a source revision and isolates workspaces', () => {
    recordExperience({ workspaceId: 1, experienceId: 'snapshot:one:r1', factoryInstanceId: 'one', actionType: 'factory_snapshot', outcome: 'mixed', observedAt: 1001 })
    recordExperience({ workspaceId: 1, experienceId: 'snapshot:one:r1', factoryInstanceId: 'one', actionType: 'factory_snapshot', outcome: 'mixed', observedAt: 1002 })
    recordExperience({ workspaceId: 2, experienceId: 'snapshot:one:r1', factoryInstanceId: 'one', actionType: 'factory_snapshot', outcome: 'success', observedAt: 1003 })
    expect(deterministicLearningAggregates(1).factory_rollups[0]).toMatchObject({ events: 1, mixed: 1, success: 0, reflection_eligible: false, evidence_needed: 4 })
    expect(deterministicLearningAggregates(2).factory_rollups[0]).toMatchObject({ events: 1, success: 1 })
  })
  it('marks reflection eligibility only after the evidence threshold and counts recurring failed checks', () => {
    for (let i = 1; i <= 5; i += 1) {
      recordExperience({
        workspaceId: 1,
        experienceId: 'e' + i,
        factoryInstanceId: 'marketing:shufuro',
        actionType: 'factory_snapshot',
        outcome: i === 1 ? 'mixed' : 'success',
        checks: [{ id: 'hook_density', ok: i > 2 }],
        observedAt: 1000 + i,
      })
    }

    const analysis = deterministicLearningAggregates(1)
    expect(analysis.factory_rollups).toHaveLength(1)
    expect(analysis.factory_rollups[0]).toMatchObject({
      factory_instance_id: 'marketing:shufuro',
      events: 5,
      success: 4,
      mixed: 1,
      reflection_eligible: true,
      evidence_needed: 0,
    })
    expect(analysis.recurring_check_failures[0]).toMatchObject({
      check_id: 'hook_density',
      count: 2,
      recurring: true,
    })
  })
})
