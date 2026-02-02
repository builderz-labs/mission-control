'use client'

import { useState, useEffect } from 'react'
import { useMissionControl } from '@/store'

interface SpawnFormData {
  task: string
  model: string
  label: string
  timeoutSeconds: number
}

export function AgentSpawnPanel() {
  const { 
    availableModels, 
    spawnRequests, 
    addSpawnRequest, 
    updateSpawnRequest 
  } = useMissionControl()

  const [formData, setFormData] = useState<SpawnFormData>({
    task: '',
    model: 'sonnet',
    label: '',
    timeoutSeconds: 300
  })

  const [isSpawning, setIsSpawning] = useState(false)
  const [spawnHistory, setSpawnHistory] = useState<any[]>([])

  useEffect(() => {
    // Load spawn history on mount
    fetch('/api/spawn')
      .then(res => res.json())
      .then(data => setSpawnHistory(data.history || []))
      .catch(err => console.error('Failed to load spawn history:', err))
  }, [])

  const handleSpawn = async () => {
    if (!formData.task.trim() || !formData.label.trim()) {
      alert('Please fill in task and label fields')
      return
    }

    setIsSpawning(true)

    const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Add to store immediately
    addSpawnRequest({
      id: spawnId,
      task: formData.task,
      model: formData.model,
      label: formData.label,
      timeoutSeconds: formData.timeoutSeconds,
      status: 'pending',
      createdAt: Date.now()
    })

    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const result = await response.json()

      if (result.success) {
        // Update the spawn request with success
        updateSpawnRequest(spawnId, {
          status: 'running',
          result: result.sessionInfo || 'Agent spawned successfully'
        })

        // Clear form
        setFormData({
          task: '',
          model: 'sonnet',
          label: '',
          timeoutSeconds: 300
        })

        // Refresh history
        const historyResponse = await fetch('/api/spawn')
        const historyData = await historyResponse.json()
        setSpawnHistory(historyData.history || [])
      } else {
        // Update with error
        updateSpawnRequest(spawnId, {
          status: 'failed',
          error: result.error || 'Unknown error'
        })
      }
    } catch (error) {
      console.error('Spawn error:', error)
      updateSpawnRequest(spawnId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Network error'
      })
    } finally {
      setIsSpawning(false)
    }
  }

  const selectedModel = availableModels.find(m => m.alias === formData.model)

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">Agent Spawn Control</h1>
        <p className="text-muted-foreground mt-2">
          Launch new sub-agents for specific tasks with custom parameters
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Spawn Form */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Spawn New Agent</h2>
          
          <div className="space-y-4">
            {/* Task Input */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Task Description
              </label>
              <textarea
                value={formData.task}
                onChange={(e) => setFormData(prev => ({ ...prev, task: e.target.value }))}
                placeholder="Describe the task for the agent to execute..."
                className="w-full h-24 px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                disabled={isSpawning}
              />
            </div>

            {/* Model Selector */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Model
              </label>
              <select
                value={formData.model}
                onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                disabled={isSpawning}
              >
                {availableModels.map((model) => (
                  <option key={model.alias} value={model.alias}>
                    {model.alias} - {model.description}
                  </option>
                ))}
              </select>
              {selectedModel && (
                <div className="mt-2 text-sm text-muted-foreground">
                  <div>Provider: {selectedModel.provider}</div>
                  <div>Cost: ${selectedModel.costPer1k}/1k tokens</div>
                </div>
              )}
            </div>

            {/* Label Input */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Agent Label
              </label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
                placeholder="e.g., builder, analyzer, researcher"
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                disabled={isSpawning}
              />
            </div>

            {/* Timeout Setting */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Timeout (seconds)
              </label>
              <input
                type="number"
                min="10"
                max="3600"
                value={formData.timeoutSeconds}
                onChange={(e) => setFormData(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) || 300 }))}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                disabled={isSpawning}
              />
              <div className="mt-1 text-sm text-muted-foreground">
                {Math.floor(formData.timeoutSeconds / 60)} minutes, {formData.timeoutSeconds % 60} seconds
              </div>
            </div>

            {/* Spawn Button */}
            <button
              onClick={handleSpawn}
              disabled={isSpawning || !formData.task.trim() || !formData.label.trim()}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSpawning ? 'Spawning Agent...' : 'Spawn Agent'}
            </button>
          </div>
        </div>

        {/* Active Spawn Requests */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Active Requests</h2>
          
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {spawnRequests.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No active spawn requests
              </div>
            ) : (
              spawnRequests.slice(0, 10).map((request) => (
                <div key={request.id} className="border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">{request.label}</span>
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          request.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                          request.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                          request.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {request.status}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Model: {request.model} • Timeout: {request.timeoutSeconds}s
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 truncate">
                        {request.task}
                      </div>
                      {request.error && (
                        <div className="text-sm text-red-400 mt-2">
                          Error: {request.error}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground ml-4">
                      {new Date(request.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Spawn History */}
      {spawnHistory.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Recent Spawn History</h2>
          
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {spawnHistory.map((item, index) => (
              <div key={index} className="flex items-center justify-between p-3 border border-border rounded">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {item.model} - {item.task.substring(0, 50)}
                    {item.task.length > 50 && '...'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(item.timestamp).toLocaleString()}
                  </div>
                </div>
                <div className="text-xs text-green-400 ml-4">
                  {item.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}