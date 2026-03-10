'use client'

import { useState, useEffect, useCallback } from 'react'
import { AGENT_TEMPLATES } from '@/lib/agent-templates'

interface Agent {
  id: number
  name: string
  role: string
  session_key?: string
  soul_content?: string
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

const PROVIDER_OPTIONS = [
  { value: 'openclaw', label: 'OpenClaw', defaultModel: 'anthropic/claude-sonnet-4-20250514' },
  { value: 'ollama', label: 'Ollama', defaultModel: 'ollama/llama3.1' },
  { value: 'openai', label: 'ChatGPT / OpenAI', defaultModel: 'openai/gpt-4.1-mini' },
] as const

export function AgentSquadPanel() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [wakingAll, setWakingAll] = useState(false)

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

  const wakeAllOfflineAgents = async () => {
    const offlineAgents = agents.filter(a => a.status === 'offline')
    if (offlineAgents.length === 0) {
      setNotice('No offline agents to wake')
      return
    }

    setWakingAll(true)
    setError(null)
    setNotice(null)

    const succeeded = new Set<string>()
    await Promise.allSettled(
      offlineAgents.map(async (agent) => {
        const response = await fetch('/api/agents', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: agent.name,
            status: 'idle',
            last_activity: 'Woken by operator (bulk)',
          }),
        })
        if (!response.ok) throw new Error(agent.name)
        succeeded.add(agent.name)
      })
    )

    const now = Math.floor(Date.now() / 1000)
    setAgents(prev => prev.map(agent => (
      succeeded.has(agent.name)
        ? { ...agent, status: 'idle', last_activity: 'Woken by operator (bulk)', last_seen: now, updated_at: now }
        : agent
    )))

    const failCount = offlineAgents.length - succeeded.size
    if (failCount > 0) {
      setError(`Woke ${succeeded.size}/${offlineAgents.length} agents (${failCount} failed)`)
    } else {
      setNotice(`Woke ${succeeded.size} offline agent${succeeded.size === 1 ? '' : 's'}`)
    }

    setWakingAll(false)
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
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={wakeAllOfflineAgents}
            disabled={wakingAll}
            className="px-3 py-1 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-60"
            title="Set all offline agents to idle"
          >
            {wakingAll ? 'Waking...' : 'Wake All Offline'}
          </button>
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
      {notice && (
        <div className="bg-green-900/20 border border-green-500 text-green-400 p-3 mx-4 rounded">
          {notice}
          <button
            onClick={() => setNotice(null)}
            className="float-right text-green-300 hover:text-green-100"
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
                className="bg-gray-800 rounded-lg p-4 border-l-4 border-gray-600 hover:bg-gray-750 transition-colors cursor-pointer"
                onClick={() => setSelectedAgent(agent)}
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white text-lg">{agent.name}</h3>
                    <p className="text-gray-400 text-sm">{agent.role}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${statusColors[agent.status]} animate-pulse`}></div>
                    <span className="text-xs text-gray-400">{agent.status}</span>
                  </div>
                </div>

                {/* Session Info */}
                {agent.session_key && (
                  <div className="text-xs text-gray-400 mb-2">
                    <span className="font-medium">Session:</span> {agent.session_key}
                  </div>
                )}

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
                      updateAgentStatus(agent.name, 'offline', 'Manually set offline')
                    }}
                    disabled={agent.status === 'offline'}
                    className="flex-1 px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Sleep
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={fetchAgents}
          onStatusUpdate={updateAgentStatus}
        />
      )}

      {/* Create Agent Modal */}
      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchAgents}
        />
      )}
    </div>
  )
}

// Agent Detail Modal
function AgentDetailModal({
  agent,
  onClose,
  onUpdate,
  onStatusUpdate
}: {
  agent: Agent
  onClose: () => void
  onUpdate: () => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const showFeedback = (success: boolean, message: string) => {
    if (!message) return
    if (!success) console.error(message)
    if (typeof window !== 'undefined') window.alert(message)
  }
  const [formData, setFormData] = useState({
    role: agent.role,
    session_key: agent.session_key || '',
    soul_content: agent.soul_content || '',
  })

  useEffect(() => {
    // Re-sync form when agent prop changes (open modal for different agent)
    setFormData({
      role: agent.role,
      session_key: agent.session_key || '',
      soul_content: agent.soul_content || '',
    })
  }, [agent])

  const handleSave = async () => {
    try {
      // Update agent core fields (role + gateway config)
      const gatewayConfig = { session_key: formData.session_key }
      // Prefer id-based PUT which supports gateway write-back and expected fields
      const res1 = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: formData.role, gateway_config: gatewayConfig, write_to_gateway: false })
      })

      if (!res1.ok) {
        const err = await res1.json().catch(() => ({}))
        const msg = err?.error || (err?.warning ? err.warning : 'Failed to update agent')
        showFeedback(false, msg)
        console.error('Agent update failed', err)
        return
      }

      // Update SOUL content via dedicated endpoint
      const res2 = await fetch(`/api/agents/${agent.id}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul_content: formData.soul_content })
      })

      if (!res2.ok) {
        const err = await res2.json().catch(() => ({}))
        showFeedback(false, err?.error || 'Failed to update SOUL content')
        console.error('SOUL update failed', err)
        return
      }

      setEditing(false)
      showFeedback(true, 'Agent updated')
      onUpdate()
    } catch (error) {
      console.error('Failed to save agent edits:', error)
      showFeedback(false, error instanceof Error ? error.message : 'Failed to save changes')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
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

          {/* Status Controls */}
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <h4 className="text-sm font-medium text-white mb-2">Status Control</h4>
            <div className="flex gap-2">
              {(['idle', 'busy', 'offline'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => onStatusUpdate(agent.name, status)}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    agent.status === status
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-600 text-white hover:bg-gray-500'
                  }`}
                >
                  {statusIcons[status]} {status}
                </button>
              ))}
            </div>
          </div>

          {/* Agent Details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Role</label>
              {editing ? (
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-white">{agent.role}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Session Key</label>
              {editing ? (
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-white font-mono">{agent.session_key || 'Not set'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">SOUL Content</label>
              {editing ? (
                <textarea
                  value={formData.soul_content}
                  onChange={(e) => setFormData(prev => ({ ...prev, soul_content: e.target.value }))}
                  rows={4}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Agent personality and instructions..."
                />
              ) : (
                <p className="text-white whitespace-pre-wrap">{agent.soul_content || 'Not set'}</p>
              )}
            </div>

            {/* Task Statistics */}
            {agent.taskStats && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Task Statistics</label>
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-white">{agent.taskStats.total}</div>
                    <div className="text-xs text-gray-400">Total</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-blue-400">{agent.taskStats.assigned}</div>
                    <div className="text-xs text-gray-400">Assigned</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                    <div className="text-xs text-gray-400">In Progress</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                    <div className="text-xs text-gray-400">Done</div>
                  </div>
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Created:</span>
                <span className="text-white ml-2">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-400">Last Updated:</span>
                <span className="text-white ml-2">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            {editing ? (
              <>
                <button
                  onClick={handleSave}
                  className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex-1 bg-gray-600 text-white py-2 rounded hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
              >
                Edit Agent
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Create Agent Modal
function CreateAgentModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const showFeedback = (success: boolean, message: string) => {
    if (!message) return
    if (!success) console.error(message)
    if (typeof window !== 'undefined') window.alert(message)
  }
  const [formData, setFormData] = useState({
    name: '',
    template: 'custom',
    role: '',
    provider: 'openclaw',
    model: '',
    session_key: '',
    soul_content: '',
  })

  const selectedTemplate =
    formData.template === 'custom'
      ? null
      : AGENT_TEMPLATES.find((template) => template.type === formData.template) || null

  const applyTemplate = (templateType: string, provider: string) => {
    const template = AGENT_TEMPLATES.find((entry) => entry.type === templateType)
    if (!template) return

    const providerDefaults = PROVIDER_OPTIONS.find((entry) => entry.value === provider)
    const suggestedModel =
      provider === 'openclaw'
        ? template.config.model.primary
        : providerDefaults?.defaultModel || ''

    setFormData((prev) => ({
      ...prev,
      template: template.type,
      role: template.config.identity.theme || template.type,
      model: suggestedModel,
      soul_content: prev.soul_content || template.description,
    }))
  }

  const handleTemplateChange = (templateType: string) => {
    if (templateType === 'custom') {
      setFormData((prev) => ({ ...prev, template: 'custom' }))
      return
    }
    applyTemplate(templateType, formData.provider)
  }

  const handleProviderChange = (provider: string) => {
    const providerDefaults = PROVIDER_OPTIONS.find((entry) => entry.value === provider)
    setFormData((prev) => {
      const shouldRefreshModel =
        !prev.model ||
        prev.model.startsWith('anthropic/') ||
        prev.model.startsWith('ollama/') ||
        prev.model.startsWith('openai/')

      return {
        ...prev,
        provider,
        model: shouldRefreshModel
          ? provider === 'openclaw'
            ? selectedTemplate?.config.model.primary || prev.model
            : providerDefaults?.defaultModel || prev.model
          : prev.model,
      }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      // build gateway_config depending on provider
      const gateway_config: any = { provider: formData.provider }
      if (formData.model) gateway_config.model = formData.model
      if (formData.session_key) gateway_config.session_key = formData.session_key

      const payload: any = {
        name: formData.name,
        role: formData.role,
        session_key: formData.session_key || undefined,
        soul_content: formData.soul_content || undefined,
        template: formData.template !== 'custom' ? formData.template : undefined,
        gateway_config,
      }

      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create agent')
      }

      onCreated()
      onClose()
    } catch (error) {
      console.error('Error creating agent:', error)
      showFeedback(false, (error as Error).message || 'Failed to create agent')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-xl font-bold text-white mb-4">Create New Agent</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Template</label>
              <select
                value={formData.template}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="custom">Custom</option>
                {AGENT_TEMPLATES.map((template) => (
                  <option key={template.type} value={template.type}>
                    {template.label}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex flex-wrap gap-2">
                {['reviewer', 'developer', 'researcher', 'orchestrator'].map((templateType) => {
                  const template = AGENT_TEMPLATES.find((entry) => entry.type === templateType)
                  if (!template) return null
                  return (
                    <button
                      key={template.type}
                      type="button"
                      onClick={() => handleTemplateChange(template.type)}
                      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                        formData.template === template.type
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {template.label}
                    </button>
                  )
                })}
              </div>
              {selectedTemplate && (
                <p className="mt-2 text-xs text-gray-400">{selectedTemplate.description}</p>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-1">Role</label>
              <input
                type="text"
                value={formData.role}
                onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., researcher, developer, analyst"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Provider</label>
                <select
                  value={formData.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Model (Optional)</label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={formData.provider === 'openai' ? 'e.g. openai/gpt-4.1-mini' : 'e.g. ollama/ggml-model'}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Session Key (Optional)</label>
              <input
                type="text"
                value={formData.session_key}
                onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={formData.provider === 'openai' ? 'Leave blank to use shared OpenAI credentials' : 'Attach a live session if needed'}
              />
              {formData.provider === 'openai' && (
                <p className="mt-1 text-xs text-gray-400">
                  ChatGPT/OpenAI agents can use the shared project API key or stored credentials. No per-agent API assignment is required.
                </p>
              )}
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-1">SOUL Content (Optional)</label>
              <textarea
                value={formData.soul_content}
                onChange={(e) => setFormData(prev => ({ ...prev, soul_content: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Agent personality and instructions..."
              />
            </div>
          </div>
          
          <div className="flex gap-3 mt-6">
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Create Agent
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-600 text-white py-2 rounded hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
