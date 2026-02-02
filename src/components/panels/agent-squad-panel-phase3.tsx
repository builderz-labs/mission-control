'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  OverviewTab, 
  SoulTab, 
  MemoryTab, 
  TasksTab, 
  ActivityTab, 
  CreateAgentModal 
} from './agent-detail-tabs'

interface Agent {
  id: number
  name: string
  role: string
  session_key?: string
  soul_content?: string
  working_memory?: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_seen?: number
  last_activity?: string
  created_at: number
  updated_at: number
  config?: any
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
}

interface WorkItem {
  type: string
  count: number
  items: any[]
}

interface HeartbeatResponse {
  status: 'HEARTBEAT_OK' | 'WORK_ITEMS_FOUND'
  agent: string
  checked_at: number
  work_items?: WorkItem[]
  total_items?: number
  message?: string
}

interface SoulTemplate {
  name: string
  description: string
  size: number
}

const statusColors: Record<string, string> = {
  offline: 'bg-gray-500',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
}

const statusIcons: Record<string, string> = {
  offline: '⚫',
  idle: '🟢',
  busy: '🟡',
  error: '🔴',
}

export function AgentSquadPanelPhase3() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showQuickSpawnModal, setShowQuickSpawnModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setError(null)
      if (agents.length === 0) setLoading(true)

      const response = await fetch('/api/agents')
      if (!response.ok) throw new Error('Failed to fetch agents')

      const data = await response.json()
      setAgents(data.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [agents.length])

  // Initial load
  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(fetchAgents, 10000) // Every 10 seconds
    return () => clearInterval(interval)
  }, [autoRefresh, fetchAgents])

  // Update agent status
  const updateAgentStatus = async (agentName: string, status: Agent['status'], activity?: string) => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          status,
          last_activity: activity || `Status changed to ${status}`
        })
      })

      if (!response.ok) throw new Error('Failed to update agent status')
      
      // Update local state
      setAgents(prev => prev.map(agent => 
        agent.name === agentName 
          ? { 
              ...agent, 
              status, 
              last_activity: activity || `Status changed to ${status}`,
              last_seen: Math.floor(Date.now() / 1000),
              updated_at: Math.floor(Date.now() / 1000)
            }
          : agent
      ))
    } catch (error) {
      console.error('Failed to update agent status:', error)
      setError('Failed to update agent status')
    }
  }

  // Wake agent via session_send
  const wakeAgent = async (agentName: string, sessionKey: string) => {
    try {
      // This would need OpenClaw gateway integration
      const wakeMessage = `🤖 **Wake Up Call**\n\nAgent ${agentName}, you have been manually woken up.\nCheck Mission Control for any pending tasks or notifications.\n\n⏰ ${new Date().toLocaleString()}`
      
      // For now, just update status to show wake attempt
      await updateAgentStatus(agentName, 'idle', 'Manually woken via session')
      
      // TODO: Implement actual session_send call when OpenClaw WebSocket is available
      console.log(`Would send wake message to session ${sessionKey}:`, wakeMessage)
    } catch (error) {
      console.error('Failed to wake agent:', error)
      setError('Failed to wake agent')
    }
  }

  // Format last seen time
  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return 'Never'
    
    const now = Date.now()
    const diffMs = now - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // Check if agent had recent heartbeat (within 30 minutes)
  const hasRecentHeartbeat = (agent: Agent) => {
    if (!agent.last_seen) return false
    const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - (30 * 60)
    return agent.last_seen > thirtyMinutesAgo
  }

  // Get status distribution for summary
  const statusCounts = agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-2 text-gray-400">Loading agents...</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">Agent Squad</h2>
          
          {/* Status Summary */}
          <div className="flex gap-2 text-sm">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${statusColors[status]}`}></div>
                <span className="text-gray-400">{count}</span>
              </div>
            ))}
          </div>

          {/* Active Heartbeats Indicator */}
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
            <span className="text-sm text-gray-400">
              {agents.filter(hasRecentHeartbeat).length} active heartbeats
            </span>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              autoRefresh 
                ? 'bg-green-600 text-white hover:bg-green-700' 
                : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
          >
            {autoRefresh ? 'Live' : 'Manual'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            + Add Agent
          </button>
          <button
            onClick={fetchAgents}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-3 m-4 rounded">
          {error}
          <button
            onClick={() => setError(null)}
            className="float-right text-red-300 hover:text-red-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">🤖</div>
            <p>No agents found</p>
            <p className="text-sm">Add your first agent to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(agent => (
              <div
                key={agent.id}
                className={`bg-gray-800 rounded-lg p-4 border-l-4 hover:bg-gray-750 transition-colors cursor-pointer ${
                  hasRecentHeartbeat(agent) ? 'border-cyan-400' : 'border-gray-600'
                }`}
                onClick={() => setSelectedAgent(agent)}
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white text-lg">{agent.name}</h3>
                    <p className="text-gray-400 text-sm">{agent.role}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {/* Heartbeat indicator */}
                    {hasRecentHeartbeat(agent) && (
                      <div className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse" title="Recent heartbeat"></div>
                    )}
                    <div className={`w-3 h-3 rounded-full ${statusColors[agent.status]} animate-pulse`}></div>
                    <span className="text-xs text-gray-400">{agent.status}</span>
                  </div>
                </div>

                {/* Session Info */}
                <div className="text-xs text-gray-400 mb-2">
                  <div className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">Session:</span> {agent.session_key || 'Not set'}
                    </span>
                    {agent.session_key && (
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-green-400"></div>
                        <span>Active</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Task Stats */}
                {agent.taskStats && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-white">{agent.taskStats.total}</div>
                      <div className="text-xs text-gray-400">Total Tasks</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                      <div className="text-xs text-gray-400">In Progress</div>
                    </div>
                  </div>
                )}

                {/* Last Activity */}
                <div className="text-xs text-gray-400 mb-3">
                  <div>
                    <span className="font-medium">Last seen:</span> {formatLastSeen(agent.last_seen)}
                  </div>
                  {agent.last_activity && (
                    <div className="mt-1 truncate" title={agent.last_activity}>
                      <span className="font-medium">Activity:</span> {agent.last_activity}
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <div className="flex gap-1">
                  {agent.session_key ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        wakeAgent(agent.name, agent.session_key!)
                      }}
                      className="flex-1 px-2 py-1 text-xs bg-cyan-600 text-white rounded hover:bg-cyan-700 transition-colors"
                      title="Wake agent via session"
                    >
                      Wake Agent
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        updateAgentStatus(agent.name, 'idle', 'Manually activated')
                      }}
                      disabled={agent.status === 'idle'}
                      className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Wake
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      updateAgentStatus(agent.name, 'busy', 'Manually set to busy')
                    }}
                    disabled={agent.status === 'busy'}
                    className="flex-1 px-2 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Busy
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedAgent(agent)
                      setShowQuickSpawnModal(true)
                    }}
                    className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Spawn
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModalPhase3
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={fetchAgents}
          onStatusUpdate={updateAgentStatus}
          onWakeAgent={wakeAgent}
        />
      )}

      {/* Create Agent Modal */}
      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchAgents}
        />
      )}

      {/* Quick Spawn Modal */}
      {showQuickSpawnModal && selectedAgent && (
        <QuickSpawnModal
          agent={selectedAgent}
          onClose={() => {
            setShowQuickSpawnModal(false)
            setSelectedAgent(null)
          }}
          onSpawned={fetchAgents}
        />
      )}
    </div>
  )
}

// Enhanced Agent Detail Modal with Tabs
function AgentDetailModalPhase3({
  agent,
  onClose,
  onUpdate,
  onStatusUpdate,
  onWakeAgent
}: {
  agent: Agent
  onClose: () => void
  onUpdate: () => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'soul' | 'memory' | 'tasks' | 'activity'>('overview')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    role: agent.role,
    session_key: agent.session_key || '',
    soul_content: agent.soul_content || '',
    working_memory: agent.working_memory || ''
  })
  const [soulTemplates, setSoulTemplates] = useState<SoulTemplate[]>([])
  const [heartbeatData, setHeartbeatData] = useState<HeartbeatResponse | null>(null)
  const [loadingHeartbeat, setLoadingHeartbeat] = useState(false)

  // Load SOUL templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/soul`, {
          method: 'PATCH'
        })
        if (response.ok) {
          const data = await response.json()
          setSoulTemplates(data.templates || [])
        }
      } catch (error) {
        console.error('Failed to load SOUL templates:', error)
      }
    }
    
    if (activeTab === 'soul') {
      loadTemplates()
    }
  }, [activeTab, agent.name])

  // Perform heartbeat check
  const performHeartbeat = async () => {
    setLoadingHeartbeat(true)
    try {
      const response = await fetch(`/api/agents/${agent.name}/heartbeat`)
      if (response.ok) {
        const data = await response.json()
        setHeartbeatData(data)
      }
    } catch (error) {
      console.error('Failed to perform heartbeat:', error)
    } finally {
      setLoadingHeartbeat(false)
    }
  }

  const handleSave = async () => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agent.name,
          ...formData
        })
      })

      if (!response.ok) throw new Error('Failed to update agent')
      
      setEditing(false)
      onUpdate()
    } catch (error) {
      console.error('Failed to update agent:', error)
    }
  }

  const handleSoulSave = async (content: string, templateName?: string) => {
    try {
      const response = await fetch(`/api/agents/${agent.name}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soul_content: content,
          template_name: templateName
        })
      })

      if (!response.ok) throw new Error('Failed to update SOUL')
      
      setFormData(prev => ({ ...prev, soul_content: content }))
      onUpdate()
    } catch (error) {
      console.error('Failed to update SOUL:', error)
    }
  }

  const handleMemorySave = async (content: string, append: boolean = false) => {
    try {
      const response = await fetch(`/api/agents/${agent.name}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          working_memory: content,
          append
        })
      })

      if (!response.ok) throw new Error('Failed to update memory')
      
      const data = await response.json()
      setFormData(prev => ({ ...prev, working_memory: data.working_memory }))
      onUpdate()
    } catch (error) {
      console.error('Failed to update memory:', error)
    }
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📋' },
    { id: 'soul', label: 'SOUL', icon: '🧠' },
    { id: 'memory', label: 'Memory', icon: '📝' },
    { id: 'tasks', label: 'Tasks', icon: '✅' },
    { id: 'activity', label: 'Activity', icon: '📊' }
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-xl font-bold text-white">{agent.name}</h3>
              <p className="text-gray-400">{agent.role}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${statusColors[agent.status]}`}></div>
              <span className="text-white">{agent.status}</span>
              <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 mt-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'overview' && (
            <OverviewTab
              agent={agent}
              editing={editing}
              formData={formData}
              setFormData={setFormData}
              onSave={handleSave}
              onStatusUpdate={onStatusUpdate}
              onWakeAgent={onWakeAgent}
              onEdit={() => setEditing(true)}
              onCancel={() => setEditing(false)}
              heartbeatData={heartbeatData}
              loadingHeartbeat={loadingHeartbeat}
              onPerformHeartbeat={performHeartbeat}
            />
          )}
          
          {activeTab === 'soul' && (
            <SoulTab
              agent={agent}
              soulContent={formData.soul_content}
              templates={soulTemplates}
              onSave={handleSoulSave}
            />
          )}
          
          {activeTab === 'memory' && (
            <MemoryTab
              agent={agent}
              workingMemory={formData.working_memory}
              onSave={handleMemorySave}
            />
          )}
          
          {activeTab === 'tasks' && (
            <TasksTab agent={agent} />
          )}
          
          {activeTab === 'activity' && (
            <ActivityTab agent={agent} />
          )}
        </div>
      </div>
    </div>
  )
}

// Quick Spawn Modal Component
function QuickSpawnModal({
  agent,
  onClose,
  onSpawned
}: {
  agent: Agent
  onClose: () => void
  onSpawned: () => void
}) {
  const [spawnData, setSpawnData] = useState({
    task: '',
    model: 'sonnet',
    label: `${agent.name}-subtask-${Date.now()}`,
    timeoutSeconds: 300
  })
  const [isSpawning, setIsSpawning] = useState(false)
  const [spawnResult, setSpawnResult] = useState<any>(null)

  const models = [
    { id: 'haiku', name: 'Claude Haiku', cost: '$0.25/1K', speed: 'Ultra Fast' },
    { id: 'sonnet', name: 'Claude Sonnet', cost: '$3.00/1K', speed: 'Fast' },
    { id: 'opus', name: 'Claude Opus', cost: '$15.00/1K', speed: 'Slow' },
    { id: 'groq-fast', name: 'Groq Llama 8B', cost: '$0.05/1K', speed: '840 tok/s' },
    { id: 'groq', name: 'Groq Llama 70B', cost: '$0.59/1K', speed: '150 tok/s' },
    { id: 'deepseek', name: 'DeepSeek R1', cost: 'FREE', speed: 'Local' },
  ]

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
          sessionKey: agent.session_key
        })
      })

      const result = await response.json()
      if (response.ok) {
        setSpawnResult(result)
        onSpawned()
        
        // Auto-close after 2 seconds if successful
        setTimeout(() => {
          onClose()
        }, 2000)
      } else {
        alert(result.error || 'Failed to spawn agent')
      }
    } catch (error) {
      console.error('Spawn failed:', error)
      alert('Network error occurred')
    } finally {
      setIsSpawning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">
            Quick Spawn for {agent.name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        {spawnResult ? (
          <div className="space-y-4">
            <div className="bg-green-900/30 border border-green-600 text-green-400 p-3 rounded">
              ✅ Agent spawned successfully!
            </div>
            <div className="text-sm text-gray-300">
              <p><strong>Agent ID:</strong> {spawnResult.agentId}</p>
              <p><strong>Session:</strong> {spawnResult.sessionId}</p>
              <p><strong>Model:</strong> {spawnResult.model}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Task Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Task Description *
              </label>
              <textarea
                value={spawnData.task}
                onChange={(e) => setSpawnData(prev => ({ ...prev, task: e.target.value }))}
                placeholder={`Delegate a subtask to ${agent.name}...`}
                className="w-full h-24 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:border-blue-500 resize-none"
              />
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Model
              </label>
              <select
                value={spawnData.model}
                onChange={(e) => setSpawnData(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-blue-500"
              >
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.cost} ({model.speed})
                  </option>
                ))}
              </select>
            </div>

            {/* Agent Label */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Agent Label
              </label>
              <input
                type="text"
                value={spawnData.label}
                onChange={(e) => setSpawnData(prev => ({ ...prev, label: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-blue-500"
              />
            </div>

            {/* Timeout */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={spawnData.timeoutSeconds}
                onChange={(e) => setSpawnData(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) }))}
                min={30}
                max={3600}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-blue-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSpawn}
                disabled={isSpawning || !spawnData.task.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSpawning ? 'Spawning...' : '🚀 Spawn Agent'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentSquadPanelPhase3