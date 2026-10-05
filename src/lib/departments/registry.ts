export const DEPARTMENT_IDS = [
  'product',
  'engineering',
  'marketing',
  'creative-video',
  'growth',
  'voc-research',
  'revenue-sales',
  'operations-control-tower',
] as const

export type DepartmentId = typeof DEPARTMENT_IDS[number]

export type ExecutorKind = 'local-deterministic' | 'chatgpt' | 'codex' | 'claude' | 'human'
export type ExternalAiTier = 0 | 1 | 2 | 3

export interface DepartmentDefinition {
  id: DepartmentId
  name: string
  mission: string
  brain_path: string
  inputs: string[]
  outputs: string[]
  metrics: string[]
  evidence_types: string[]
  skills: string[]
  learning_triggers: string[]
  default_executor: ExecutorKind
  escalation: {
    codex_when: string[]
    claude_when: string[]
    dual_review_when: string[]
  }
}

const commonEscalation = {
  codex_when: [
    'multi-file implementation with a deterministic test/build loop',
    'repository-wide refactor or migration',
    'repeatable code transformation where local execution materially improves confidence',
  ],
  claude_when: [
    'independent architecture or design critique is valuable',
    'long-context review across many artifacts or policy documents',
    'high-value creative/strategy review where a second model reduces blind spots',
  ],
  dual_review_when: [
    'security, permissions, release policy or money movement changes',
    'high-impact workflow changes with difficult rollback',
    'flagship external creative or launch decision with material business risk',
  ],
}

export const departmentRegistry: readonly DepartmentDefinition[] = [
  {
    id: 'product',
    name: 'Product',
    mission: 'Turn verified user problems into useful, measurable product outcomes.',
    brain_path: '20 Areas/AI Company OS/Departments/Product.md',
    inputs: ['VOC clusters', 'market evidence', 'strategy', 'growth signals', 'revenue signals'],
    outputs: ['prioritized problem', 'PRD/evals', 'product decision', 'release hypothesis'],
    metrics: ['activation_rate', 'retention_rate', 'task_success_rate', 'time_to_value', 'revenue_impact'],
    evidence_types: ['real_metric', 'human_confirmation', 'verified_postcondition', 'conversion_revenue'],
    skills: ['problem-framing', 'jtbd', 'continuous-discovery', 'prd-evals', 'product-review'],
    learning_triggers: ['repeated user friction', 'activation/retention regression', 'failed product hypothesis'],
    default_executor: 'chatgpt',
    escalation: commonEscalation,
  },
  {
    id: 'engineering',
    name: 'Engineering',
    mission: 'Implement product intent safely with reproducible tests, builds and rollback.',
    brain_path: '20 Areas/AI Company OS/Departments/Engineering.md',
    inputs: ['approved spec', 'repo state', 'quality constraints', 'security constraints'],
    outputs: ['code diff', 'tests', 'build artifact', 'release evidence'],
    metrics: ['test_pass_rate', 'build_success_rate', 'escaped_defects', 'cycle_time', 'rollback_rate'],
    evidence_types: ['deterministic_test', 'accepted_code_diff', 'verified_build', 'verified_postcondition'],
    skills: ['spec-to-code', 'test-loop', 'regression-analysis', 'release-readiness', 'rollback'],
    learning_triggers: ['same failure repeated', 'slow build/test loop', 'regression after accepted diff'],
    default_executor: 'local-deterministic',
    escalation: commonEscalation,
  },
  {
    id: 'marketing',
    name: 'Marketing',
    mission: 'Create measurable demand by matching audience, positioning, message, offer and channel.',
    brain_path: '20 Areas/AI Company OS/Departments/Marketing.md',
    inputs: ['product context', 'audience evidence', 'positioning', 'content performance', 'VOC'],
    outputs: ['campaign', 'content brief', 'channel plan', 'diagnosis', 'next experiment'],
    metrics: ['views', 'reach', 'profile_visits', 'link_clicks', 'ctr', 'signup_conversion', 'follow_conversion'],
    evidence_types: ['real_metric', 'verified_publish', 'conversion_revenue', 'human_confirmation'],
    skills: ['positioning', 'channel-strategy', 'hook-message-offer', 'copy', 'measurement-diagnosis'],
    learning_triggers: ['low reach/views', 'low engagement', 'low ctr', 'high clicks with low signup'],
    default_executor: 'chatgpt',
    escalation: commonEscalation,
  },
  {
    id: 'creative-video',
    name: 'Creative / Video',
    mission: 'Turn an approved message into platform-native creative that earns attention and action.',
    brain_path: '20 Areas/AI Company OS/Departments/Creative-Video.md',
    inputs: ['creative brief', 'hook hypothesis', 'brand rules', 'reference set', 'platform constraints'],
    outputs: ['script', 'storyboard', 'asset', 'render', 'creative QA report'],
    metrics: ['three_second_hold', 'average_watch_time', 'completion_rate', 'share_rate', 'save_rate', 'creative_ctr'],
    evidence_types: ['real_metric', 'verified_publish', 'deterministic_check', 'independent_review'],
    skills: ['packaging', 'hook', 'retention', 'storyboard', 'editing', 'caption-audio-qa'],
    learning_triggers: ['early drop-off', 'completion regression', 'creative fatigue', 'strong watch with weak click'],
    default_executor: 'chatgpt',
    escalation: commonEscalation,
  },
  {
    id: 'growth',
    name: 'Growth',
    mission: 'Find the highest-leverage funnel bottleneck and run disciplined experiments against it.',
    brain_path: '20 Areas/AI Company OS/Departments/Growth.md',
    inputs: ['funnel metrics', 'channel performance', 'product analytics', 'experiment history'],
    outputs: ['bottleneck diagnosis', 'experiment hypothesis', 'experiment result', 'scale/kill decision'],
    metrics: ['visitor_to_signup', 'signup_to_activation', 'activation_to_retention', 'experiment_lift', 'payback_period'],
    evidence_types: ['real_metric', 'verified_postcondition', 'conversion_revenue'],
    skills: ['funnel-analysis', 'experiment-design', 'growth-model', 'distribution-loop'],
    learning_triggers: ['funnel bottleneck shift', 'experiment failure cluster', 'repeatable lift'],
    default_executor: 'chatgpt',
    escalation: commonEscalation,
  },
  {
    id: 'voc-research',
    name: 'VOC / Research',
    mission: 'Convert user language and observed behavior into reliable problem evidence.',
    brain_path: '20 Areas/AI Company OS/Departments/VOC-Research.md',
    inputs: ['interviews', 'support messages', 'comments', 'reviews', 'behavioral evidence'],
    outputs: ['coded evidence', 'problem cluster', 'language bank', 'research confidence'],
    metrics: ['evidence_count', 'unique_sources', 'problem_frequency', 'problem_severity', 'research_recency'],
    evidence_types: ['human_confirmation', 'real_metric', 'independent_review'],
    skills: ['interviewing', 'coding', 'clustering', 'research-synthesis', 'language-mining'],
    learning_triggers: ['repeated problem language', 'new cluster', 'contradiction between stated and observed behavior'],
    default_executor: 'chatgpt',
    escalation: commonEscalation,
  },
  {
    id: 'revenue-sales',
    name: 'Revenue / Sales',
    mission: 'Turn qualified demand into durable revenue without hiding weak retention or product fit.',
    brain_path: '20 Areas/AI Company OS/Departments/Revenue-Sales.md',
    inputs: ['qualified demand', 'pricing', 'offers', 'sales/VOC evidence', 'product usage'],
    outputs: ['offer', 'pricing decision', 'sales playbook', 'revenue diagnosis'],
    metrics: ['conversion_rate', 'arpu', 'mrr', 'gross_margin', 'ltv', 'cac', 'churn'],
    evidence_types: ['conversion_revenue', 'real_metric', 'human_confirmation'],
    skills: ['offer-design', 'pricing', 'sales-discovery', 'objection-learning', 'revenue-analysis'],
    learning_triggers: ['conversion drop', 'objection cluster', 'high acquisition with weak retention', 'pricing resistance'],
    default_executor: 'chatgpt',
    escalation: commonEscalation,
  },
  {
    id: 'operations-control-tower',
    name: 'Operations / Control Tower',
    mission: 'Route work, preserve state authority, control cost/risk and make improvement auditable.',
    brain_path: '20 Areas/AI Company OS/Departments/Operations-Control-Tower.md',
    inputs: ['factory snapshots', 'approvals', 'cost/usage', 'learning evidence', 'operator priorities'],
    outputs: ['task packet', 'approval decision', 'executor recommendation', 'improvement candidate', 'audit trail'],
    metrics: ['blocked_work', 'approval_latency', 'external_ai_cost', 'failed_commands', 'stale_snapshots'],
    evidence_types: ['deterministic_check', 'verified_postcondition', 'independent_review', 'human_confirmation'],
    skills: ['routing', 'risk-gating', 'cost-aware-execution', 'evidence-governance', 'rollback-governance'],
    learning_triggers: ['repeated routing failure', 'avoidable AI spend', 'stale state', 'repeated approval bottleneck'],
    default_executor: 'local-deterministic',
    escalation: commonEscalation,
  },
] as const

export const costAwareExecutionPolicy = {
  tiers: [
    { tier: 0 as const, executor: 'local-deterministic' as const, rule: 'Use local checks, scripts, DB queries and builds before model calls.' },
    { tier: 1 as const, executor: 'chatgpt' as const, rule: 'Default for orchestration, research synthesis, decisions and low-cost guided actions.' },
    { tier: 2 as const, executor: 'codex' as const, rule: 'Use for multi-file implementation and test/build loops when expected quality gain is material.' },
    { tier: 2 as const, executor: 'claude' as const, rule: 'Use for independent design/creative/long-context review when expected quality gain is material.' },
    { tier: 3 as const, executor: 'human' as const, rule: 'Require human gate plus independent review for high-risk/high-value changes.' },
  ],
  paid_api_default_hard_cap_usd_per_day: 0,
  optimizer_auto_run: false,
  auto_trust_learned_skills: false,
} as const

export function getDepartment(id: DepartmentId): DepartmentDefinition {
  const department = departmentRegistry.find((item) => item.id === id)
  if (!department) throw new Error(`Unknown department: ${id}`)
  return department
}
