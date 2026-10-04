import type { FactoryDefinition } from '../types'

const stages = [
  ['C00', 'Creative Brief Intake'],
  ['C01', 'Reference Research'],
  ['C02', 'Direction Options'],
  ['C03', 'Direction Review'],
  ['C04', 'Script Lock'],
  ['C05', 'Storyboard'],
  ['C06', 'Style Frames'],
  ['C07', 'Animatic'],
  ['C08', 'Asset Production'],
  ['C09', 'Motion / Edit'],
  ['C10', 'Audio / Caption'],
  ['C11', 'Deterministic QA'],
  ['C12', 'Independent Creative Review'],
  ['C13', 'Platform Adaptation'],
  ['C14', 'Delivery'],
] as const

export const creativeFactoryDefinition: FactoryDefinition = {
  contract_version: '1.0',
  module: {
    id: 'creative-factory',
    name: 'Creative Factory',
    purpose: 'Turn approved briefs into verified video, carousel, image and launch assets.',
    definition_version: '0.1-shufuro-compat',
    state_authority: 'external',
    adapter_kind: 'render-assets-files',
  },
  capabilities: {
    discover_instances: true,
    read_snapshot: true,
    request_approval: true,
    execute_commands: false,
    read_metrics: true,
    emit_experience: true,
  },
  stages: stages.map(([id, label], index) => ({
    id,
    label,
    objective: label,
    human_gates: id === 'C03' ? ['creative_direction'] : [],
    next: index < stages.length - 1 ? [stages[index + 1][0]] : [],
  })),
  gates: [
    {
      id: 'creative_direction',
      stage_id: 'C03',
      decision_owner: 'human',
      blocking: true,
      decisions: ['approve', 'revise', 'hold'],
      apply_command: null,
    },
  ],
  commands: [
    { id: 'refresh', mode: 'read_only', risk: 'low', description: 'Read current creative asset/render state.', human_confirmation: 'never' },
  ],
  cost_policy: {
    mode: 'economical',
    prefer_local_rendering: true,
    paid_api_default_hard_cap_usd_per_day: 0,
  },
  learning_policy: {
    passive_logging: true,
    deterministic_analysis: true,
    optimizer_auto_run: false,
  },
}
