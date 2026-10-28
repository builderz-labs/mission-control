import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import { createCrossFactoryFeedbackProposal, listCrossFactoryFeedbackProposals } from './feedback-store'

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE cross_factory_feedback_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL,
    feedback_id TEXT NOT NULL, from_factory TEXT NOT NULL, from_stage TEXT NOT NULL,
    to_factory TEXT NOT NULL, to_input TEXT NOT NULL, signal TEXT NOT NULL,
    evidence_refs TEXT NOT NULL, confidence_label TEXT NOT NULL,
    requires_acceptance INTEGER NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(workspace_id, feedback_id)
  )`)
})
afterEach(() => db.close())

describe('Cross-Factory feedback proposals', () => {
  it('stores a typed proposal scoped to one workspace without applying it', () => {
    const input = {
      workspaceId: 1, fromFactory: 'marketing:shufuro', fromStage: 'message-review',
      toFactory: 'product:shufuro', toInput: 'positioning-feedback',
      signal: 'Repeated audience confusion', evidenceRefs: ['evidence:1', 'evidence:2'],
      confidenceLabel: 'low' as const,
    }
    expect(() => createCrossFactoryFeedbackProposal({ ...input, evidenceRefs: [] })).toThrow(/evidence/i)
    const proposal = createCrossFactoryFeedbackProposal(input)
    expect(proposal).toMatchObject({ status: 'PROPOSED', requires_acceptance: 1 })
    expect(JSON.parse(proposal.evidence_refs)).toEqual(['evidence:1', 'evidence:2'])
    expect(listCrossFactoryFeedbackProposals(1)).toHaveLength(1)
    expect(listCrossFactoryFeedbackProposals(2)).toHaveLength(0)
  })
})
