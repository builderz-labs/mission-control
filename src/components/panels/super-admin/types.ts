export type SuperTab = 'tenants' | 'jobs' | 'events'

export interface TenantRow {
  id: number
  slug: string
  display_name: string
  linux_user: string
  created_by?: string
  owner_gateway?: string
  status: string
  plan_tier: string
  gateway_port: number | null
  dashboard_port: number | null
  created_at: number
  latest_job_id?: number | null
  latest_job_status?: string | null
}

export interface ProvisionJob {
  id: number
  tenant_id: number
  tenant_slug?: string
  tenant_display_name?: string
  job_type: string
  status: string
  dry_run: number
  requested_by: string
  approved_by?: string | null
  started_at?: number | null
  completed_at?: number | null
  error_text?: string | null
  created_at: number
}

export interface ProvisionEvent {
  id: number
  level: string
  step_key?: string | null
  message: string
  created_at: number
}

export interface DecommissionDialogState {
  open: boolean
  tenant: TenantRow | null
  dryRun: boolean
  removeLinuxUser: boolean
  removeStateDirs: boolean
  reason: string
  confirmText: string
  submitting: boolean
}

export interface GatewayOption {
  id: number
  name: string
  status?: string
  is_primary?: number
}

export interface SchedulerTask {
  id: string
  name: string
  enabled: boolean
  lastRun: number | null
  nextRun: number
  running: boolean
  lastResult?: {
    ok: boolean
    message: string
    timestamp: number
  }
}

export interface CreateFormState {
  slug: string
  display_name: string
  linux_user: string
  plan_tier: string
  owner_gateway: string
  gateway_port: string
  dashboard_port: string
  dry_run: boolean
}

export interface KpiData {
  active: number
  pending: number
  errored: number
  queuedApprovals: number
}

export const TENANT_PAGE_SIZE = 8
export const JOB_PAGE_SIZE = 8
