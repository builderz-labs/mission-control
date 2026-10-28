import { z } from 'zod'

const descriptiveField = z.string().trim().min(1).max(1000)

/** Descriptive content metadata only; measured outcomes belong in social-metrics. */
export const contentIntelligenceSchema = z.object({
  topic: descriptiveField.optional(),
  audience: descriptiveField.optional(),
  pain_desire: descriptiveField.optional(),
  hook: descriptiveField.optional(),
  value: descriptiveField.optional(),
  structure: descriptiveField.optional(),
  format: descriptiveField.optional(),
  editing: descriptiveField.optional(),
  cta: descriptiveField.optional(),
  proof: descriptiveField.optional(),
  novelty: descriptiveField.optional(),
  retention_trigger: descriptiveField.optional(),
  share_trigger: descriptiveField.optional(),
  conversion_goal: descriptiveField.optional(),
}).strict()

export type ContentIntelligence = z.infer<typeof contentIntelligenceSchema>

export const distributionExecutionModeSchema = z.enum(['manual', 'mock', 'noop'])
export const distributionVerificationEvidenceSchema = z.object({
  provider: z.enum(['manual', 'mock']),
  channel: z.string().trim().min(1).max(80),
  post_id: z.string().trim().min(1).max(300).optional(),
  post_url: z.string().url().refine((value) => value.startsWith('https://'), 'Canonical post URL must use HTTPS.').optional(),
  published_at: z.string().datetime({ offset: true }),
  verification_state: z.literal('verified'),
  evidence_ref: z.string().trim().min(1).max(500),
}).strict().refine((evidence) => Boolean(evidence.post_id || evidence.post_url), {
  message: 'Verified publication requires an external post_id or canonical post_url.',
})

export type DistributionVerificationEvidence = z.infer<typeof distributionVerificationEvidenceSchema>

export const preparePublishRequestSchema = z.object({
  content_id: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  execution_mode: distributionExecutionModeSchema,
  provider_identity: z.string().trim().min(1),
  human_approval_required: z.literal(true),
  expected_source_revision: z.string().trim().min(1),
  evidence: distributionVerificationEvidenceSchema.optional(),
}).strict()

export type PreparePublishRequest = z.infer<typeof preparePublishRequestSchema>

export const distributionPublishResultSchema = z.object({
  state: z.enum(['APPLIED', 'FAILED', 'STALE', 'UNVERIFIED']),
  content_id: z.string(),
  channel: z.string(),
  provider_identity: z.string(),
  external_post_id: z.string().nullable(),
  external_post_url: z.string().url().nullable(),
  published_at: z.string().datetime({ offset: true }).nullable(),
  verification_state: z.enum(['verified', 'unverified', 'missing', 'stale']),
  failure_reason: z.string().nullable(),
  cost: z.object({ paid_usd: z.number().finite().nonnegative(), api: z.number().finite().nonnegative().optional(), token: z.number().finite().nonnegative().optional(), local_compute: z.boolean().optional() }),
}).strict()

export type DistributionPublishResult = z.infer<typeof distributionPublishResultSchema>
