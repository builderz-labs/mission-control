'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useNavigateToPanel } from '@/lib/navigation'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

interface AuthEvent {
  id: number
  type: string
  actor: string
  ip: string
  timestamp: number
  detail: string
}

interface AgentTrust {
  agentId: number
  name: string
  trustScore: number
  flagged: boolean
  lastEval: number
}

interface SecretAlert {
  id: number
  file: string
  line: number
  type: string
  preview: string
  detectedAt: number
  resolved: boolean
}

interface ToolAuditEntry {
  tool: string
  calls: number
  successes: number
  failures: number
}

interface RateLimitSignal {
  ip: string
  hits: number
  agent?: string
  lastHit: number
}

interface InjectionAttempt {
  id: number
  type: string
  source: string
  input: string
  blocked: boolean
  timestamp: number
}

interface TimelinePoint {
  timestamp: string
  authEvents: number
  injectionAttempts: number
  secretAlerts: number
  toolCalls: number
}

interface EvalScore {
  layer: string
  score: number
  maxScore: number
}

interface AgentEval {
  agentId: number
  name: string
  scores: EvalScore[]
  convergence: number
  driftDetected: boolean
  lastEvalAt: number
}

type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'

interface ScanCheck {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  fix: string
  severity?: CheckSeverity
}

interface ScanCategory {
  score: number
  checks: ScanCheck[]
}

interface ScanData {
  score: number
  overall: string
  categories: Record<string, ScanCategory>
}

interface SecurityAuditData {
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

interface AgentEvalsData {
  agents: AgentEval[]
  overallConvergence: number
  driftAlerts: string[]
}

const SCAN_STATUS_ICON: Record<string, string> = { pass: '+', fail: 'x', warn: '!' }
const SCAN_STATUS_COLOR: Record<string, string> = { pass: 'text-green-400', fail: 'text-red-400', warn: 'text-amber-400' }

const SEVERITY_BADGE: Record<CheckSeverity, { label: string; className: string }> = {
  critical: { label: 'C', className: 'bg-red-500/20 text-red-400' },
  high: { label: 'H', className: 'bg-orange-500/20 text-orange-400' },
  medium: { label: 'M', className: 'bg-amber-500/20 text-amber-400' },
  low: { label: 'L', className: 'bg-blue-500/20 text-blue-300' },
}

function ScanCategoryRow({ label, icon, category, failingCount }: {
  label: string; icon: string; category: ScanCategory; failingCount: number
}) {
  const t = useTranslations('securityAudit')
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/50 transition-colors"
      >
        <span className="w-5 h-5 rounded bg-secondary flex items-center justify-center text-xs font-mono text-muted-foreground">
          {icon}
        </span>
        <span className="flex-1 text-sm font-medium">{label}</span>
        <span className={`text-xs tabular-nums ${category.score >= 80 ? 'text-green-400' : category.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
          {category.score}%
        </span>
        {failingCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('issueCount', { count: failingCount })}
          </span>
        )}
        <span className="text-xs text-muted-foreground/50">{expanded ? '-' : '+'}</span>
      </button>
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1.5 bg-secondary/20">
          {[...category.checks].sort((a, b) => {
            if (a.status === 'pass' && b.status !== 'pass') return 1
            if (a.status !== 'pass' && b.status === 'pass') return -1
            const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
            return (sev[a.severity ?? 'medium'] ?? 2) - (sev[b.severity ?? 'medium'] ?? 2)
          }).map(check => (
            <div key={check.id} className="flex items-start gap-2 py-1">
              <span className={`font-mono text-xs mt-0.5 w-4 shrink-0 ${SCAN_STATUS_COLOR[check.status]}`}>
                [{SCAN_STATUS_ICON[check.status]}]
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{check.name}</span>
                  {check.severity && (
                    <span className={`text-2xs px-1 py-0.5 rounded font-mono leading-none ${SEVERITY_BADGE[check.severity].className}`}>
                      {SEVERITY_BADGE[check.severity].label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{check.detail}</p>
                {check.fix && check.status !== 'pass' && (
                  <p className="text-xs text-primary/70 mt-0.5">{t('fixPrefix', { fix: check.fix })}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SecurityAuditPanel() {
  const t = useTranslations('securityAudit')
  const { setSecurityPosture } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()

  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [data, setData] = useState<SecurityAuditData | null>(null)
  const [evalsData, setEvalsData] = useState<AgentEvalsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [auditRes, evalsRes] = await Promise.all([
        fetch(`/api/security-audit?timeframe=${selectedTimeframe}`),
        fetch(`/api/agents/evals?timeframe=${selectedTimeframe}`),
      ])
      if (auditRes.ok) {
        const audit = await auditRes.json()
        // API returns authEvents as { loginFailures, tokenRotations, accessDenials, recentEvents }
        // but the panel expects authEvents to be an array of AuthEvent
        if (audit.authEvents && !Array.isArray(audit.authEvents)) {
          const events = audit.authEvents.recentEvents || []
          audit.authEvents = events.map((e: any, i: number) => ({
            id: i,
            type: (e.event_type || '').replace('auth.', ''),
            actor: e.agent_name || 'unknown',
            ip: e.ip_address || '',
            timestamp: e.created_at || 0,
            detail: e.detail || '',
          }))
        }
        // agentTrust: { agents: [...], flaggedCount } → AgentTrust[]
        if (audit.agentTrust && !Array.isArray(audit.agentTrust)) {
          const agents = audit.agentTrust.agents || []
          const flaggedThreshold = 0.8
          audit.agentTrust = agents.map((a: any, i: number) => ({
            agentId: i,
            name: a.name,
            trustScore: a.score,
            flagged: a.score < flaggedThreshold,
          }))
        }
        // secretExposures → secretAlerts
        if (audit.secretExposures && !audit.secretAlerts) {
          const recent = audit.secretExposures.recent || []
          audit.secretAlerts = recent.map((e: any, i: number) => ({
            id: i,
            file: e.detail || '',
            line: 0,
            type: (e.event_type || '').replace('secret.', ''),
            preview: e.detail || '',
            detectedAt: e.created_at || 0,
            resolved: false,
          }))
        }
        if (!Array.isArray(audit.secretAlerts)) audit.secretAlerts = []
        // mcpAudit → toolAudit
        if (audit.mcpAudit && !audit.toolAudit) {
          const topTools = audit.mcpAudit.topTools || []
          audit.toolAudit = topTools.map((t: any) => ({
            tool: t.name,
            calls: t.count,
            successes: t.count,
            failures: 0,
          }))
        }
        if (!Array.isArray(audit.toolAudit)) audit.toolAudit = []
        // rateLimits: { totalHits, byIp } → RateLimitSignal[]
        if (audit.rateLimits && !Array.isArray(audit.rateLimits)) {
          const byIp = audit.rateLimits.byIp || []
          audit.rateLimits = byIp.map((r: any) => ({
            ip: r.ip,
            hits: r.count,
            lastHit: 0,
          }))
        }
        // injectionAttempts: { total, recent } → InjectionAttempt[]
        if (audit.injectionAttempts && !Array.isArray(audit.injectionAttempts)) {
          const recent = audit.injectionAttempts.recent || []
          audit.injectionAttempts = recent.map((e: any, i: number) => ({
            id: i,
            type: (e.event_type || '').replace('injection.', ''),
            source: e.agent_name || e.ip_address || 'unknown',
            input: e.detail || '',
            blocked: true,
            timestamp: e.created_at || 0,
          }))
        }
        // timeline: [{timestamp, eventCount, severity}] → [{timestamp, authEvents, ...}]
        if (Array.isArray(audit.timeline)) {
          audit.timeline = audit.timeline.map((t: any) => ({
            timestamp: t.timestamp,
            authEvents: t.eventCount || 0,
            injectionAttempts: 0,
            secretAlerts: 0,
            toolCalls: 0,
          }))
        }
        setData(audit)
        if (audit.posture) {
          setSecurityPosture(audit.posture)
        }
      }
      if (evalsRes.ok) {
        const evals = await evalsRes.json()
        setEvalsData(evals)
      }
    } catch {
      // Silent failure — data will remain stale
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe, setSecurityPosture])

  useSmartPoll(fetchData, 30_000)

  const postureColor = (score: number) => {
    if (score >= 80) return 'text-green-400'
    if (score >= 60) return 'text-yellow-400'
    if (score >= 40) return 'text-orange-400'
    return 'text-red-400'
  }

  const postureRingColor = (score: number) => {
    if (score >= 80) return 'stroke-green-500'
    if (score >= 60) return 'stroke-yellow-500'
    if (score >= 40) return 'stroke-orange-500'
    return 'stroke-red-500'
  }

  const postureBgColor = (level: string) => {
    switch (level) {
      case 'hardened': return 'bg-green-500/15 text-green-400'
      case 'secure': return 'bg-green-500/10 text-green-300'
      case 'needs-attention': return 'bg-yellow-500/15 text-yellow-400'
      case 'at-risk': return 'bg-red-500/15 text-red-400'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  const trustBarColor = (score: number) => {
    if (score >= 0.8) return 'bg-green-500'
    if (score >= 0.5) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-2">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {isLoading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
            )}
            <div className="flex space-x-2">
              {(['hour', 'day', 'week', 'month'] as const).map((tf) => (
                <Button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  variant={selectedTimeframe === tf ? 'default' : 'secondary'}
                >
                  {t(`timeframe${tf.charAt(0).toUpperCase() + tf.slice(1)}` as 'timeframeHour' | 'timeframeDay' | 'timeframeWeek' | 'timeframeMonth')}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!data ? (
        <Loader variant="panel" label={t('loadingSecurityData')} />
      ) : (
        <div className="space-y-6">
          {/* Posture Score Header */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-6">
              {/* Circular gauge */}
              <div className="relative w-24 h-24 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-muted" strokeWidth="2.5" />
                  <circle
                    cx="18" cy="18" r="15.9" fill="none"
                    className={postureRingColor(data.posture.score)}
                    strokeWidth="2.5"
                    strokeDasharray={`${data.posture.score} ${100 - data.posture.score}`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-2xl font-bold ${postureColor(data.posture.score)}`}>
                    {data.posture.score}
                  </span>
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">{t('securityPosture')}</h2>
                <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded ${postureBgColor(data.posture.level)}`}>
                  {data.posture.level}
                </span>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('blendedScore')}
                </p>
              </div>
            </div>
          </div>

          {/* Infrastructure Scan Categories */}
          {data.scan && (
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('infrastructureScan')}</h2>
                <span className={`text-sm font-bold tabular-nums ${postureColor(data.scan.score)}`}>
                  {data.scan.score}/100
                </span>
              </div>
              <div className="space-y-2">
                {Object.entries(data.scan.categories).map(([key, cat]) => {
                  const scanCategoryLabels: Record<string, string> = { credentials: t('scanCredentials'), network: t('scanNetwork'), openclaw: t('scanOpenclaw'), runtime: t('scanRuntime'), os: t('scanOs') }
                  const label = scanCategoryLabels[key] || key
                  const icon = { credentials: 'K', network: 'N', openclaw: 'O', runtime: 'R', os: 'S' }[key] || key[0].toUpperCase()
                  const failing = cat.checks.filter(c => c.status !== 'pass')
                  return (
                    <ScanCategoryRow key={key} label={label} icon={icon} category={cat} failingCount={failing.length} />
                  )
                })}
              </div>
            </div>
          )}

          {/* Auth Events + Agent Trust */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Auth Events */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('authEvents')}</h2>
              {data.authEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t('noAuthEvents')}</p>
              ) : (
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-left text-muted-foreground text-xs">
                        <th className="pb-2 pr-3">{t('colType')}</th>
                        <th className="pb-2 pr-3">{t('colActor')}</th>
                        <th className="pb-2 pr-3">{t('colIP')}</th>
                        <th className="pb-2">{t('colTime')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {data.authEvents.map(evt => (
                        <tr key={evt.id} className="text-xs">
                          <td className="py-1.5 pr-3">
                            <span className={`px-1.5 py-0.5 rounded text-2xs font-medium ${
                              evt.type === 'login_failure' ? 'bg-red-500/15 text-red-400'
                              : evt.type === 'token_rotation' ? 'bg-blue-500/15 text-blue-400'
                              : 'bg-muted text-muted-foreground'
                            }`}>
                              {evt.type.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-foreground">{evt.actor}</td>
                          <td className="py-1.5 pr-3 font-mono text-muted-foreground">{evt.ip}</td>
                          <td className="py-1.5 text-muted-foreground">{formatTime(evt.timestamp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Agent Trust Scores */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('agentTrustScores')}</h2>
              {data.agentTrust.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t('noAgentTrustData')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                  {data.agentTrust.map(agent => (
                    <div
                      key={agent.agentId}
                      className={`p-3 rounded-lg border ${
                        agent.flagged ? 'border-red-500/50 bg-red-500/5' : 'border-border bg-secondary'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
                        {agent.flagged && (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 shrink-0 ml-1">{t('flagged')}</span>
                        )}
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${trustBarColor(agent.trustScore)}`}
                          style={{ width: `${agent.trustScore * 100}%` }}
                        />
                      </div>
                      <div className="text-2xs text-muted-foreground mt-1">{(agent.trustScore * 100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Secret Exposure Alerts */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">{t('secretExposureAlerts')}</h2>
            {data.secretAlerts.length === 0 ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <svg className="w-5 h-5 text-green-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 1a5 5 0 015 5v2a2 2 0 01-2 2H5a2 2 0 01-2-2V6a5 5 0 015-5z" />
                  <path d="M5.5 14h5M6.5 12v2M9.5 12v2" />
                </svg>
                <span className="text-sm font-medium text-green-400">{t('noSecretsDetected')}</span>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-muted-foreground text-xs">
                      <th className="pb-2 pr-3">{t('colType')}</th>
                      <th className="pb-2 pr-3">{t('colFile')}</th>
                      <th className="pb-2 pr-3">{t('colPreview')}</th>
                      <th className="pb-2 pr-3">{t('colStatus')}</th>
                      <th className="pb-2">{t('colDetected')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.secretAlerts.map(alert => (
                      <tr key={alert.id} className="text-xs">
                        <td className="py-1.5 pr-3">
                          <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 text-2xs font-medium">{alert.type}</span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-foreground">{alert.file}:{alert.line}</td>
                        <td className="py-1.5 pr-3 font-mono text-muted-foreground max-w-48 truncate">{alert.preview}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`text-2xs ${alert.resolved ? 'text-green-400' : 'text-red-400'}`}>
                            {alert.resolved ? t('statusResolved') : t('statusActive')}
                          </span>
                        </td>
                        <td className="py-1.5 text-muted-foreground">{formatTime(alert.detectedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* MCP Tool Audit + Rate Limits */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* MCP Tool Audit BarChart */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('mcpToolAudit')}</h2>
              {data.toolAudit.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t('noToolUsageData')}</div>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.toolAudit}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="tool" angle={-45} textAnchor="end" height={60} interval={0} tick={{ fontSize: 10 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="successes" stackId="a" fill="#22c55e" name={t('chartSuccess')} />
                      <Bar dataKey="failures" stackId="a" fill="#ef4444" name={t('chartFailure')} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Rate Limit / Abuse Signals */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('rateLimitAbuseSignals')}</h2>
              {data.rateLimits.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t('noRateLimitSignals')}</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {data.rateLimits.map((rl, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-secondary rounded-lg text-sm">
                      <div>
                        <span className="font-mono text-foreground">{rl.ip}</span>
                        {rl.agent && <span className="ml-2 text-xs text-muted-foreground">({rl.agent})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${rl.hits > 100 ? 'text-red-400' : rl.hits > 50 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                          {t('hits', { hits: rl.hits })}
                        </span>
                        <span className="text-2xs text-muted-foreground">{formatTime(rl.lastHit)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Injection Attempts */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">{t('injectionAttempts')}</h2>
            {data.injectionAttempts.length === 0 ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <svg className="w-5 h-5 text-green-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 1l6 3v4c0 3.5-2.5 6.5-6 7.5C4.5 14.5 2 11.5 2 8V4l6-3z" />
                  <path d="M5.5 8l2 2 3.5-3.5" />
                </svg>
                <span className="text-sm font-medium text-green-400">{t('noInjectionAttempts')}</span>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-muted-foreground text-xs">
                      <th className="pb-2 pr-3">{t('colType')}</th>
                      <th className="pb-2 pr-3">{t('colSource')}</th>
                      <th className="pb-2 pr-3">{t('colInput')}</th>
                      <th className="pb-2 pr-3">{t('colStatus')}</th>
                      <th className="pb-2">{t('colTime')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.injectionAttempts.map(attempt => (
                      <tr key={attempt.id} className="text-xs">
                        <td className="py-1.5 pr-3">
                          <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 text-2xs font-medium">{attempt.type}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-foreground">{attempt.source}</td>
                        <td className="py-1.5 pr-3 font-mono text-muted-foreground max-w-48 truncate">{attempt.input}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`text-2xs font-medium ${attempt.blocked ? 'text-green-400' : 'text-red-400'}`}>
                            {attempt.blocked ? t('statusBlocked') : t('statusPassed')}
                          </span>
                        </td>
                        <td className="py-1.5 text-muted-foreground">{formatTime(attempt.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">{t('securityTimeline', { timeframe: selectedTimeframe })}</h2>
            {data.timeline.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t('noTimelineData')}</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.timeline.map(p => ({
                    ...p,
                    time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="authEvents" stroke="#8884d8" strokeWidth={2} name={t('chartAuthEvents')} />
                    <Line type="monotone" dataKey="injectionAttempts" stroke="#ef4444" strokeWidth={2} name={t('chartInjections')} />
                    <Line type="monotone" dataKey="secretAlerts" stroke="#f59e0b" strokeWidth={2} name={t('chartSecrets')} />
                    <Line type="monotone" dataKey="toolCalls" stroke="#22c55e" strokeWidth={2} name={t('chartToolCalls')} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Agent Eval Dashboard */}
          {evalsData && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('agentEvalDashboard')}</h2>

              {/* Convergence gauge + drift alerts */}
              <div className="flex items-center gap-6 mb-6">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-muted" strokeWidth="2.5" />
                    <circle
                      cx="18" cy="18" r="15.9" fill="none"
                      className={postureRingColor(evalsData.overallConvergence)}
                      strokeWidth="2.5"
                      strokeDasharray={`${evalsData.overallConvergence} ${100 - evalsData.overallConvergence}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-lg font-bold ${postureColor(evalsData.overallConvergence)}`}>
                      {evalsData.overallConvergence}
                    </span>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-foreground">{t('overallConvergence')}</h3>
                  <p className="text-xs text-muted-foreground">{t('crossAgentAlignment')}</p>
                  {evalsData.driftAlerts.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {evalsData.driftAlerts.map((alert, i) => (
                        <div key={i} className="text-xs text-red-400 flex items-center gap-1">
                          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M8 1l7 14H1L8 1z" />
                            <path d="M8 6v4M8 12v1" />
                          </svg>
                          {alert}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Per-agent eval scores */}
              {evalsData.agents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('noEvalData')}</p>
              ) : (
                <div className="space-y-3">
                  {evalsData.agents.map(agent => (
                    <div
                      key={agent.agentId}
                      className={`p-4 rounded-lg border ${
                        agent.driftDetected ? 'border-red-500/50 bg-red-500/5' : 'border-border bg-secondary'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{agent.name}</span>
                          {agent.driftDetected && (
                            <span className="text-2xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{t('drift')}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{t('convergence')}</span>
                          <span className={`text-sm font-bold ${postureColor(agent.convergence)}`}>{agent.convergence}%</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {agent.scores.map(s => (
                          <div key={s.layer} className="text-center">
                            <div className="text-2xs text-muted-foreground mb-1 truncate">{s.layer}</div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${
                                  (s.score / s.maxScore) >= 0.8 ? 'bg-green-500'
                                  : (s.score / s.maxScore) >= 0.5 ? 'bg-yellow-500'
                                  : 'bg-red-500'
                                }`}
                                style={{ width: `${(s.score / s.maxScore) * 100}%` }}
                              />
                            </div>
                            <div className="text-2xs text-foreground mt-0.5">{s.score}/{s.maxScore}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
