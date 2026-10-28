export type MarketSignalStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'PROMOTED'
export type OpportunityStatus = 'DISCOVERED' | 'RESEARCH' | 'EVIDENCE_READY' | 'TEST' | 'BUILD' | 'KILLED' | 'WATCH'
export type OpportunitySourceState = 'LIVE_FREE' | 'AUTH_REQUIRED' | 'MANUAL_OR_EXPORT' | 'HOLD'

export interface ScanQuery {
  id: string
  query: string
  portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY' | 'ADJACENT' | 'EXPLORATION'
  domain_hint: string
  workflow_hint: string
}

export interface MarketSignalInput {
  signal_id: string
  source_id: string
  source_type: string
  source_ref: string
  source_url: string | null
  title: string
  body_excerpt: string
  author: string | null
  published_at: number | null
  query_text: string
  portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY' | 'ADJACENT' | 'EXPLORATION'
  domain_hint: string
  pain_terms: string[]
  content_hash: string
  raw_payload: Record<string, unknown>
}

export interface MarketSignalRow {
  id: number
  workspace_id: number
  signal_id: string
  source_id: string
  source_type: string
  source_ref: string
  source_url: string | null
  title: string
  body_excerpt: string
  author: string | null
  published_at: number | null
  query_text: string | null
  portfolio_bucket: string
  domain_hint: string | null
  pain_terms: string
  content_hash: string
  raw_payload: string
  status: MarketSignalStatus
  opportunity_id: string | null
  created_at: number
  updated_at: number
}

export interface RevenueOpportunityRow {
  id: number
  workspace_id: number
  opportunity_id: string
  title: string
  domain: string | null
  workflow: string | null
  pain: string
  target_user: string | null
  buyer: string | null
  status: OpportunityStatus
  portfolio_bucket: string
  evidence_confidence: 'A' | 'B' | 'C' | 'D'
  judge_decision: string | null
  primary_payment_trigger: string | null
  scores: string
  founder_advantage: string
  facts: string
  inferences: string
  assumptions: string
  validation: string
  source_count: number
  created_at: number
  updated_at: number
}
