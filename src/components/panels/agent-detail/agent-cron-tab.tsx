'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/types/sql'
import type { Agent, AgentCronJob } from './agent-detail-types'

const log = createClientLogger('CronTab')

interface CronTabProps {
  agent: Agent
}

// Formats a cron job run timestamp into a human-readable string
function formatTime(value: string | number | null | undefined): string {
  if (!value) return 'n/a'
  const d = typeof value === 'number' ? new Date(value) : new Date(value)
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

export function CronTab({ agent }: CronTabProps) {
  const t = useTranslations('agentDetail')
  const [allJobs, setAllJobs] = useState<AgentCronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const loadCron = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/cron?action=list', { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('Failed to load cron jobs')
      const data = await response.json()
      setAllJobs(data.jobs || [])
    } catch (err: unknown) {
      log.error('Failed to load cron jobs:', err)
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Re-fetch whenever the viewed agent changes
  useEffect(() => { loadCron() }, [agent.id])

  const agentName = agent.name.toLowerCase().replace(/\s+/g, '-')
  const agentJobs = showAll
    ? allJobs
    : allJobs.filter(j =>
        j.agentId === agent.name
        || j.agentId === agentName
        || j.agentId === String(agent.id)
      )

  if (loading && allJobs.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label="Loading cron jobs" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('cronJobs')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {showAll ? t('allCronJobsCount', { count: agentJobs.length, total: allJobs.length }) : t('agentCronJobsCount', { count: agentJobs.length, total: allJobs.length })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowAll(!showAll)}
            size="xs"
            variant={showAll ? 'outline' : 'secondary'}
          >
            {showAll ? t('agentOnly') : t('showAll')}
          </Button>
          <Button onClick={loadCron} size="sm" variant="secondary" disabled={loading}>
            {loading ? '...' : t('refresh')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {agentJobs.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">
          {showAll ? t('noCronJobsFound') : t('noCronJobsAssigned', { agent: agent.name })}
        </div>
      ) : (
        <div className="space-y-2">
          {agentJobs.map(job => (
            <div key={job.name} className="bg-surface-1/50 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{job.name}</div>
                  {job.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{job.description}</div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-0.5 text-xs bg-surface-2 rounded font-mono">
                      {job.schedule || job.cron || t('noSchedule')}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      job.enabled ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {job.enabled ? t('enabled') : t('disabled')}
                    </span>
                    {job.sessionTarget && (
                      <span className="px-2 py-0.5 text-xs bg-surface-2 rounded text-muted-foreground">
                        {job.sessionTarget}
                      </span>
                    )}
                    {job.agentId && (
                      <span className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-400 rounded">
                        {job.agentId}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground space-y-1">
                  <div>{t('last')}: {formatTime(job.lastRun)}</div>
                  <div>{t('next')}: {formatTime(job.nextRun)}</div>
                  {job.state && <div className="font-mono">{job.state}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
