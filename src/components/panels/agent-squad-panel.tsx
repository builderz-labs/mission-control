'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('AgentSquadPanel')

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
  runtime_type?: string
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

export function AgentSquadPanel() {
  const t = useTranslations('agentSquad')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [agentSearch, setAgentSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Agent['status'] | 'all'>('all')

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setError(null)
      if (agents.length === 0) setLoading(true)

      const response = await fetch('/api/agents')
      if (!response.ok) throw new Error(t('failedToFetch'))

      const data = await response.json()
      setAgents(data.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorOccurred'))
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

      if (!response.ok) throw new Error(t('failedToUpdateStatus'))

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
      log.error('Failed to update agent status:', error)
      setError(t('failedToUpdateStatus'))
    }
  }

  // Format last seen time
  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return t('never')

    const now = Date.now()
    const diffMs = now - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMinutes < 1) return t('justNow')
    if (diffMinutes < 60) return t('minutesAgo', { count: diffMinutes })
    if (diffHours < 24) return t('hoursAgo', { count: diffHours })
    if (diffDays < 7) return t('daysAgo', { count: diffDays })
    
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  const normalizedAgentSearch = agentSearch.trim().toLowerCase()
  const filteredAgents = agents.filter(agent => {
    if (statusFilter !== 'all' && agent.status !== statusFilter) return false
    if (normalizedAgentSearch) {
      const haystack = [
        agent.name,
        agent.role,
        agent.runtime_type || '',
        agent.session_key || '',
        agent.last_activity || '',
      ].join(' ').toLowerCase()
      if (!haystack.includes(normalizedAgentSearch)) return false
    }
    return true
  })

  const workloadTotals = agents.reduce((acc, agent) => {
    acc.total += agent.taskStats?.total || 0
    acc.assigned += agent.taskStats?.assigned || 0
    acc.inProgress += agent.taskStats?.in_progress || 0
    acc.completed += agent.taskStats?.completed || 0
    return acc
  }, { total: 0, assigned: 0, inProgress: 0, completed: 0 })

  // Get status distribution for summary
  const statusCounts = agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  if (loading && agents.length === 0) {
    return <Loader variant="panel" label={t('loadingAgents')} />
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">{t('title')}</h2>
          
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
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? 'success' : 'secondary'}
            size="sm"
          >
            {autoRefresh ? t('live') : t('manual')}
          </Button>
          <Button
            onClick={() => setShowCreateModal(true)}
          >
            {t('addAgent')}
          </Button>
          <Button
            onClick={fetchAgents}
            variant="secondary"
          >
            {t('refresh')}
          </Button>
        </div>
      </div>

      <div className="border-b border-gray-700 bg-gray-900/80 p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-700 bg-gray-800/70 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Agents</div>
            <div className="text-2xl font-semibold text-white">{filteredAgents.length}<span className="text-sm text-gray-500">/{agents.length}</span></div>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800/70 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Assigned</div>
            <div className="text-2xl font-semibold text-blue-300">{workloadTotals.assigned}</div>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800/70 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">In progress</div>
            <div className="text-2xl font-semibold text-yellow-300">{workloadTotals.inProgress}</div>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800/70 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Total workload</div>
            <div className="text-2xl font-semibold text-white">{workloadTotals.total}</div>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_auto]">
          <input
            type="search"
            value={agentSearch}
            onChange={(event) => setAgentSearch(event.target.value)}
            placeholder="Search agent, role, runtime, session…"
            className="h-9 rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as Agent['status'] | 'all')}
            className="h-9 rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="all">All statuses</option>
            <option value="idle">Idle</option>
            <option value="busy">Busy</option>
            <option value="offline">Offline</option>
            <option value="error">Error</option>
          </select>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setAgentSearch('')
              setStatusFilter('all')
            }}
            disabled={!agentSearch && statusFilter === 'all'}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-3 m-4 rounded">
          {error}
          <Button
            onClick={() => setError(null)}
            variant="ghost"
            size="icon-sm"
            className="float-right text-red-300 hover:text-red-100"
          >
            ×
          </Button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {filteredAgents.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">🤖</div>
            <p>{agents.length === 0 ? t('noAgents') : 'No agents match these filters'}</p>
            <p className="text-sm">{agents.length === 0 ? t('addFirstAgent') : 'Clear filters or refresh to see all agents.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAgents.map(agent => (
              <div
                key={agent.id}
                className="bg-gray-800 rounded-lg p-4 border-l-4 border-gray-600 hover:bg-gray-750 transition-colors cursor-pointer"
                onClick={() => setSelectedAgent(agent)}
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white text-lg">{agent.name}</h3>
                      {agent.runtime_type && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-1 text-muted-foreground border border-border/30">
                          {agent.runtime_type}
                        </span>
                      )}
                    </div>
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
                    <span className="font-medium">{t('session')}:</span> {agent.session_key}
                  </div>
                )}

                {/* Task Stats */}
                {agent.taskStats && (
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-white">{agent.taskStats.total}</div>
                      <div className="text-[10px] text-gray-400">Total</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-blue-300">{agent.taskStats.assigned}</div>
                      <div className="text-[10px] text-gray-400">Assigned</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                      <div className="text-[10px] text-gray-400">Active</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                      <div className="text-[10px] text-gray-400">Done</div>
                    </div>
                  </div>
                )}

                {/* Last Activity */}
                <div className="text-xs text-gray-400 mb-3">
                  <div>
                    <span className="font-medium">{t('lastSeen')}:</span> {formatLastSeen(agent.last_seen)}
                  </div>
                  {agent.last_activity && (
                    <div className="mt-1 truncate" title={agent.last_activity}>
                      <span className="font-medium">{t('activity')}:</span> {agent.last_activity}
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <div className="flex gap-1">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation()
                      updateAgentStatus(agent.name, 'idle', 'Manually activated')
                    }}
                    disabled={agent.status === 'idle'}
                    variant="success"
                    size="xs"
                    className="flex-1"
                  >
                    {t('wake')}
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation()
                      updateAgentStatus(agent.name, 'busy', 'Manually set to busy')
                    }}
                    disabled={agent.status === 'busy'}
                    size="xs"
                    className="flex-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30"
                  >
                    {t('busy')}
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation()
                      updateAgentStatus(agent.name, 'offline', 'Manually set offline')
                    }}
                    disabled={agent.status === 'offline'}
                    variant="secondary"
                    size="xs"
                    className="flex-1"
                  >
                    {t('sleep')}
                  </Button>
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
  const t = useTranslations('agentSquad')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    role: agent.role,
    session_key: agent.session_key || '',
    soul_content: agent.soul_content || '',
  })

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

      if (!response.ok) throw new Error(t('failedToUpdate'))
      
      setEditing(false)
      onUpdate()
    } catch (error) {
      log.error('Failed to update agent:', error)
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
              <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">×</Button>
            </div>
          </div>

          {/* Status Controls */}
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <h4 className="text-sm font-medium text-white mb-2">{t('statusControl')}</h4>
            <div className="flex gap-2">
              {(['idle', 'busy', 'offline'] as const).map(status => (
                <Button
                  key={status}
                  onClick={() => onStatusUpdate(agent.name, status)}
                  variant={agent.status === status ? 'default' : 'secondary'}
                  size="sm"
                >
                  {statusIcons[status]} {status}
                </Button>
              ))}
            </div>
          </div>

          {/* Agent Details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">{t('role')}</label>
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
              <label className="block text-sm font-medium text-gray-400 mb-1">{t('sessionKey')}</label>
              {editing ? (
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-white font-mono">{agent.session_key || t('notSet')}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">{t('soulContent')}</label>
              {editing ? (
                <textarea
                  value={formData.soul_content}
                  onChange={(e) => setFormData(prev => ({ ...prev, soul_content: e.target.value }))}
                  rows={4}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('soulPlaceholder')}
                />
              ) : (
                <p className="text-white whitespace-pre-wrap">{agent.soul_content || t('notSet')}</p>
              )}
            </div>

            {/* Task Statistics */}
            {agent.taskStats && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">{t('taskStatistics')}</label>
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-white">{agent.taskStats.total}</div>
                    <div className="text-xs text-gray-400">{t('total')}</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-blue-400">{agent.taskStats.assigned}</div>
                    <div className="text-xs text-gray-400">{t('assigned')}</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                    <div className="text-xs text-gray-400">{t('inProgress')}</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                    <div className="text-xs text-gray-400">{t('done')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">{t('created')}:</span>
                <span className="text-white ml-2">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-400">{t('lastUpdated')}:</span>
                <span className="text-white ml-2">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            {editing ? (
              <>
                <Button
                  onClick={handleSave}
                  className="flex-1"
                >
                  {t('saveChanges')}
                </Button>
                <Button
                  onClick={() => setEditing(false)}
                  variant="secondary"
                  className="flex-1"
                >
                  {t('cancel')}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setEditing(true)}
                className="flex-1"
              >
                {t('editAgent')}
              </Button>
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
  const t = useTranslations('agentSquad')
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    session_key: '',
    soul_content: '',
    runtime_type: '' as string,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          runtime_type: formData.runtime_type || undefined,
        })
      })

      if (!response.ok) throw new Error(t('failedToCreate'))
      
      onCreated()
      onClose()
    } catch (error) {
      log.error('Error creating agent:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-xl font-bold text-white mb-4">{t('createNewAgent')}</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('role')}</label>
              <input
                type="text"
                value={formData.role}
                onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('rolePlaceholder')}
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('runtimeType')}</label>
              <select
                value={formData.runtime_type}
                onChange={(e) => setFormData(prev => ({ ...prev, runtime_type: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('runtimeTypeAuto')}</option>
                <option value="hermes">Hermes Agent</option>
                <option value="openclaw">OpenClaw</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex CLI</option>
                <option value="custom">{t('runtimeTypeCustom')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('sessionKeyOptional')}</label>
              <input
                type="text"
                value={formData.session_key}
                onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('sessionKeyPlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('soulContentOptional')}</label>
              <textarea
                value={formData.soul_content}
                onChange={(e) => setFormData(prev => ({ ...prev, soul_content: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder={t('soulPlaceholder')}
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button
              type="submit"
              className="flex-1"
            >
              {t('createAgent')}
            </Button>
            <Button
              type="button"
              onClick={onClose}
              variant="secondary"
              className="flex-1"
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}