import type { FactoryDefinition } from '../types'

const stages = [
  ['S00', 'Portfolio Intake'],
  ['S01', 'Evidence Research'],
  ['S02', 'Demand Validation'],
  ['S03', 'Business / Distribution'],
  ['S04', 'Technical Feasibility'],
  ['S05', 'PRD / Evals'],
  ['S06', 'Creative / Taste Exploration'],
  ['S07', 'Design'],
  ['S08', 'Prototype'],
  ['S09', 'Implementation'],
  ['S10', 'QA'],
  ['S11', 'GTM'],
  ['S12', 'Release'],
  ['S13', 'Measurement'],
  ['S14', 'Kill / Iterate / Scale'],
] as const

const gateStage: Record<string, string> = {
  prd_scope: 'S05',
  business_ready: 'S03',
  prd_final: 'S05',
  creative_direction: 'S06',
  build: 'S10',
  testflight_build: 'S12',
  testflight_upload: 'S12',
  app_review_submit: 'S12',
}

export const productFactoryDefinition: FactoryDefinition = {
  contract_version: '1.0',
  module: {
    id: 'product-factory',
    name: 'Product Factory',
    purpose: 'Evidence-to-revenue product lifecycle',
    definition_version: '0.5-compat',
    state_authority: 'external',
    adapter_kind: 'local-cli-files',
  },
  capabilities: {
    discover_instances: true,
    read_snapshot: true,
    request_approval: true,
    execute_commands: true,
    read_metrics: true,
    emit_experience: true,
  },
  stages: stages.map(([id, label], index) => ({
    id,
    label,
    objective: label,
    human_gates: Object.entries(gateStage).filter(([, stage]) => stage === id).map(([gate]) => gate),
    next: index < stages.length - 1 ? [stages[index + 1][0]] : [],
  })),
  gates: Object.entries(gateStage).map(([id, stage_id]) => ({
    id,
    stage_id,
    decision_owner: 'human',
    blocking: true,
    decisions: ['approve', 'revise', 'hold'],
    apply_command: 'approve-gate',
  })),
  commands: [
    { id: 'status', mode: 'read_only', risk: 'low', description: 'Read native Product Factory status.', human_confirmation: 'never' },
    { id: 'quality-status', mode: 'read_only', risk: 'low', description: 'Read deterministic quality status.', human_confirmation: 'never' },
    { id: 'process-audit', mode: 'read_only', risk: 'low', description: 'Read process audit coverage.', human_confirmation: 'never' },
    { id: 'claude-queue', mode: 'read_only', risk: 'low', description: 'Read independent-review queue.', human_confirmation: 'never' },
    { id: 'approve-gate', mode: 'mutating', risk: 'high', description: 'Apply a known human gate approval after explicit confirmation.', human_confirmation: 'always' },
  ],
  cost_policy: {
    mode: 'economical',
    paid_api_default_hard_cap_usd_per_day: 0,
    optional_model_calls_require_policy: true,
  },
  learning_policy: {
    passive_logging: true,
    deterministic_analysis: true,
    reflection_min_new_evidence: 5,
    optimizer_auto_run: false,
  },
}
