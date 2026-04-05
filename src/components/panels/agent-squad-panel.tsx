'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import { type Agent, statusColors } from './agent-squad-panel-types'
import { AgentCard } from './agent-squad-card'
import { AgentDetailModal } from './agent-squad-detail'
import { CreateAgentModal } from './agent-squad-create'

const log = createClientLogger('AgentSquadPanel')

// Fetch all agents from the /api/agents endpoint with a timeout guard
async function fetchAgentsFromApi(t: ReturnType<typeof useTranslations>): Promise<Agent[]> {
  const response = await fetch('/api/agents', { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(t('failedToFetch'))
  const data = await response.json() as { agents?: Agent[] }
  return data.agents ?? []
}

export function AgentSquadPanel(): React.JSX.Element {
  const t = useTranslations('agentSquad')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Tracks whether the first fetch has completed — avoids full-page loader on subsequent polls
  const hasLoadedRef = useRef(false)

  const fetchAgents = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      if (!hasLoadedRef.current) setLoading(true)
      const loaded = await fetchAgentsFromApi(t)
      setAgents(loaded)
      hasLoadedRef.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorOccurred'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void fetchAgents() }, [fetchAgents])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => { void fetchAgents() }, 10_000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchAgents])

  const updateAgentStatus = async (
    agentName: string,
    status: Agent['status'],
    activity?: string,
  ): Promise<void> => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          status,
          last_activity: activity ?? `Status changed to ${status}`,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(t('failedToUpdateStatus'))
      setAgents(prev => prev.map(agent =>
        agent.name === agentName
          ? { ...agent, status, last_activity: activity ?? `Status changed to ${status}`, last_seen: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) }
          : agent
      ))
    } catch (err) {
      log.error('Failed to update agent status:', err)
      setError(t('failedToUpdateStatus'))
    }
  }

  const formatLastSeen = (timestamp?: number): string => {
    if (!timestamp) return t('never')
    const diffMs = Date.now() - timestamp * 1000
    const diffMinutes = Math.floor(diffMs / 60_000)
    const diffHours = Math.floor(diffMs / 3_600_000)
    const diffDays = Math.floor(diffMs / 86_400_000)
    if (diffMinutes < 1) return t('justNow')
    if (diffMinutes < 60) return t('minutesAgo', { count: diffMinutes })
    if (diffHours < 24) return t('hoursAgo', { count: diffHours })
    if (diffDays < 7) return t('daysAgo', { count: diffDays })
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  const statusCounts = agents.reduce<Record<string, number>>((acc, agent) => ({
    ...acc,
    [agent.status]: (acc[agent.status] ?? 0) + 1,
  }), {})

  if (loading && !hasLoadedRef.current) {
    return <Loader variant="panel" label={t('loadingAgents')} />
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">{t('title')}</h2>
          <div className="flex gap-2 text-sm">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
                <span className="text-gray-400">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAutoRefresh(v => !v)} variant={autoRefresh ? 'success' : 'secondary'} size="sm">
            {autoRefresh ? t('live') : t('manual')}
          </Button>
          <Button onClick={() => setShowCreateModal(true)}>{t('addAgent')}</Button>
          <Button onClick={() => void fetchAgents()} variant="secondary">{t('refresh')}</Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-3 m-4 rounded">
          {error}
          <Button onClick={() => setError(null)} variant="ghost" size="icon-sm" className="float-right text-red-300 hover:text-red-100">
            ×
          </Button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">🤖</div>
            <p>{t('noAgents')}</p>
            <p className="text-sm">{t('addFirstAgent')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                formatLastSeen={formatLastSeen}
                onSelect={setSelectedAgent}
                onStatusUpdate={updateAgentStatus}
                wakeLabel={t('wake')}
                busyLabel={t('busy')}
                sleepLabel={t('sleep')}
                sessionLabel={t('session')}
                lastSeenLabel={t('lastSeen')}
                activityLabel={t('activity')}
                totalTasksLabel={t('totalTasks')}
                inProgressLabel={t('inProgress')}
              />
            ))}
          </div>
        )}
      </div>

      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={() => void fetchAgents()}
          onStatusUpdate={updateAgentStatus}
        />
      )}

      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => void fetchAgents()}
        />
      )}
    </div>
  )
}
