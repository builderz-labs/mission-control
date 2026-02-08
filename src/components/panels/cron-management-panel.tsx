'use client'

import { useState, useEffect } from 'react'
import { useMissionControl, CronJob } from '@/store'

interface NewJobForm {
  name: string
  schedule: string
  command: string
  description: string
}

export function CronManagementPanel() {
  const { cronJobs, setCronJobs } = useMissionControl()
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null)
  const [jobLogs, setJobLogs] = useState<any[]>([])
  const [newJob, setNewJob] = useState<NewJobForm>({
    name: '',
    schedule: '0 * * * *', // Every hour
    command: '',
    description: ''
  })

  const formatRelativeTime = (timestamp: string | number, future = false) => {
    const now = new Date().getTime()
    const time = new Date(timestamp).getTime()
    const diff = future ? time - now : now - time
    
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    return future ? 'soon' : 'just now'
  }

  useEffect(() => {
    loadCronJobs()
  }, [])

  const loadCronJobs = async () => {
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
  }

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
        body: JSON.stringify({
          action: 'toggle',
          jobName: job.name,
          enabled: !job.enabled
        })
      })

      if (response.ok) {
        await loadCronJobs() // Reload to get updated status
      } else {
        const error = await response.json()
        alert(`Failed to toggle job: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to toggle job:', error)
      alert('Network error occurred')
    }
  }

  const triggerJob = async (job: CronJob) => {
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'trigger',
          command: job.command
        })
      })

      const result = await response.json()
      
      if (result.success) {
        alert(`Job executed successfully:\n${result.stdout}`)
      } else {
        alert(`Job failed:\n${result.error}\n${result.stderr}`)
      }
    } catch (error) {
      console.error('Failed to trigger job:', error)
      alert('Network error occurred')
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
        setNewJob({
          name: '',
          schedule: '0 * * * *',
          command: '',
          description: ''
        })
        setShowAddForm(false)
        await loadCronJobs()
      } else {
        const error = await response.json()
        alert(`Failed to add job: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to add job:', error)
      alert('Network error occurred')
    }
  }

  const removeJob = async (job: CronJob) => {
    if (!confirm(`Are you sure you want to remove the job "${job.name}"?`)) {
      return
    }

    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          jobName: job.name
        })
      })

      if (response.ok) {
        await loadCronJobs()
        if (selectedJob?.name === job.name) {
          setSelectedJob(null)
        }
      } else {
        const error = await response.json()
        alert(`Failed to remove job: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to remove job:', error)
      alert('Network error occurred')
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
      default: return 'bg-gray-500/20'
    }
  }

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

  return (
    <div className="p-6 space-y-6">
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

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Job List */}
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
              {cronJobs.map((job, index) => (
                <div 
                  key={`${job.name}-${index}`} 
                  className={`border border-border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedJob?.name === job.name 
                      ? 'bg-primary/10 border-primary/30' 
                      : 'hover:bg-secondary'
                  }`}
                  onClick={() => handleJobSelect(job)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">{job.name}</span>
                        <div className={`w-2 h-2 rounded-full ${job.enabled ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                        
                        {/* Job Type Tag */}
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
                          job.name.includes('backup') ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                          job.name.includes('alert') ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                          job.name.includes('brief') ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                          job.name.includes('scan') ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                          'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
                        }`}>
                          {job.name.includes('backup') ? 'BACKUP' :
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
                          toggleJob(job)
                        }}
                        className={`px-2 py-1 text-xs rounded ${
                          job.enabled 
                            ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' 
                            : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                        } transition-colors`}
                      >
                        {job.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          triggerJob(job)
                        }}
                        className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
                      >
                        Run
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeJob(job)
                        }}
                        className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Job Details & Logs */}
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
                  <div><span className="text-muted-foreground">Status:</span> {selectedJob.enabled ? '🟢 Enabled' : '🔴 Disabled'}</div>
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
                      {jobLogs.map((log, index) => (
                        <div key={index} className="text-muted-foreground">
                          <span className="text-xs">[{new Date(log.timestamp).toLocaleString()}]</span> {log.message}
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
      </div>

      {/* Add Job Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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