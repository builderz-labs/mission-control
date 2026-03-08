'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl, CronJob } from '@/store'
import { BlockEditor } from '@/components/ui/block-editor'
import { PixelLoader } from '@/components/ui/pixel-loader'

export function CronManagementPanel() {
  const { cronJobs, setCronJobs } = useMissionControl()
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null)
  const [jobLogs, setJobLogs] = useState<any[]>([])
  const [newJob, setNewJob] = useState({
    name: '',
    schedule: '0 * * * *',
    command: '',
    description: ''
  })

  const formatRelativeTime = (timestamp: string | number, future = false) => {
    const now = Date.now()
    const time = new Date(timestamp).getTime()
    const diff = future ? time - now : now - time
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}d ${future ? 'from now' : 'ago'}`
    if (hours > 0) return `${hours}h ${future ? 'from now' : 'ago'}`
    if (minutes > 0) return `${minutes}m ${future ? 'from now' : 'ago'}`
    return future ? 'soon' : 'just now'
  }

  const loadCronJobs = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/cron?action=list')
      const data = await response.json()
      setCronJobs(data.jobs || [])
    } catch (error) {
      console.error('Failed to load cron jobs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [setCronJobs])

  useEffect(() => {
    loadCronJobs()
  }, [loadCronJobs])

  const loadJobLogs = async (jobName: string) => {
    try {
      const response = await fetch(`/api/cron?action=logs&job=${encodeURIComponent(jobName)}`)
      const data = await response.json()
      setJobLogs(data.logs || [])
    } catch (error) {
      console.error('Failed to load job logs:', error)
      setJobLogs([])
    }
  }

  const toggleJob = async (job: CronJob) => {
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', jobName: job.name })
      })
      if (response.ok) {
        await loadCronJobs()
      } else {
        const error = await response.json()
        alert(`Failed to toggle job: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to toggle job:', error)
    }
  }

  const triggerJob = async (job: CronJob) => {
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger', command: job.command })
      })
      const result = await response.json()
      if (result.success) {
        alert(`Job executed successfully:\n${result.stdout}`)
      } else {
        alert(`Job failed:\n${result.error}\n${result.stderr}`)
      }
    } catch (error) {
      console.error('Failed to trigger job:', error)
    }
  }

  const addJob = async () => {
    if (!newJob.name || !newJob.schedule || !newJob.command) {
      alert('Please fill in all required fields')
      return
    }
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          jobName: newJob.name,
          schedule: newJob.schedule,
          command: newJob.command
        })
      })
      if (response.ok) {
        setNewJob({ name: '', schedule: '0 * * * *', command: '', description: '' })
        setShowAddForm(false)
        await loadCronJobs()
      } else {
        const error = await response.json()
        alert(`Failed to add job: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to add job:', error)
    }
  }

  const removeJob = async (job: CronJob) => {
    if (!confirm(`Remove job "${job.name}"?`)) return
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', jobName: job.name })
      })
      if (response.ok) {
        await loadCronJobs()
        if (selectedJob?.name === job.name) setSelectedJob(null)
      } else {
        const error = await response.json()
        alert(`Failed to remove job: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to remove job:', error)
    }
  }

  const handleJobSelect = (job: CronJob) => {
    setSelectedJob(job)
    loadJobLogs(job.name)
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success': return 'text-green-400'
      case 'error': return 'text-red-400'
      case 'running': return 'text-blue-400'
      default: return 'text-muted-foreground'
    }
  }

  const getStatusBg = (status?: string) => {
    switch (status) {
      case 'success': return 'bg-green-500/20'
      case 'error': return 'bg-red-500/20'
      case 'running': return 'bg-blue-500/20'
      default: return 'bg-zinc-500/20'
    }
  }

  const getJobTypeTag = (name: string) => {
    if (name.includes('backup')) return { label: 'BACKUP', classes: 'bg-green-500/20 text-green-400 border-green-500/30' }
    if (name.includes('alert')) return { label: 'ALERT', classes: 'bg-orange-500/20 text-orange-400 border-orange-500/30' }
    if (name.includes('brief')) return { label: 'BRIEF', classes: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
    if (name.includes('scan')) return { label: 'SCAN', classes: 'bg-purple-500/20 text-purple-400 border-purple-500/30' }
    return { label: 'TASK', classes: 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20' }
  }

  // Split jobs: errors first, rest after
  const errorJobs = cronJobs.filter(j => j.lastStatus === 'error')
  const otherJobs = cronJobs.filter(j => j.lastStatus !== 'error')

  const predefinedSchedules = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every 5 minutes', value: '*/5 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Daily at midnight', value: '0 0 * * *' },
    { label: 'Daily at 6 AM', value: '0 6 * * *' },
    { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
    { label: 'Monthly (1st)', value: '0 0 1 * *' },
  ]

  const renderJobCard = (job: CronJob, index: number) => {
    const tag = getJobTypeTag(job.name)
    return (
      <div
        key={`${job.name}-${index}`}
        className="border border-border rounded-lg p-4 cursor-pointer transition-colors hover:bg-secondary"
        onClick={() => handleJobSelect(job)}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{job.name}</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${tag.classes}`}>
                {tag.label}
              </span>
              {job.lastStatus && (
                <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusBg(job.lastStatus)} ${getStatusColor(job.lastStatus)}`}>
                  {job.lastStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground">
              <code className="font-mono text-xs">{job.schedule}</code>
              <span className="truncate max-w-md text-xs">{job.command}</span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              {job.lastRun && <span>Last: {formatRelativeTime(job.lastRun)}</span>}
              {job.nextRun && <span className="text-primary/70">Next: {formatRelativeTime(job.nextRun, true)}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4">
            {/* Toggle switch */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleJob(job) }}
              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                job.enabled ? 'bg-green-500' : 'bg-zinc-600'
              }`}
              title={job.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  job.enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); triggerJob(job) }}
              className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
            >
              Run
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); removeJob(job) }}
              className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cron Management</h1>
            <p className="text-muted-foreground mt-2">
              Manage automated tasks and scheduled jobs
            </p>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={loadCronJobs}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
            >
              Add Job
            </button>
          </div>
        </div>
      </div>

      {/* Full-width job list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <PixelLoader size={24} speed={150} />
          <span className="ml-3 text-muted-foreground">Loading jobs...</span>
        </div>
      ) : cronJobs.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No cron jobs found
        </div>
      ) : (
        <div className="space-y-4">
          {/* Error jobs section */}
          {errorJobs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-red-400 text-sm font-semibold">⚠ Errors</span>
                <span className="text-xs text-red-400/60">{errorJobs.length} job{errorJobs.length > 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2 border border-red-500/20 rounded-lg p-3 bg-red-500/5">
                {errorJobs.map((job, i) => renderJobCard(job, i))}
              </div>
            </div>
          )}

          {/* Separator if both sections exist */}
          {errorJobs.length > 0 && otherJobs.length > 0 && (
            <div className="border-t border-border" />
          )}

          {/* Normal jobs */}
          {otherJobs.length > 0 && (
            <div className="space-y-2">
              {otherJobs.map((job, i) => renderJobCard(job, i + errorJobs.length))}
            </div>
          )}
        </div>
      )}

      {/* Job Detail Modal */}
      {selectedJob && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedJob(null) }}
        >
          <div className="bg-card border border-border rounded-lg w-full max-w-3xl m-4 max-h-[85vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-foreground">{selectedJob.name}</h2>
                <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusBg(selectedJob.lastStatus)} ${getStatusColor(selectedJob.lastStatus)}`}>
                  {selectedJob.lastStatus || 'unknown'}
                </span>
                <span className={`inline-flex h-5 w-10 items-center rounded-full ${
                  selectedJob.enabled ? 'bg-green-500' : 'bg-zinc-600'
                }`}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                    selectedJob.enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </span>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Configuration */}
              <div>
                <h3 className="font-medium text-foreground mb-3">Configuration</h3>
                <div className="bg-secondary rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20">Schedule</span>
                    <code className="font-mono text-foreground">{selectedJob.schedule}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20">Status</span>
                    <span>{selectedJob.enabled ? '🟢 Enabled' : '🔴 Disabled'}</span>
                  </div>
                  {selectedJob.nextRun && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-20">Next run</span>
                      <span>{new Date(selectedJob.nextRun).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedJob.lastRun && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-20">Last run</span>
                      <span>{new Date(selectedJob.lastRun).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedJob.lastError && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground w-20">Error</span>
                      <span className="text-red-400 text-xs">{selectedJob.lastError}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Command (BlockNote editor) */}
              <div>
                <h3 className="font-medium text-foreground mb-3">Command / Payload</h3>
                <div className="bg-secondary rounded-lg border border-border overflow-hidden">
                  <BlockEditor
                    initialMarkdown={selectedJob.command}
                    editable={true}
                    compact={true}
                    onBlur={async (md) => {
                      // Future: save via API
                      // await fetch('/api/cron', { method: 'POST', body: JSON.stringify({ action: 'update-command', jobId: selectedJob.name, command: md }) })
                    }}
                    placeholder="Job command / payload message..."
                  />
                </div>
              </div>

              {/* Recent Logs */}
              <div>
                <h3 className="font-medium text-foreground mb-3">Recent Logs</h3>
                <div className="bg-secondary rounded-lg p-4 max-h-48 overflow-y-auto">
                  {jobLogs.length === 0 ? (
                    <div className="text-muted-foreground text-sm">No logs available</div>
                  ) : (
                    <div className="space-y-1 text-xs font-mono">
                      {jobLogs.map((log, index) => (
                        <div key={index} className={log.level === 'error' ? 'text-red-400' : 'text-muted-foreground'}>
                          <span className="opacity-60">[{new Date(log.timestamp).toLocaleString()}]</span> {log.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between p-4 border-t border-border">
              <div className="flex gap-2">
                <button
                  onClick={() => triggerJob(selectedJob)}
                  className="px-3 py-1.5 text-sm bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
                >
                  Run Now
                </button>
                <button
                  onClick={() => {
                    toggleJob(selectedJob)
                    // Update local state optimistically
                    setSelectedJob({ ...selectedJob, enabled: !selectedJob.enabled })
                  }}
                  className="px-3 py-1.5 text-sm bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded transition-colors"
                >
                  {selectedJob.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Job Modal */}
      {showAddForm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddForm(false) }}
        >
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl m-4">
            <h2 className="text-xl font-semibold mb-4">Add New Cron Job</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Job Name</label>
                <input
                  type="text"
                  value={newJob.name}
                  onChange={(e) => setNewJob(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., daily-backup, system-check"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Schedule (Cron Format)</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newJob.schedule}
                    onChange={(e) => setNewJob(prev => ({ ...prev, schedule: e.target.value }))}
                    placeholder="0 * * * *"
                    className="flex-1 px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono"
                  />
                  <select
                    value=""
                    onChange={(e) => e.target.value && setNewJob(prev => ({ ...prev, schedule: e.target.value }))}
                    className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  >
                    <option value="">Quick select...</option>
                    {predefinedSchedules.map((sched) => (
                      <option key={sched.value} value={sched.value}>{sched.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Format: minute hour day month dayOfWeek
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Command</label>
                <textarea
                  value={newJob.command}
                  onChange={(e) => setNewJob(prev => ({ ...prev, command: e.target.value }))}
                  placeholder="cd /path/to/script && ./script.sh"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono h-24"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description (Optional)</label>
                <input
                  type="text"
                  value={newJob.description}
                  onChange={(e) => setNewJob(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What does this job do?"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addJob}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
              >
                Add Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
