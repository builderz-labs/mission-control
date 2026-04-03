'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CronJob } from '@/store'
import { getAgentColorClass, getStatusBg, getStatusColor } from './cron-management-types'
import { describeCronFrequency } from '@/lib/cron-utils'

interface LogEntry {
  timestamp: number
  message: string
  level: string
}

interface CronJobDetailProps {
  selectedJob: CronJob
  jobLogs: LogEntry[]
  uniqueAgents: string[]
  formatRelativeTime: (timestamp: string | number, future?: boolean) => string
  onClose: () => void
  onTriggerJob: (job: CronJob, mode: 'force' | 'due') => void
  onToggleJob: (job: CronJob) => void
  onCloneJob: (job: CronJob) => void
  onOpenRunHistory: (job: CronJob) => void
  onRemoveJob: (job: CronJob) => void
}

export function CronJobDetail({
  selectedJob,
  jobLogs,
  uniqueAgents,
  formatRelativeTime,
  onClose,
  onTriggerJob,
  onToggleJob,
  onCloneJob,
  onOpenRunHistory,
  onRemoveJob,
}: CronJobDetailProps): React.JSX.Element {
  const t = useTranslations('cronManagement')
  const isLocalAutomation =
    selectedJob.delivery === 'local' && selectedJob.agentId === 'mission-control-local'

  return (
    <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-foreground">{selectedJob.name}</h2>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              selectedJob.enabled
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
            }`}
          >
            {selectedJob.enabled ? t('enabled') : t('disabled')}
          </span>
          {selectedJob.lastStatus && (
            <span
              className={`px-2 py-1 text-xs rounded-full ${getStatusBg(
                selectedJob.lastStatus
              )} ${getStatusColor(selectedJob.lastStatus)}`}
            >
              {selectedJob.lastStatus}
            </span>
          )}
          <Button onClick={onClose} variant="ghost" size="sm" className="text-xs">
            {t('close')}
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left: Configuration */}
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('configuration')}
            </h3>
            <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                <span className="text-muted-foreground">{t('colSchedule')}</span>
                <div>
                  <code className="font-mono text-foreground">{selectedJob.schedule}</code>
                  <div className="text-xs text-muted-foreground">
                    {describeCronFrequency(selectedJob.schedule)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                <span className="text-muted-foreground">{t('colAgent')}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded border w-fit ${getAgentColorClass(
                    selectedJob.agentId || '',
                    uniqueAgents
                  )}`}
                >
                  {selectedJob.agentId || 'system'}
                </span>
              </div>
              {selectedJob.model && (
                <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                  <span className="text-muted-foreground">{t('colModel')}</span>
                  <code className="font-mono text-xs text-foreground">{selectedJob.model}</code>
                </div>
              )}
              <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                <span className="text-muted-foreground">{t('delivery')}</span>
                <span className="text-foreground text-xs">{selectedJob.delivery || 'gateway'}</span>
              </div>
              {isLocalAutomation && (
                <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                  <span className="text-muted-foreground">{t('source')}</span>
                  <span className="text-foreground text-xs">{t('localSchedulerAutomation')}</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('command')}
            </h3>
            <pre className="bg-secondary/50 rounded-lg p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-all overflow-x-auto max-h-32">
              {selectedJob.command}
            </pre>
          </div>

          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('timing')}
            </h3>
            <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
              {selectedJob.lastRun && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('lastRun')}</span>
                  <span className="text-foreground">
                    {new Date(selectedJob.lastRun).toLocaleString()} (
                    {formatRelativeTime(selectedJob.lastRun)})
                  </span>
                </div>
              )}
              {selectedJob.nextRun && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('nextRun')}</span>
                  <span className="text-primary">
                    {new Date(selectedJob.nextRun).toLocaleString()} (
                    {formatRelativeTime(selectedJob.nextRun, true)})
                  </span>
                </div>
              )}
              {selectedJob.timezone && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('timezone')}</span>
                  <span className="text-foreground">{selectedJob.timezone}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => onTriggerJob(selectedJob, 'force')}
              size="sm"
              className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30"
            >
              {t('runNowForce')}
            </Button>
            <Button
              onClick={() => onTriggerJob(selectedJob, 'due')}
              size="sm"
              className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30"
            >
              {t('runNowIfDue')}
            </Button>
            <Button
              onClick={() => onToggleJob(selectedJob)}
              disabled={isLocalAutomation}
              size="sm"
              className={
                selectedJob.enabled
                  ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border-yellow-500/30'
                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/30'
              }
            >
              {selectedJob.enabled ? t('disable') : t('enable')}
            </Button>
            <Button
              onClick={() => onCloneJob(selectedJob)}
              disabled={isLocalAutomation}
              size="sm"
              variant="outline"
            >
              {t('clone')}
            </Button>
            <Button onClick={() => onOpenRunHistory(selectedJob)} size="sm" variant="outline">
              {t('history')}
            </Button>
            <Button
              onClick={() => onRemoveJob(selectedJob)}
              disabled={isLocalAutomation}
              variant="destructive"
              size="sm"
            >
              {t('remove')}
            </Button>
          </div>
        </div>

        {/* Right: Logs */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {t('recentLogs')}
          </h3>
          <div className="bg-secondary/50 rounded-lg p-4 max-h-80 overflow-y-auto">
            {jobLogs.length === 0 ? (
              <div className="text-muted-foreground text-sm">{t('noLogsAvailable')}</div>
            ) : (
              <div className="space-y-1.5 text-xs font-mono">
                {jobLogs.map((logEntry, index) => (
                  <div key={index} className="text-muted-foreground">
                    <span className="text-[10px] text-muted-foreground/60">
                      [{new Date(logEntry.timestamp).toLocaleString()}]
                    </span>{' '}
                    {logEntry.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
