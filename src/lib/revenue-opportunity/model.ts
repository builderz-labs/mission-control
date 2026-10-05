export const MARKET_GRAVITY_DIMENSIONS = [
  'transaction_volume',
  'spending_frequency',
  'user_frequency',
  'pain_frequency',
  'existing_spend',
  'automation_potential',
  'recurring_revenue_potential',
  'market_fragmentation',
  'digitalization_gap',
  'distribution_accessibility',
  'competition_intensity',
  'regulatory_risk',
] as const

export const HUMAN_DEMAND_DIMENSIONS = [
  'pain_severity',
  'frequency',
  'emotional_urgency',
  'time_pressure',
  'consequence_of_failure',
  'relationship_social_stakes',
  'multi_user_potential',
  'natural_virality',
  'life_event_trigger',
  'wtp_trigger',
  'retention_potential',
] as const

export const FOUNDER_ADVANTAGE_DIMENSIONS = [
  'experience',
  'language',
  'network',
  'existing_products',
  'data',
  'technology',
  'domain_understanding',
] as const

export const AUTOMATION_LEVERAGE_DIMENSIONS = [
  'repeatability',
  'structured_inputs',
  'manual_time_cost',
  'error_reduction_potential',
  'ai_fit',
  'workflow_integrability',
] as const

export type EvidenceKind = 'FACT' | 'INFERENCE' | 'ASSUMPTION'
export type EvidenceConfidence = 'A' | 'B' | 'C' | 'D'
export type OpportunityDecision = 'KILL' | 'WATCH' | 'RESEARCH' | 'TEST' | 'BUILD'
export type PortfolioBucket = 'HIGH_ECONOMIC_GRAVITY' | 'ADJACENT' | 'EXPLORATION'

export interface OpportunityEvidenceGate {
  unique_sources: number
  repeated_user_pain: boolean
  existing_alternative_verified: boolean
  existing_spend_or_loss_verified: boolean
  frequency_verified: boolean
  competition_checked: boolean
  distribution_path_verified: boolean
}

export function evaluateOpportunityEvidenceGate(gate: OpportunityEvidenceGate) {
  const missing: string[] = []
  if (gate.unique_sources < 3) missing.push('unique_sources>=3')
  if (!gate.repeated_user_pain) missing.push('repeated_user_pain')
  if (!gate.existing_alternative_verified) missing.push('existing_alternative_verified')
  if (!gate.existing_spend_or_loss_verified) missing.push('existing_spend_or_loss_verified')
  if (!gate.frequency_verified) missing.push('frequency_verified')
  if (!gate.competition_checked) missing.push('competition_checked')
  if (!gate.distribution_path_verified) missing.push('distribution_path_verified')
  return { pass: missing.length === 0, missing }
}

export const PORTFOLIO_EXPLORATION_POLICY = {
  HIGH_ECONOMIC_GRAVITY: 0.5,
  ADJACENT: 0.3,
  EXPLORATION: 0.2,
} as const

export const HUMAN_MOTIVATION_ETHICS = {
  prohibit: [
    'amplify fear to force payment',
    'false urgency',
    'pressure vulnerable users into payment',
    'guarantee outcomes that cannot be guaranteed',
    'addiction-oriented retention',
    'keep users anxious to retain them',
  ],
  principle: 'High urgency is valuable only when the product can provide real, proportionate help.',
} as const

export const OPPORTUNITY_LEARNING_QUESTIONS = [
  'Which dimensions correlate with real revenue?',
  'Which dimensions are repeatedly overestimated?',
  'Which sources produce the highest-quality opportunities?',
  'Are we biased toward familiar verticals?',
  'Why did high-scoring opportunities fail?',
  'Did any low-scoring opportunity outperform?',
  'Should evidence thresholds change?',
  'Was there a cheaper validation test before build?',
] as const
