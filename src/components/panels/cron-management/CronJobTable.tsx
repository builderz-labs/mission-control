'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { CronJob } from '@/store'
import { getAgentColorClass, getStatusBg, getStatusColor } from './cron-management-types'
import { describeCronFrequency } from '@/lib/cron-utils'

interface CronJobTableProps {
  filteredJobs: CronJob[]
  cronJobs: CronJob[]
  uniqueAgents: string[]
  isLoading: boolean
  selectedJob: CronJob | null
  runDropdownJobId: string | null
  formatRelativeTime: (timestamp: string | number, future?: boolean) => string
  onJobSelect: (job: CronJob) => void
  onToggleJob: (job: CronJob) => void
  onTriggerJob: (job: CronJob, mode: 'force' | 'due') => void
  onCloneJob: (job: CronJob) => void
  onOpenRunHistory: (job: CronJob) => void
  onRunDropdownJobIdChange: (id: string | null) => void
}

export function CronJobTable({
  filteredJobs,
  cronJobs,
  uniqueAgents,
  isLoading,
  selectedJob,
  runDropdownJobId,
  formatRelativeTime,
  onJobSelect,
  onToggleJob,
  onTriggerJob,
  onCloneJob,
  onOpenRunHistory,
  onRunDropdownJobIdChange,
}: CronJobTableProps): React.JSX.Element {
  const t = useTranslations('cronManagement')

  return (
    <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('scheduledJobs')}</h2>
        <span className="text-xs text-muted-foreground">
          {t('jobsCount', { count: filteredJobs.length, total: cronJobs.length })}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader variant="inline" label={t('loadingJobs')} />
        </div>
      ) : cronJobs.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">{t('noCronJobsFound')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">{t('colJobName')}</th>
                <th className="pb-2 pr-3 font-medium">{t('colAgent')}</th>
                <th className="pb-2 pr-3 font-medium">{t('colSchedule')}</th>
                <th className="pb-2 pr-3 font-medium">{t('colModel')}</th>
                <th className="pb-2 pr-3 font-medium">{t('colStatus')}</th>
                <th className="pb-2 pr-3 font-medium">{t('colLastRun')}</th>
                <th className="pb-2 pr-3 font-medium">{t('colNextRun')}</th>
                <th className="pb-2 font-medium text-right">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredJobs.map((job, index) => {
                const isLocalAutomation =
                  job.delivery === 'local' && job.agentId === 'mission-control-local'
                const isSelected = selectedJob?.name === job.name
                return (
                  <tr
                    key={`${job.name}-${index}`}
                    onClick={() => onJobSelect(job)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            job.enabled ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                        />
                        <span className="font-medium text-foreground truncate max-w-48">
                          {job.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded border ${getAgentColorClass(
                          job.agentId || '',
                          uniqueAgents
                        )}`}
                      >
                        {job.agentId || 'system'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="text-xs">
                        <span className="text-foreground">
                          {describeCronFrequency(job.schedule)}
                        </span>
                        <div className="text-muted-foreground font-mono text-[10px]">
                          {job.schedule}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {job.model ? (
                        <span className="text-xs font-mono text-muted-foreground">
                          {job.model}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">--</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {job.lastStatus ? (
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${getStatusBg(
                            job.lastStatus
                          )} ${getStatusColor(job.lastStatus)}`}
                        >
                          {job.lastStatus}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">--</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                      {job.lastRun ? formatRelativeTime(job.lastRun) : '--'}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-primary/70 whitespace-nowrap">
                      {job.nextRun ? formatRelativeTime(job.nextRun, true) : '--'}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleJob(job)
                          }}
                          disabled={isLocalAutomation}
                          size="xs"
                          variant="outline"
                          className="text-[10px] h-6 px-1.5"
                        >
                          {job.enabled ? t('disable') : t('enable')}
                        </Button>
                        <div className="relative">
                          <div className="flex">
                            <Button
                              onClick={(e) => {
                                e.stopPropagation()
                                onTriggerJob(job, 'force')
                              }}
                              size="xs"
                              variant="outline"
                              className="text-[10px] h-6 px-1.5 rounded-r-none border-r-0"
                            >
                              {t('run')}
                            </Button>
                            <Button
                              onClick={(e) => {
                                e.stopPropagation()
                                onRunDropdownJobIdChange(
                                  runDropdownJobId === (job.id || job.name)
                                    ? null
                                    : (job.id || job.name)
                                )
                              }}
                              size="xs"
                              variant="outline"
                              className="text-[10px] h-6 px-1 rounded-l-none"
                            >
                              v
                            </Button>
                          </div>
                          {runDropdownJobId === (job.id || job.name) && (
                            <div className="absolute right-0 top-7 z-20 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onTriggerJob(job, 'force')
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                              >
                                {t('runNowForce')}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onTriggerJob(job, 'due')
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50"
                              >
                                {t('runNowIfDue')}
                              </button>
                            </div>
                          )}
                        </div>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            onCloneJob(job)
                          }}
                          disabled={isLocalAutomation}
                          size="xs"
                          variant="outline"
                          className="text-[10px] h-6 px-1.5"
                        >
                          {t('clone')}
                        </Button>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            onJobSelect(job)
                            onOpenRunHistory(job)
                          }}
                          size="xs"
                          variant="outline"
                          className="text-[10px] h-6 px-1.5"
                        >
                          {t('history')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
