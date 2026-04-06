// Shared type definitions for the super-admin provisioning subsystem.
// Kept in one place so provision-plans, tenant-jobs, and callers all import
// from the same canonical source — avoids accidental divergence.

export type TenantStatus =
  | 'pending'
  | 'provisioning'
  | 'decommissioning'
  | 'active'
  | 'suspended'
  | 'error'

export type ProvisionJobStatus =
  | 'queued'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'

export type ProvisionJobAction = 'approve' | 'reject' | 'cancel'

export interface TenantBootstrapRequest {
  slug: string
  display_name: string
  linux_user?: string
  plan_tier?: string
  gateway_port?: number
  dashboard_port?: number
  dry_run?: boolean
  config?: Record<string, unknown>
  owner_gateway?: string
}

export interface TenantDecommissionRequest {
  dry_run?: boolean
  remove_linux_user?: boolean
  remove_state_dirs?: boolean
  reason?: string
}

export interface ProvisionStep {
  key: string
  title: string
  command: string[]
  requires_root: boolean
  timeout_ms?: number
}
