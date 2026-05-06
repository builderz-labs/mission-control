'use client'

const DEFAULT_TTM_API_URL = 'http://localhost:8100'
const TOKEN_STORAGE_KEY = 'ttm_access_token'

export interface RunUsage {
  tokens_used: number
  cost_usd: number
  cost_burn_rate: number | null
  budget_threshold_status: 'ok' | 'warn' | 'critical'
}

export interface ControlPlaneRunSummary {
  run_id: string
  stream_id: string
  stream_version: string
  title: string
  objective: string
  status: string
  risk_level: string
  runtime_id: string
  runtime_status: string
  event_count: number
  last_event_at: string | null
  run_usage: RunUsage | null
  created_at: string
  updated_at: string
}

export interface ApprovalQueueItem {
  approval_id: string | null
  run_id: string
  stream_id: string
  stream_version: string
  title: string
  objective: string
  approval_type: string
  decision: string
  scope_epoch: number
  status: string
  run_status: string
  risk_level: string
  runtime_status: string
  created_at: string
  updated_at: string
}

export interface AttentionItem {
  id: string
  kind: 'approval' | 'stuck_run' | 'blocked_run' | 'degraded_runtime'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  reason: string
  run_id: string
  stream_id: string
  run_status: string
  runtime_status: string | null
  time_since_last_event_minutes: number | null
  approval: ApprovalQueueItem | null
}

export interface AttentionResponse {
  generated_at: string
  stream_id: string
  stale_threshold_minutes: number
  items: AttentionItem[]
}

export interface FleetRun {
  run: ControlPlaneRunSummary
  time_since_last_event_minutes: number | null
  is_stuck: boolean
  has_open_approval: boolean
  cost_burn_rate: number | null
}

export interface FleetResponse {
  generated_at: string
  stream_id: string
  runs: FleetRun[]
}

export interface SignalItem {
  label: string
  value: string
  tone: 'healthy' | 'warning' | 'critical' | 'muted'
  provenance: string
}

export interface SignalsResponse {
  generated_at: string
  stream_id: string
  freshness: string
  authority: string
  items: SignalItem[]
}

export interface MemoryResponse {
  generated_at: string
  freshness: string
  authority: string
  runbooks: Array<{
    label: string
    status: 'available' | 'stub'
    provenance: string
    detail: string
  }>
}

export interface RuntimeHealthResponse {
  generated_at: string
  runtimes: Array<{
    runtime_id: string
    status: string
    freshness: string
    last_checked: string
    reason: string | null
    producer: string
  }>
}

export interface EvidenceReview {
  run_id: string
  stream_id: string
  stream_version: string
  scope_epoch: number
  items: Array<{
    evidence_id: string
    kind: string
    subject: string
    produced_at: string
    verdict: string
    verification_status: string
    is_current_scope: boolean
    stale_reason: string | null
  }>
  rollup: {
    total: number
    current: number
    stale: number
    by_verdict: Record<string, number>
    by_kind: Record<string, number>
  }
}

export interface RunDetail extends ControlPlaneRunSummary {
  recent_events?: Array<{
    event_id: string
    event_type: string
    occurred_at: string
    summary: string
  }>
  approvals?: ApprovalQueueItem[]
  evidence_items?: EvidenceReview['items']
}

export interface GalactusClientConfig {
  apiBase: string
  token: string
}

export function readGalactusClientConfig(): GalactusClientConfig {
  const apiBase =
    process.env.NEXT_PUBLIC_TTM_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_TTM_API_URL
  let token = process.env.NEXT_PUBLIC_TTM_ACCESS_TOKEN || ''
  if (typeof window !== 'undefined') {
    token = window.localStorage.getItem(TOKEN_STORAGE_KEY) || token
  }
  return { apiBase: apiBase.replace(/\/$/, ''), token }
}

export function saveGalactusToken(token: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim())
  }
}

export async function fetchGalactus<T>(
  path: string,
  config = readGalactusClientConfig()
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  const response = await fetch(`${config.apiBase}${path}`, { headers })
  if (!response.ok) {
    throw new Error(`TTM ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<T>
}
