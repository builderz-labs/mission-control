'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { normalizeAuditResponse } from './security-audit-data-transform'
import { PostureSection, InfraScanSection, ToolAuditSection, TimelineSection, AgentEvalsSection } from './security-audit-sections'
import { AuthEventsSection, AgentTrustSection, SecretAlertsSection, RateLimitsSection, InjectionSection } from './security-audit-tables'
import type { SecurityAuditData, AgentEvalsData } from './security-audit-panel-types'

export function SecurityAuditPanel(): React.JSX.Element {
  const t = useTranslations('securityAudit')
  const { setSecurityPosture } = useMissionControl()

  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [data, setData] = useState<SecurityAuditData | null>(null)
  const [evalsData, setEvalsData] = useState<AgentEvalsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      const [auditRes, evalsRes] = await Promise.all([
        fetch(`/api/security-audit?timeframe=${selectedTimeframe}`),
        fetch(`/api/agents/evals?timeframe=${selectedTimeframe}`),
      ])
      if (auditRes.ok) {
        const raw = await auditRes.json() as Record<string, unknown>
        const normalized = normalizeAuditResponse(raw)
        setData(normalized)
        if (normalized.posture) {
          setSecurityPosture(normalized.posture)
        }
      }
      if (evalsRes.ok) {
        const evals = await evalsRes.json() as AgentEvalsData
        setEvalsData(evals)
      } else {
        setError('Failed to load agent evaluations')
      }
    } catch {
      setError('Failed to load security audit data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe, setSecurityPosture])

  useSmartPoll(fetchData, 30_000)

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => { setError(null); void fetchData() }}
            className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
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
          <PostureSection posture={data.posture} />

          {data.scan && <InfraScanSection scan={data.scan} />}

          {/* Auth Events + Agent Trust side by side */}
          <div className="grid lg:grid-cols-2 gap-6">
            <AuthEventsSection authEvents={data.authEvents} />
            <AgentTrustSection agentTrust={data.agentTrust} />
          </div>

          <SecretAlertsSection secretAlerts={data.secretAlerts} />

          {/* Tool Audit + Rate Limits side by side */}
          <div className="grid lg:grid-cols-2 gap-6">
            <ToolAuditSection toolAudit={data.toolAudit} />
            <RateLimitsSection rateLimits={data.rateLimits} />
          </div>

          <InjectionSection injectionAttempts={data.injectionAttempts} />

          <TimelineSection timeline={data.timeline} selectedTimeframe={selectedTimeframe} />

          {evalsData && <AgentEvalsSection evalsData={evalsData} />}
        </div>
      )}
    </div>
  )
}
