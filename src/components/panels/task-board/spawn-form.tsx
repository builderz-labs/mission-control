'use client'

import { Button } from '@/components/ui/button'
import type { SpawnFormData } from './task-board-types'

interface SpawnRequest {
  id: string
  label: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  model: string
}

interface SpawnFormProps {
  formData: SpawnFormData
  onFormChange: (next: SpawnFormData) => void
  onSpawn: () => void
  isSpawning: boolean
  availableModels: { alias: string }[]
  spawnRequests: SpawnRequest[]
}

function requestStatusClass(status: SpawnRequest['status']): string {
  if (status === 'pending') return 'bg-yellow-500/20 text-yellow-400'
  if (status === 'running') return 'bg-blue-500/20 text-blue-400'
  if (status === 'completed') return 'bg-green-500/20 text-green-400'
  return 'bg-red-500/20 text-red-400'
}

/** Collapsible form for spawning a Claude Code sub-agent with a task. */
export function SpawnForm({
  formData,
  onFormChange,
  onSpawn,
  isSpawning,
  availableModels,
  spawnRequests,
}: SpawnFormProps) {
  return (
    <div className="border-b border-border bg-surface-0 p-4">
      <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
        <div className="space-y-3">
          <textarea
            value={formData.task}
            onChange={(e) => onFormChange({ ...formData, task: e.target.value })}
            placeholder="Task description for the sub-agent..."
            className="w-full h-20 px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            disabled={isSpawning}
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={formData.label}
              onChange={(e) => onFormChange({ ...formData, label: e.target.value })}
              placeholder="Sub-agent label (e.g. builder)"
              className="flex-1 px-3 py-1.5 border border-border rounded-md bg-background text-foreground text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              disabled={isSpawning}
            />
            <select
              value={formData.model}
              onChange={(e) => onFormChange({ ...formData, model: e.target.value })}
              className="px-3 py-1.5 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              disabled={isSpawning}
            >
              {availableModels.map((model) => (
                <option key={model.alias} value={model.alias}>{model.alias}</option>
              ))}
            </select>
            <input
              type="number"
              min="10"
              max="3600"
              value={formData.timeoutSeconds}
              onChange={(e) =>
                onFormChange({ ...formData, timeoutSeconds: parseInt(e.target.value) || 300 })
              }
              className="w-20 px-2 py-1.5 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              title="Timeout (seconds)"
              disabled={isSpawning}
            />
            <Button
              onClick={onSpawn}
              disabled={isSpawning || !formData.task.trim() || !formData.label.trim()}
              size="sm"
            >
              {isSpawning ? 'Spawning...' : 'Spawn'}
            </Button>
          </div>
        </div>

        {/* Active spawn requests */}
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {spawnRequests.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No active sub-agent requests
            </div>
          ) : (
            spawnRequests.slice(0, 5).map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between px-3 py-2 border border-border rounded-md text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-foreground truncate">{request.label}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${requestStatusClass(request.status)}`}>
                    {request.status}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{request.model}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
