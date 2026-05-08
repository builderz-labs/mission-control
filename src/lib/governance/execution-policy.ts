export type PolicyDenialCode =
  | 'MAINTENANCE_MODE'
  | 'QUOTA_EXCEEDED'
  | 'MAX_CONCURRENT_RUNS'
  | 'MAX_CONCURRENT_AGENT'
  | 'POLICY_UNAVAILABLE'

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: PolicyDenialCode; reason: string }

export interface ExecutionPolicy {
  maxConcurrentRuns: number
  maxConcurrentPerAgent: number
  maxTasksPerHour: number
  maintenanceMode: boolean
}

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  maxConcurrentRuns: 10,
  maxConcurrentPerAgent: 3,
  maxTasksPerHour: 100,
  maintenanceMode: false,
}
