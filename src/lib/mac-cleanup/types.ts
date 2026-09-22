export const CLEANUP_MODES = ['audit', 'dry-run', 'auto'] as const
export type CleanupMode = (typeof CLEANUP_MODES)[number]

export const TRIGGERABLE_IDS = ['safe-reclaim', 'resource-guardian', 'storage-maintenance'] as const
export type TriggerableId = (typeof TRIGGERABLE_IDS)[number]

export type AutomationId =
  | TriggerableId
  | 'clean-mac'
  | 'clean-ram'
  | 'safe-disk-maintenance'

export type MutationClass = 'observe' | 'cache' | 'aggressive' | 'alias'
export type ResourceKind = 'cpu' | 'ram' | 'swap' | 'disk'
export type TriggerIntent = 'manual' | 'watch'
export type BreachSeverity = 'ok' | 'warn' | 'critical'

export interface Thresholds {
  cpuHighPercent: number
  ramLowPercent: number
  swapHighPercent: number
  diskLowGb: number
  diskEmergencyGb: number
  diskTargetGb: number
  cooldownSeconds: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  cpuHighPercent: 85,
  ramLowPercent: 15,
  swapHighPercent: 80,
  diskLowGb: 50,
  diskEmergencyGb: 20,
  diskTargetGb: 50,
  cooldownSeconds: 1800,
}

export interface LiveMetrics {
  cpuLoadPercent: number | null
  ramFreePercent: number | null
  swapUsedPercent: number | null
  diskFreeGb: number | null
  npmActive: boolean | null
  pnpmActive: boolean | null
}

export interface ThresholdBreach {
  id: ResourceKind
  label: string
  breached: boolean
  severity: BreachSeverity
  value: number | null
  threshold: number
  unit: string
  detail: string
}

export interface TriggerDecision {
  allowed: boolean
  code: string
  reason: string
}

export interface LaunchdState {
  loaded: boolean
  pid: number | null
  lastExit: number | null
}

export interface StorageLastRun {
  timestamp: string | null
  code: string | null
  diskFreeBeforeGb: number | null
  diskFreeAfterGb: number | null
  attemptedTools: number
  deferredTools: number
  failedTools: number
}

export interface AutomationView {
  id: AutomationId
  label: string
  launchdLabel: string
  binary: string
  mutationClass: MutationClass
  resources: ResourceKind[]
  intervalSeconds: number | null
  triggerable: boolean
  loaded: boolean
  pid: number | null
  lastExit: number | null
  lastCycleAt: number | null
  lastStatus: string | null
  notes: string[]
}

export interface CleanupRecommendation {
  action: string
  reason: string
  automationId: TriggerableId | null
}

export interface MacCleanupSnapshot {
  timestamp: number
  platform: NodeJS.Platform
  available: boolean
  metrics: LiveMetrics
  thresholds: Thresholds
  breaches: ThresholdBreach[]
  recommendation: CleanupRecommendation
  automations: AutomationView[]
  findings: string[]
  protectedProjects: string[]
  watch: { enabled: boolean; lastAutoAt: number | null }
}

export interface TriggerResult {
  ok: boolean
  id: TriggerableId
  mode: CleanupMode
  decision: TriggerDecision
  stdout: string
  stderr: string
  code: number | null
}
