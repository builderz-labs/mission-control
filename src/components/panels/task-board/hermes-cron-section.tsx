'use client'

import { useState, useEffect } from 'react'

/** Displays Hermes scheduled tasks from ~/.hermes/cron/jobs.json. */
export function HermesCronSection() {
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<{ cronJobs: any[] }>({ cronJobs: [] })
  const [loaded, setLoaded] = useState(false)

  // Lazy-load on first expand
  useEffect(() => {
    if (!expanded || loaded) return
    fetch('/api/hermes/tasks')
      .then(r => r.json())
      .then(d => { setData(d); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [expanded, loaded])

  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Hermes Scheduled Tasks</span>
          {data.cronJobs.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
              {data.cronJobs.length}
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>

      {expanded && (
        <div className="p-4 border-t border-border space-y-2">
          {!loaded ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : data.cronJobs.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              <p className="font-medium">No scheduled tasks found</p>
              <p className="text-xs mt-1 text-muted-foreground/70">
                Cron jobs appear here when configured in ~/.hermes/cron/jobs.json
              </p>
            </div>
          ) : (
            data.cronJobs.map((job: any) => (
              <div
                key={job.id}
                className="flex items-center gap-3 px-3 py-2 rounded bg-surface-1 border border-border text-sm"
              >
                <span
                  className={`text-[10px] font-mono shrink-0 ${
                    job.enabled ? 'text-purple-400' : 'text-muted-foreground/50'
                  }`}
                >
                  {job.schedule || 'no schedule'}
                </span>
                <span className="text-foreground flex-1 truncate">{job.prompt || job.id}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    job.enabled
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {job.enabled ? 'enabled' : 'disabled'}
                </span>
                {job.lastRunAt && (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">
                    {job.lastRunAt}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
