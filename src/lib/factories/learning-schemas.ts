import { z } from 'zod'
import { IMPROVEMENT_CANDIDATE_STATUSES } from './learning-store'

export const candidateEvalPlanSchema = z.object({
  metric: z.string().trim().min(1).max(200),
  baseline: z.number().finite(),
  direction: z.enum(['increase', 'decrease']),
  minimum_effect: z.number().finite().nonnegative(),
  method: z.string().trim().min(1).max(500),
})

export const improvementCandidateProposalSchema = z.object({
  scope: z.enum(['skill', 'prompt', 'routing', 'check', 'workflow', 'policy', 'business_rule', 'security', 'release', 'permission']),
  target: z.string().trim().min(1).max(500),
  hypothesis: z.string().trim().min(1).max(4000),
  eval_plan: candidateEvalPlanSchema,
  rollback_target: z.string().trim().min(1).max(1000).optional(),
})

export const improvementCandidateEvaluationSchema = z.object({
  after: z.number().finite(),
  source_ref: z.string().trim().min(1).max(1000),
})

export const improvementCandidateTransitionSchema = z.object({
  expected_status: z.enum(IMPROVEMENT_CANDIDATE_STATUSES),
  to_status: z.enum(IMPROVEMENT_CANDIDATE_STATUSES),
  reason: z.string().max(4000).optional().default(''),
  evidence_refs: z.array(z.string().min(1).max(500)).max(100).optional().default([]),
  change_ref: z.string().min(1).max(1000).nullable().optional(),
  rollback_target: z.string().min(1).max(1000).nullable().optional(),
})
