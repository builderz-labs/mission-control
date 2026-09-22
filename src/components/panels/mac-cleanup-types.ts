export interface ThresholdBreach {
  id: 'cpu' | 'ram' | 'swap' | 'disk'
  label: string
  breached: boolean
  severity: 'ok' | 'warn' | 'critical'
  value: number | null
  threshold: number
  unit: string
  detail: string
}

export interface AutomationView {
  id: string
  label: string
  launchdLabel: string
  mutationClass: 'observe' | 'cache' | 'aggressive' | 'alias'
  resources: string[]
  intervalSeconds: number | null
  triggerable: boolean
  loaded: boolean
  pid: number | null
  lastExit: number | null
  lastCycleAt: number | null
  lastStatus: string | null
  notes: string[]
}

export interface MacCleanupSnapshot {
  timestamp: number
  platform: string
  available: boolean
  metrics: {
    cpuLoadPercent: number | null
    ramFreePercent: number | null
    swapUsedPercent: number | null
    diskFreeGb: number | null
    npmActive: boolean | null
    pnpmActive: boolean | null
  }
  thresholds: {
    cpuHighPercent: number
    ramLowPercent: number
    swapHighPercent: number
    diskLowGb: number
    diskEmergencyGb: number
    diskTargetGb: number
    cooldownSeconds: number
  }
  breaches: ThresholdBreach[]
  recommendation: { action: string; reason: string; automationId: string | null }
  automations: AutomationView[]
  findings: string[]
  protectedProjects: string[]
  watch: { enabled: boolean; lastAutoAt: number | null }
}

export interface TriggerResult {
  ok: boolean
  id: string
  mode: string
  decision: { allowed: boolean; code: string; reason: string }
  stdout: string
  stderr: string
  code: number | null
}
