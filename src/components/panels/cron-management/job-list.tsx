'use client'

import type { CronJob } from '@/store'
import { formatRelativeTime, getStatusColor, getStatusBg } from './types'

interface JobListProps {
  cronJobs: CronJob[]
  isLoading: boolean
  selectedJob: CronJob | null
  onJobSelect: (job: CronJob) => void
  onToggleJob: (job: CronJob) => void
  onTriggerJob: (job: CronJob) => void
  onRemoveJob: (job: CronJob) => void
}

export function JobList({
  cronJobs,
  isLoading,
  selectedJob,
  onJobSelect,
  onToggleJob,
  onTriggerJob,
  onRemoveJob,
}: JobListProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Scheduled Jobs</h2>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          <span className="ml-3 text-muted-foreground">Loading jobs...</span>
        </div>
      ) : cronJobs.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No cron jobs found
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {cronJobs.map((job, index) => {
            const isLocalAutomation = job.delivery === 'local' && job.agentId === 'mission-control-local'
            return (
              <div
                key={`${job.name}-${index}`}
                className={`border border-border rounded-lg p-4 cursor-pointer transition-colors ${
                  selectedJob?.name === job.name
                    ? 'bg-primary/10 border-primary/30'
                    : 'hover:bg-secondary'
                }`}
                onClick={() => onJobSelect(job)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-foreground">{job.name}</span>
                      <div className={`w-2 h-2 rounded-full ${job.enabled ? 'bg-green-500' : 'bg-gray-500'}`}></div>

                      {/* Job Type Tag */}
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
                        isLocalAutomation ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
                        job.name.includes('backup') ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                        job.name.includes('alert') ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                        job.name.includes('brief') ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                        job.name.includes('scan') ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                        'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
                      }`}>
                        {isLocalAutomation ? 'LOCAL AUTO' :
                         job.name.includes('backup') ? 'BACKUP' :
                         job.name.includes('alert') ? 'ALERT' :
                         job.name.includes('brief') ? 'BRIEF' :
                         job.name.includes('scan') ? 'SCAN' :
                         'TASK'}
                      </span>

                      {job.lastStatus && (
                        <span className={`px-2 py-1 text-xs rounded-full ${getStatusBg(job.lastStatus)} ${getStatusColor(job.lastStatus)}`}>
                          {job.lastStatus}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 font-mono">
                      {job.schedule}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 truncate">
                      {job.command}
                    </div>
                    {job.model && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Model: <span className="font-mono">{job.model}</span>
                      </div>
                    )}
                    {job.lastRun && (
                      <div className="text-xs text-muted-foreground mt-2">
                        Last run: {formatRelativeTime(job.lastRun)}
                      </div>
                    )}
                    {job.nextRun && (
                      <div className="text-xs text-primary/70 mt-1">
                        Next: {formatRelativeTime(job.nextRun, true)}
                      </div>
                    )}
                  </div>
                  <div className="flex space-x-1 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleJob(job)
                      }}
                      disabled={isLocalAutomation}
                      className={`px-2 py-1 text-xs rounded ${
                        job.enabled
                          ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                          : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      } transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {job.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTriggerJob(job)
                      }}
                      className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
                    >
                      Run
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveJob(job)
                      }}
                      disabled={isLocalAutomation}
                      className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
