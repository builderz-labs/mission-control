import { z } from 'zod'
import { distributionVerificationEvidenceSchema } from '@/lib/marketing/content-distribution'

export const factoryCommandRiskSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const factoryFreshnessSchema = z.enum(['fresh', 'stale', 'error'])
export const factoryCanonicalPhaseSchema = z.enum([
  'intake',
  'research',
  'validate',
  'design',
  'build',
  'qa',
  'release',
  'operate',
  'learn',
  'closed',
  'unknown',
])
export const factoryLifecycleStatusSchema = z.enum([
  'ready',
  'running',
  'blocked',
  'failed',
  'completed',
  'unknown',
])

export const factoryDefinitionSchema = z.object({
  contract_version: z.literal('1.0'),
  module: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    purpose: z.string().min(1),
    definition_version: z.string().min(1),
    state_authority: z.enum(['external', 'tower']),
    adapter_kind: z.string().min(1),
  }),
  capabilities: z.object({
    discover_instances: z.boolean(),
    read_snapshot: z.boolean(),
    request_approval: z.boolean(),
    execute_commands: z.boolean(),
    read_metrics: z.boolean(),
    emit_experience: z.boolean(),
  }),
  stages: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    objective: z.string(),
    human_gates: z.array(z.string()),
    next: z.array(z.string()),
  })),
  gates: z.array(z.object({
    id: z.string().min(1),
    stage_id: z.string().nullable(),
    decision_owner: z.enum(['human', 'ai', 'deterministic']),
    blocking: z.boolean(),
    decisions: z.array(z.string()),
    apply_command: z.string().nullable().optional(),
  })),
  commands: z.array(z.object({
    id: z.string().min(1),
    mode: z.enum(['read_only', 'mutating']),
    risk: factoryCommandRiskSchema,
    description: z.string(),
    human_confirmation: z.enum(['never', 'conditional', 'always']),
  })),
  cost_policy: z.record(z.string(), z.unknown()),
  learning_policy: z.record(z.string(), z.unknown()),
})

export const factorySnapshotSchema = z.object({
  snapshot_version: z.literal('1.0'),
  instance_id: z.string().min(1),
  module_id: z.string().min(1),
  observed_at: z.string().min(1),
  source: z.object({
    authority: z.string().min(1),
    native_id: z.string().min(1),
    revision: z.string().min(1),
    adapter_version: z.string().min(1),
  }),
  freshness: z.object({
    state: factoryFreshnessSchema,
    last_success_at: z.string().nullable(),
    last_error: z.string().nullable(),
  }),
  lifecycle: z.object({
    process_stage_id: z.string().nullable(),
    native_stage: z.string().nullable(),
    canonical_phase: factoryCanonicalPhaseSchema,
    status: factoryLifecycleStatusSchema,
  }),
  compatibility: z.object({
    native_version: z.string(),
    contract_coverage: z.enum(['full', 'partial', 'unknown']),
    warnings: z.array(z.string()),
  }),
  gates: z.array(z.object({
    id: z.string(),
    state: z.enum(['approved', 'open', 'closed', 'unavailable', 'unknown']),
    blocking: z.boolean(),
    decided_at: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    evidence_refs: z.array(z.string()),
  })),
  checks: z.array(z.object({
    id: z.string(),
    ok: z.boolean(),
    detail: z.string(),
  })),
  artifacts: z.array(z.record(z.string(), z.unknown())),
  review_queues: z.array(z.object({
    kind: z.string(),
    status: z.string(),
    queued_at: z.string().nullable().optional(),
    last_error: z.string().nullable().optional(),
    symbolic_action: z.string().nullable().optional(),
  })),
  next_actions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    kind: z.string(),
    blocking: z.boolean(),
  })),
  blockers: z.array(z.object({
    id: z.string(),
    label: z.string(),
    detail: z.string().nullable().optional(),
    source: z.string(),
  })),
  risks: z.array(z.record(z.string(), z.unknown())),
  metrics: z.array(z.record(z.string(), z.unknown())),
  available_commands: z.array(z.object({
    command_id: z.string(),
    available: z.boolean(),
    reason: z.string().nullable().optional(),
    risk: factoryCommandRiskSchema,
  })),
  raw_summary: z.record(z.string(), z.unknown()).optional(),
})

export const factoryApprovalDecisionSchema = z.object({
  decision: z.enum(['approve', 'revise', 'hold']),
  note: z.string().max(4000).optional().default(''),
  expected_revision: z.string().min(1),
  publish_evidence: distributionVerificationEvidenceSchema.optional(),
})

export const factoryRefreshRequestSchema = z.object({
  force: z.boolean().optional().default(false),
})
