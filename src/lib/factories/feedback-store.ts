import { randomUUID } from 'node:crypto'
import { getDatabase } from '@/lib/db'

export interface CrossFactoryFeedbackProposal {
  workspace_id: number
  feedback_id: string
  from_factory: string
  from_stage: string
  to_factory: string
  to_input: string
  signal: string
  evidence_refs: string
  confidence_label: 'low' | 'medium' | 'high'
  requires_acceptance: number
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'HELD'
  created_at: number
  updated_at: number
}

export function createCrossFactoryFeedbackProposal(input: {
  workspaceId: number
  fromFactory: string
  fromStage: string
  toFactory: string
  toInput: string
  signal: string
  evidenceRefs: string[]
  confidenceLabel: 'low' | 'medium' | 'high'
  requiresAcceptance?: boolean
}): CrossFactoryFeedbackProposal {
  const fields = [input.fromFactory, input.fromStage, input.toFactory, input.toInput, input.signal]
  if (fields.some((field) => !field.trim()) || input.evidenceRefs.length === 0
    || input.evidenceRefs.some((ref) => !ref.trim())) {
    throw new Error('Cross-Factory feedback requires endpoints, signal, and evidence references.')
  }
  const feedbackId = randomUUID()
  const db = getDatabase()
  db.prepare(`
    INSERT INTO cross_factory_feedback_proposals (
      workspace_id, feedback_id, from_factory, from_stage, to_factory, to_input,
      signal, evidence_refs, confidence_label, requires_acceptance, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED')
  `).run(
    input.workspaceId, feedbackId, input.fromFactory.trim(), input.fromStage.trim(),
    input.toFactory.trim(), input.toInput.trim(), input.signal.trim(),
    JSON.stringify(Array.from(new Set(input.evidenceRefs.map((ref) => ref.trim())))),
    input.confidenceLabel, input.requiresAcceptance === false ? 0 : 1,
  )
  return db.prepare(`
    SELECT * FROM cross_factory_feedback_proposals WHERE workspace_id = ? AND feedback_id = ?
  `).get(input.workspaceId, feedbackId) as CrossFactoryFeedbackProposal
}

export function listCrossFactoryFeedbackProposals(workspaceId: number): CrossFactoryFeedbackProposal[] {
  return getDatabase().prepare(`
    SELECT * FROM cross_factory_feedback_proposals
    WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 100
  `).all(workspaceId) as CrossFactoryFeedbackProposal[]
}
