// Types and constants for the Security Audit panel — co-located for cohesion

export interface AuthEvent {
  id: number
  type: string
  actor: string
  ip: string
  timestamp: number
  detail: string
}

export interface AgentTrust {
  agentId: number
  name: string
  trustScore: number
  flagged: boolean
  lastEval: number
}

export interface SecretAlert {
  id: number
  file: string
  line: number
  type: string
  preview: string
  detectedAt: number
  resolved: boolean
}

export interface ToolAuditEntry {
  tool: string
  calls: number
  successes: number
  failures: number
}

export interface RateLimitSignal {
  ip: string
  hits: number
  agent?: string
  lastHit: number
}

export interface InjectionAttempt {
  id: number
  type: string
  source: string
  input: string
  blocked: boolean
  timestamp: number
}

export interface TimelinePoint {
  timestamp: string
  authEvents: number
  injectionAttempts: number
  secretAlerts: number
  toolCalls: number
}

export interface EvalScore {
  layer: string
  score: number
  maxScore: number
}

export interface AgentEval {
  agentId: number
  name: string
  scores: EvalScore[]
  convergence: number
  driftDetected: boolean
  lastEvalAt: number
}

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface ScanCheck {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  fix: string
  severity?: CheckSeverity
}

export interface ScanCategory {
  score: number
  checks: ScanCheck[]
}

export interface ScanData {
  score: number
  overall: string
  categories: Record<string, ScanCategory>
}

export interface SecurityAuditData {
  posture: { score: number; level: string }
  scan?: ScanData
  authEvents: AuthEvent[]
  agentTrust: AgentTrust[]
  secretAlerts: SecretAlert[]
  toolAudit: ToolAuditEntry[]
  rateLimits: RateLimitSignal[]
  injectionAttempts: InjectionAttempt[]
  timeline: TimelinePoint[]
}

export interface AgentEvalsData {
  agents: AgentEval[]
  overallConvergence: number
  driftAlerts: string[]
}

// Status icons and colors used by scan category rows
export const SCAN_STATUS_ICON: Record<string, string> = {
  pass: '+',
  fail: 'x',
  warn: '!',
}

export const SCAN_STATUS_COLOR: Record<string, string> = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  warn: 'text-amber-400',
}

export const SEVERITY_BADGE: Record<CheckSeverity, { label: string; className: string }> = {
  critical: { label: 'C', className: 'bg-red-500/20 text-red-400' },
  high: { label: 'H', className: 'bg-orange-500/20 text-orange-400' },
  medium: { label: 'M', className: 'bg-amber-500/20 text-amber-400' },
  low: { label: 'L', className: 'bg-blue-500/20 text-blue-300' },
}

// Shared color-derivation helpers — pure functions, no side-effects
export function postureColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-yellow-400'
  if (score >= 40) return 'text-orange-400'
  return 'text-red-400'
}

export function postureRingColor(score: number): string {
  if (score >= 80) return 'stroke-green-500'
  if (score >= 60) return 'stroke-yellow-500'
  if (score >= 40) return 'stroke-orange-500'
  return 'stroke-red-500'
}

export function postureBgColor(level: string): string {
  switch (level) {
    case 'hardened': return 'bg-green-500/15 text-green-400'
    case 'secure': return 'bg-green-500/10 text-green-300'
    case 'needs-attention': return 'bg-yellow-500/15 text-yellow-400'
    case 'at-risk': return 'bg-red-500/15 text-red-400'
    default: return 'bg-muted text-muted-foreground'
  }
}

export function trustBarColor(score: number): string {
  if (score >= 0.8) return 'bg-green-500'
  if (score >= 0.5) return 'bg-yellow-500'
  return 'bg-red-500'
}

export function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
