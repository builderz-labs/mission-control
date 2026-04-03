'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClientLogger } from '@/lib/client-logger'
import type { Agent } from './agent-squad-types'

const log = createClientLogger('QuickSpawnModal')

const SPAWN_MODELS = [
  { id: 'haiku',      name: 'Claude Haiku',    cost: '$0.25/1K',  speed: 'Ultra Fast' },
  { id: 'sonnet',     name: 'Claude Sonnet',   cost: '$3.00/1K',  speed: 'Fast' },
  { id: 'opus',       name: 'Claude Opus',     cost: '$15.00/1K', speed: 'Slow' },
  { id: 'groq-fast',  name: 'Groq Llama 8B',  cost: '$0.05/1K',  speed: '840 tok/s' },
  { id: 'groq',       name: 'Groq Llama 70B', cost: '$0.59/1K',  speed: '150 tok/s' },
  { id: 'deepseek',   name: 'DeepSeek R1',    cost: 'FREE',      speed: 'Local' },
]

interface QuickSpawnModalProps {
  agent: Agent
  onClose: () => void
  onSpawned: () => void
}

export function QuickSpawnModal({ agent, onClose, onSpawned }: QuickSpawnModalProps) {
  const [spawnData, setSpawnData] = useState({
    task: '',
    model: 'sonnet',
    label: `${agent.name}-subtask-${Date.now()}`,
    timeoutSeconds: 300,
  })
  const [isSpawning, setIsSpawning] = useState(false)
  const [spawnResult, setSpawnResult] = useState<any>(null)

  const handleSpawn = async () => {
    if (!spawnData.task.trim()) {
      alert('Please enter a task description')
      return
    }

    setIsSpawning(true)
    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...spawnData,
          parentAgent: agent.name,
          sessionKey: agent.session_key,
        }),
        signal: AbortSignal.timeout(8000),
      })

      const result = await response.json()
      if (response.ok) {
        setSpawnResult(result)
        onSpawned()
        // Auto-close after success
        setTimeout(() => onClose(), 2000)
      } else {
        alert(result.error || 'Failed to spawn agent')
      }
    } catch (error) {
      log.error('Spawn failed:', error)
      alert('Network error occurred')
    } finally {
      setIsSpawning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-foreground">
            Quick Spawn for {agent.name}
          </h3>
          <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">×</Button>
        </div>

        {spawnResult ? (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-3 rounded-lg text-sm">
              Agent spawned successfully!
            </div>
            <div className="text-sm text-foreground/80">
              <p><strong>Agent ID:</strong> {spawnResult.agentId}</p>
              <p><strong>Session:</strong> {spawnResult.sessionId}</p>
              <p><strong>Model:</strong> {spawnResult.model}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Task Description *
              </label>
              <textarea
                value={spawnData.task}
                onChange={(e) => setSpawnData(prev => ({ ...prev, task: e.target.value }))}
                placeholder={`Delegate a subtask to ${agent.name}...`}
                className="w-full h-24 px-3 py-2 bg-surface-1 border border-border rounded text-foreground placeholder-muted-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Model</label>
              <select
                value={spawnData.model}
                onChange={(e) => setSpawnData(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              >
                {SPAWN_MODELS.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.cost} ({model.speed})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Agent Label</label>
              <input
                type="text"
                value={spawnData.label}
                onChange={(e) => setSpawnData(prev => ({ ...prev, label: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Timeout (seconds)</label>
              <input
                type="number"
                value={spawnData.timeoutSeconds}
                onChange={(e) => setSpawnData(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) }))}
                min={30}
                max={3600}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleSpawn}
                disabled={isSpawning || !spawnData.task.trim()}
                className="flex-1"
              >
                {isSpawning ? 'Spawning...' : 'Spawn Agent'}
              </Button>
              <Button onClick={onClose} variant="secondary">Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
