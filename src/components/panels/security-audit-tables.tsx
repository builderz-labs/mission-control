'use client'

// Table and list-based sub-sections for SecurityAuditPanel.
// Kept separate from chart/gauge sections to stay within the 400-line budget.

import { useTranslations } from 'next-intl'
import {
  trustBarColor,
  formatTime,
  type SecurityAuditData,
} from './security-audit-panel-types'

// ---------------------------------------------------------------------------
// Auth events table
// ---------------------------------------------------------------------------

interface AuthEventsSectionProps {
  authEvents: SecurityAuditData['authEvents']
}

export function AuthEventsSection({ authEvents }: AuthEventsSectionProps) {
  const t = useTranslations('securityAudit')
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">{t('authEvents')}</h2>
      {authEvents.length === 0 ? (
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
              {authEvents.map((evt) => (
                <tr key={evt.id} className="text-xs">
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-2xs font-medium ${
                      evt.type === 'login_failure'
                        ? 'bg-red-500/15 text-red-400'
                        : evt.type === 'token_rotation'
                        ? 'bg-blue-500/15 text-blue-400'
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
  )
}

// ---------------------------------------------------------------------------
// Agent trust score cards
// ---------------------------------------------------------------------------

interface AgentTrustSectionProps {
  agentTrust: SecurityAuditData['agentTrust']
}

export function AgentTrustSection({ agentTrust }: AgentTrustSectionProps) {
  const t = useTranslations('securityAudit')
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">{t('agentTrustScores')}</h2>
      {agentTrust.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">{t('noAgentTrustData')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
          {agentTrust.map((agent) => (
            <div
              key={agent.agentId}
              className={`p-3 rounded-lg border ${
                agent.flagged ? 'border-red-500/50 bg-red-500/5' : 'border-border bg-secondary'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
                {agent.flagged && (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 shrink-0 ml-1">
                    {t('flagged')}
                  </span>
                )}
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${trustBarColor(agent.trustScore)}`}
                  style={{ width: `${agent.trustScore * 100}%` }}
                />
              </div>
              <div className="text-2xs text-muted-foreground mt-1">
                {(agent.trustScore * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Secret exposure alerts table
// ---------------------------------------------------------------------------

interface SecretAlertsSectionProps {
  secretAlerts: SecurityAuditData['secretAlerts']
}

export function SecretAlertsSection({ secretAlerts }: SecretAlertsSectionProps) {
  const t = useTranslations('securityAudit')
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">{t('secretExposureAlerts')}</h2>
      {secretAlerts.length === 0 ? (
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
              {secretAlerts.map((alert) => (
                <tr key={alert.id} className="text-xs">
                  <td className="py-1.5 pr-3">
                    <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 text-2xs font-medium">
                      {alert.type}
                    </span>
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
  )
}

// ---------------------------------------------------------------------------
// Rate-limit / abuse signals list
// ---------------------------------------------------------------------------

interface RateLimitsSectionProps {
  rateLimits: SecurityAuditData['rateLimits']
}

export function RateLimitsSection({ rateLimits }: RateLimitsSectionProps) {
  const t = useTranslations('securityAudit')
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">{t('rateLimitAbuseSignals')}</h2>
      {rateLimits.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">{t('noRateLimitSignals')}</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {rateLimits.map((rl, i) => (
            <div key={i} className="flex items-center justify-between p-2 bg-secondary rounded-lg text-sm">
              <div>
                <span className="font-mono text-foreground">{rl.ip}</span>
                {rl.agent && (
                  <span className="ml-2 text-xs text-muted-foreground">({rl.agent})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${
                  rl.hits > 100 ? 'text-red-400' : rl.hits > 50 ? 'text-yellow-400' : 'text-muted-foreground'
                }`}>
                  {t('hits', { hits: rl.hits })}
                </span>
                <span className="text-2xs text-muted-foreground">{formatTime(rl.lastHit)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Injection attempts table
// ---------------------------------------------------------------------------

interface InjectionSectionProps {
  injectionAttempts: SecurityAuditData['injectionAttempts']
}

export function InjectionSection({ injectionAttempts }: InjectionSectionProps) {
  const t = useTranslations('securityAudit')
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">{t('injectionAttempts')}</h2>
      {injectionAttempts.length === 0 ? (
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
              {injectionAttempts.map((attempt) => (
                <tr key={attempt.id} className="text-xs">
                  <td className="py-1.5 pr-3">
                    <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 text-2xs font-medium">
                      {attempt.type}
                    </span>
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
  )
}
