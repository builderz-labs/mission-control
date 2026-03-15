'use client'

import type { NewJobForm } from './types'
import { predefinedSchedules } from './types'

interface CreateJobModalProps {
  show: boolean
  newJob: NewJobForm
  availableModels: string[]
  onNewJobChange: (updater: (prev: NewJobForm) => NewJobForm) => void
  onAddJob: () => void
  onClose: () => void
}

export function CreateJobModal({
  show,
  newJob,
  availableModels,
  onNewJobChange,
  onAddJob,
  onClose,
}: CreateJobModalProps) {
  if (!show) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl m-4">
        <h2 className="text-xl font-semibold mb-4">Add New Cron Job</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Job Name</label>
            <input
              type="text"
              value={newJob.name}
              onChange={(e) => onNewJobChange(prev => ({ ...prev, name: e.target.value }))}
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
                onChange={(e) => onNewJobChange(prev => ({ ...prev, schedule: e.target.value }))}
                placeholder="0 * * * *"
                className="flex-1 px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono"
              />
              <select
                value=""
                onChange={(e) => e.target.value && onNewJobChange(prev => ({ ...prev, schedule: e.target.value }))}
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
              onChange={(e) => onNewJobChange(prev => ({ ...prev, command: e.target.value }))}
              placeholder="cd /path/to/script && ./script.sh"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono h-24"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Model (Optional)</label>
            <input
              type="text"
              value={newJob.model}
              onChange={(e) => onNewJobChange(prev => ({ ...prev, model: e.target.value }))}
              list="cron-model-suggestions"
              placeholder="anthropic/claude-sonnet-4-20250514"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
            />
            <datalist id="cron-model-suggestions">
              {availableModels.map((modelName) => (
                <option key={modelName} value={modelName} />
              ))}
            </datalist>
            <div className="mt-1 text-xs text-muted-foreground">
              Leave empty to use the agent or gateway default model.
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Description (Optional)</label>
            <input
              type="text"
              value={newJob.description}
              onChange={(e) => onNewJobChange(prev => ({ ...prev, description: e.target.value }))}
              placeholder="What does this job do?"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onAddJob}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
          >
            Add Job
          </button>
        </div>
      </div>
    </div>
  )
}
