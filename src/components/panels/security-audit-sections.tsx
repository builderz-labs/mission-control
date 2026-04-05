'use client'

// Chart and gauge sub-sections for SecurityAuditPanel.
// Table/list sections are in security-audit-tables.tsx.

import { useTranslations } from 'next-intl'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { ScanCategoryRow } from './security-scan-category'
import {
  postureColor,
  postureRingColor,
  postureBgColor,
  type SecurityAuditData,
  type AgentEvalsData,
} from './security-audit-panel-types'

// ---------------------------------------------------------------------------
// Posture gauge (circular SVG progress ring)
// ---------------------------------------------------------------------------

interface PostureSectionProps {
  posture: SecurityAuditData['posture']
}

export function PostureSection({ posture }: PostureSectionProps) {
  const t = useTranslations('securityAudit')
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center gap-6">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-muted" strokeWidth="2.5" />
            <circle
              cx="18" cy="18" r="15.9" fill="none"
              className={postureRingColor(posture.score)}
              strokeWidth="2.5"
              strokeDasharray={`${posture.score} ${100 - posture.score}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold ${postureColor(posture.score)}`}>
              {posture.score}
            </span>
          </div>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('securityPosture')}</h2>
          <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded ${postureBgColor(posture.level)}`}>
            {posture.level}
          </span>
          <p className="text-sm text-muted-foreground mt-2">{t('blendedScore')}</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Infrastructure scan categories (expandable rows)
// ---------------------------------------------------------------------------

interface InfraScanSectionProps {
  scan: NonNullable<SecurityAuditData['scan']>
}

const SCAN_ICONS: Record<string, string> = {
  credentials: 'K', network: 'N', openclaw: 'O', runtime: 'R', os: 'S',
}

export function InfraScanSection({ scan }: InfraScanSectionProps) {
  const t = useTranslations('securityAudit')
  const categoryLabels: Record<string, string> = {
    credentials: t('scanCredentials'),
    network: t('scanNetwork'),
    openclaw: t('scanOpenclaw'),
    runtime: t('scanRuntime'),
    os: t('scanOs'),
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('infrastructureScan')}</h2>
        <span className={`text-sm font-bold tabular-nums ${postureColor(scan.score)}`}>
          {scan.score}/100
        </span>
      </div>
      <div className="space-y-2">
        {Object.entries(scan.categories).map(([key, cat]) => {
          const label = categoryLabels[key] ?? key
          const icon = SCAN_ICONS[key] ?? key[0].toUpperCase()
          const failingCount = cat.checks.filter((c) => c.status !== 'pass').length
          return (
            <ScanCategoryRow
              key={key}
              label={label}
              icon={icon}
              category={cat}
              failingCount={failingCount}
            />
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MCP tool audit stacked bar chart
// ---------------------------------------------------------------------------

interface ToolAuditSectionProps {
  toolAudit: SecurityAuditData['toolAudit']
}

export function ToolAuditSection({ toolAudit }: ToolAuditSectionProps) {
  const t = useTranslations('securityAudit')
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">{t('mcpToolAudit')}</h2>
      {toolAudit.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          {t('noToolUsageData')}
        </div>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={toolAudit}>
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
  )
}

// ---------------------------------------------------------------------------
// Security event timeline line chart
// ---------------------------------------------------------------------------

interface TimelineSectionProps {
  timeline: SecurityAuditData['timeline']
  selectedTimeframe: string
}

export function TimelineSection({ timeline, selectedTimeframe }: TimelineSectionProps) {
  const t = useTranslations('securityAudit')
  const chartData = timeline.map((p) => ({
    ...p,
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }))

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">
        {t('securityTimeline', { timeframe: selectedTimeframe })}
      </h2>
      {timeline.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          {t('noTimelineData')}
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
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
  )
}

// ---------------------------------------------------------------------------
// Agent eval dashboard (convergence gauge + per-agent score bars)
// ---------------------------------------------------------------------------

interface AgentEvalsSectionProps {
  evalsData: AgentEvalsData
}

export function AgentEvalsSection({ evalsData }: AgentEvalsSectionProps) {
  const t = useTranslations('securityAudit')
  return (
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
          {evalsData.agents.map((agent) => (
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
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                      {t('drift')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('convergence')}</span>
                  <span className={`text-sm font-bold ${postureColor(agent.convergence)}`}>
                    {agent.convergence}%
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {agent.scores.map((s) => (
                  <div key={s.layer} className="text-center">
                    <div className="text-2xs text-muted-foreground mb-1 truncate">{s.layer}</div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${
                          s.score / s.maxScore >= 0.8
                            ? 'bg-green-500'
                            : s.score / s.maxScore >= 0.5
                            ? 'bg-yellow-500'
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
  )
}
