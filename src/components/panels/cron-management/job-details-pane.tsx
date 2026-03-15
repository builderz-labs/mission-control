'use client'

import type { CronJob } from '@/store'

interface JobDetailsPaneProps {
  selectedJob: CronJob | null
  jobLogs: any[]
}

export function JobDetailsPane({ selectedJob, jobLogs }: JobDetailsPaneProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">
        {selectedJob ? `Job Details: ${selectedJob.name}` : 'Job Details'}
      </h2>

      {selectedJob ? (
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-foreground mb-2">Configuration</h3>
            <div className="bg-secondary rounded p-3 space-y-2 text-sm">
              <div><span className="text-muted-foreground">Schedule:</span> <code className="font-mono">{selectedJob.schedule}</code></div>
              <div><span className="text-muted-foreground">Command:</span> <code className="font-mono text-xs">{selectedJob.command}</code></div>
              {selectedJob.model && (
                <div><span className="text-muted-foreground">Model:</span> <code className="font-mono text-xs">{selectedJob.model}</code></div>
              )}
              <div><span className="text-muted-foreground">Status:</span> {selectedJob.enabled ? '\uD83D\uDFE2 Enabled' : '\uD83D\uDD34 Disabled'}</div>
              {selectedJob.delivery === 'local' && selectedJob.agentId === 'mission-control-local' && (
                <div><span className="text-muted-foreground">Source:</span> Local scheduler automation</div>
              )}
              {selectedJob.nextRun && (
                <div><span className="text-muted-foreground">Next run:</span> {new Date(selectedJob.nextRun).toLocaleString()}</div>
              )}
            </div>
          </div>

          <div>
            <h3 className="font-medium text-foreground mb-2">Recent Logs</h3>
            <div className="bg-secondary rounded p-3 max-h-64 overflow-y-auto">
              {jobLogs.length === 0 ? (
                <div className="text-muted-foreground text-sm">No logs available</div>
              ) : (
                <div className="space-y-1 text-xs font-mono">
                  {jobLogs.map((logEntry, index) => (
                    <div key={index} className="text-muted-foreground">
                      <span className="text-xs">[{new Date(logEntry.timestamp).toLocaleString()}]</span> {logEntry.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-8">
          Select a job to view details and logs
        </div>
      )}
    </div>
  )
}
