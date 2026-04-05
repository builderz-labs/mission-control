// Types and constants for the Provider Failover panel

export interface RoutingRule {
  id: number
  provider: string
  priority: number
  enabled: number
  max_retries: number
  timeout_ms: number
  capability_tags: string[]
  workspace_id: number
  created_at: number
  updated_at: number
}

export interface RecentLog {
  id: number
  latency_ms: number | null
  status: string
  error: string | null
  checked_at: number
}

export interface ProviderHealth {
  provider: string
  avgLatency: number | null
  p95Latency: number | null
  successRate: number
  lastError: string | null
  lastChecked: number | null
  recentLogs: RecentLog[]
}

export interface AddForm {
  provider: string
  priority: string
  max_retries: string
  timeout_ms: string
  capability_tags: string
}

export const EMPTY_FORM: AddForm = {
  provider: '',
  priority: '',
  max_retries: '2',
  timeout_ms: '30000',
  capability_tags: '',
}
