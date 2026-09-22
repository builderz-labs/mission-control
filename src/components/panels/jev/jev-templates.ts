import type { JevPolicyInput } from './jev-ui-types'

export interface JevPolicyTemplate {
  id: string
  title: string
  summary: string
  recommended?: boolean
  policy: JevPolicyInput
}

export const JEV_POLICY_TEMPLATES: JevPolicyTemplate[] = [
  {
    id: 'release-readiness', title: 'Release readiness', recommended: true,
    summary: 'Decide whether a change is ready, understand risk, and identify blockers.',
    policy: {
      name: 'Release readiness', description: 'A reusable, observation-only release review.',
      model: 'jev-latest', mode: 'shadow', enabled: true,
      questions: {
        decision: {
          type: 'choice', instructions: 'What is the appropriate release decision?',
          criteria: {
            ready: 'Evidence supports shipping now.',
            needs_changes: 'Specific changes are required before shipping.',
            blocked: 'Missing evidence or an external dependency prevents a decision.',
          },
        },
        risk: {
          type: 'score', instructions: 'Score the overall release risk.',
          criteria: ['Low risk with strong evidence', 'Moderate risk or incomplete evidence', 'High or unacceptable risk'],
        },
        safe_to_merge: {
          type: 'noul', instructions: 'Is this change safe to merge?',
          criteria: { true: 'Tests, review, and operational evidence support merging.', false: 'A material gap remains.' },
        },
      },
    },
  },
  {
    id: 'security-review', title: 'Security review',
    summary: 'Triage security impact and surface changes that need deeper review.',
    policy: {
      name: 'Security review', description: 'A first-pass security classification; not a substitute for testing.',
      model: 'jev-latest', mode: 'shadow', enabled: true,
      questions: {
        severity: {
          type: 'choice', instructions: 'Classify the security impact.',
          criteria: { low: 'No sensitive boundary changes.', medium: 'A security boundary changes but controls are evident.', high: 'Sensitive access or data could be exposed.' },
        },
        needs_specialist: { type: 'noul', instructions: 'Does this need specialist security review?' },
        evidence_quality: {
          type: 'score', instructions: 'Rate the quality of the supplied security evidence.',
          criteria: ['Insufficient evidence', 'Some supporting evidence', 'Complete and test-backed evidence'],
        },
      },
    },
  },
  {
    id: 'requirements-fit', title: 'Requirements fit',
    summary: 'Check whether implementation evidence matches the intended outcome.',
    policy: {
      name: 'Requirements fit', description: 'Compares supplied implementation context with a stated goal.',
      model: 'jev-latest', mode: 'shadow', enabled: true,
      questions: {
        outcome: {
          type: 'choice', instructions: 'How well does the evidence satisfy the intended outcome?',
          criteria: { complete: 'The outcome is fully supported.', partial: 'Some requirements remain.', missing: 'The core outcome is not demonstrated.' },
        },
        meets_goal: { type: 'noul', instructions: 'Does the implementation meet the stated goal?' },
        completeness: {
          type: 'score', instructions: 'Rate implementation completeness.',
          criteria: ['Substantial gaps', 'Mostly complete', 'Complete with strong evidence'],
        },
      },
    },
  },
]
