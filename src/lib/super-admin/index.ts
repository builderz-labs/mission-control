// Barrel — re-exports the full public API of the super-admin subsystem.
// External callers import from '@/lib/super-admin' (the thin barrel in
// src/lib/super-admin.ts), which delegates entirely to this file.

export type {
  TenantStatus,
  ProvisionJobStatus,
  ProvisionJobAction,
  TenantBootstrapRequest,
  TenantDecommissionRequest,
  ProvisionStep,
} from './types'

export { buildBootstrapPlan, buildDecommissionPlan } from './provision-plans'

export type { TenantWithLatestJob, ProvisionJobRow } from './tenant-queries'
export { listTenants, listProvisionJobs, getProvisionJob } from './tenant-queries'

export {
  createTenantAndBootstrapJob,
  createTenantDecommissionJob,
  transitionProvisionJobStatus,
} from './tenant-mutations'

export { executeProvisionJob } from './job-executor'
