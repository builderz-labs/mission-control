'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/types/sql'
import { CreateAgentModal } from './agent-detail-tabs'
import { useMissionControl, type Agent } from '@/store'
import { AgentSquadList } from './agent-squad/AgentSquadList'
import { AgentSquadDetail } from './agent-squad/AgentSquadDetail'
import { QuickSpawnModal } from './agent-squad/QuickSpawnModal'
import { statusColors } from './agent-squad/agent-squad-types'

const log = createClientLogger('AgentSquadPhase3')

// Agents seen within the last 30 minutes are considered heartbeat-active
function hasRecentHeartbeat(agent: Agent): boolean {
  if (!agent.last_seen) return false
  const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - 30 * 60
  return agent.last_seen > thirtyMinutesAgo
}

function formatLastSeen(timestamp?: number): string {
  if (!timestamp) return 'Never'
  const diffMs = Date.now() - timestamp * 1000
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

export function AgentSquadPanelPhase3() {
  const t = useTranslations('agentSquadPhase3')
  const { agents, setAgents } = useMissionControl()
  const [loading, setLoading] = useState(agents.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showQuickSpawnModal, setShowQuickSpawnModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncToast, setSyncToast] = useState<string | null>(null)
  const syncToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel pending toast timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => { if (syncToastTimerRef.current) clearTimeout(syncToastTimerRef.current) }
  }, [])

  const showSyncToast = (message: string) => {
    setSyncToast(message)
    if (syncToastTimerRef.current) clearTimeout(syncToastTimerRef.current)
    syncToastTimerRef.current = setTimeout(() => setSyncToast(null), 5000)
  }

  const fetchAgents = useCallback(async () => {
    try {
      setError(null)
      if (agents.length === 0) setLoading(true)

      const response = await fetch('/api/agents', { signal: AbortSignal.timeout(8000) })
      if (response.status === 401) { window.location.assign('/login?next=%2Fagents'); return }
      if (response.status === 403) throw new Error('Access denied')
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch agents')
      }

      const data = await response.json()
      setAgents(data.agents || [])
    } catch (err) {
      setError(err instanceof Error ? getErrorMessage(err) : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [agents.length, setAgents])

  useSmartPoll(fetchAgents, 30000, { enabled: autoRefresh, pauseWhenSseConnected: true })

  const updateAgentStatus = async (agentName: string, status: Agent['status'], activity?: string) => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName, status, last_activity: activity || `Status changed to ${status}` }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error('Failed to update agent status')
      // Immutable update of the agents list
      setAgents(agents.map(agent =>
        agent.name === agentName
          ? { ...agent, status, last_activity: activity || `Status changed to ${status}`, last_seen: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) }
          : agent
      ))
    } catch (error) {
      log.error('Failed to update agent status:', error)
      setError('Failed to update agent status')
    }
  }

  const wakeAgent = async (agentName: string, sessionKey: string) => {
    try {
      const response = await fetch(`/api/agents/${agentName}/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `🤖 **Wake Up Call**\n\nAgent ${agentName}, you have been manually woken up.\nCheck Ultron for any pending tasks or notifications.\n\n⏰ ${new Date().toLocaleString()}`
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to wake agent')
      }
      await updateAgentStatus(agentName, 'idle', 'Manually woken via session')
    } catch (error) {
      log.error('Failed to wake agent:', error)
      setError('Failed to wake agent')
    }
  }

  const deleteAgent = async (agentId: number, removeWorkspace: boolean) => {
    const previousAgents = agents
    setAgents(agents.filter((agent) => agent.id !== agentId))

    const response = await fetch(`/api/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_workspace: removeWorkspace }),
      signal: AbortSignal.timeout(8000),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setAgents(previousAgents)
      throw new Error(payload?.error || 'Failed to delete agent')
    }

    showSyncToast(
      removeWorkspace
        ? `Deleted agent and workspace: ${payload?.deleted || agentId}`
        : `Deleted agent: ${payload?.deleted || agentId}`,
    )
    await fetchAgents()
  }

  const syncFromConfig = async (source?: 'local') => {
    setSyncing(true)
    setSyncToast(null)
    try {
      const url = source === 'local' ? '/api/agents/sync?source=local' : '/api/agents/sync'
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8000) })
      if (response.status === 401) { window.location.assign('/login?next=%2Fagents'); return }
      const data = await response.json()
      if (response.status === 403) throw new Error('Admin access required for agent sync')
      if (!response.ok) throw new Error(data.error || 'Sync failed')
      showSyncToast(
        source === 'local'
          ? (data.message || 'Local agent sync complete')
          : `Synced ${data.synced} agents (${data.created} new, ${data.updated} updated)`
      )
      fetchAgents()
    } catch (err: unknown) {
      showSyncToast(`Sync failed: ${getErrorMessage(err)}`)
    } finally {
      setSyncing(false)
    }
  }

  // Summary counts per status
  const statusCounts = agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  if (loading && agents.length === 0) {
    return <Loader variant="panel" label="Loading agents" />
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>

          {/* Status summary dots */}
          <div className="flex gap-2 text-sm">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>

          {/* Active heartbeat indicator */}
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-sm text-muted-foreground">
              {t('activeHeartbeats', { count: agents.filter(hasRecentHeartbeat).length })}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setAutoRefresh(!autoRefresh)} variant={autoRefresh ? 'success' : 'secondary'} size="sm">
            {autoRefresh ? t('live') : t('manual')}
          </Button>
          <Button onClick={() => syncFromConfig()} disabled={syncing} size="sm" className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">
            {syncing ? t('syncing') : t('syncConfig')}
          </Button>
          <Button onClick={() => syncFromConfig('local')} disabled={syncing} size="sm" className="bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30">
            {t('syncLocal')}
          </Button>
          <Button onClick={() => setShowCreateModal(true)} size="sm">{t('addAgent')}</Button>
          <Button onClick={fetchAgents} variant="secondary" size="sm">{t('refresh')}</Button>
        </div>
      </div>

      {/* Sync Toast */}
      {syncToast && (
        <div className={`p-3 m-4 rounded-lg text-sm ${syncToast.includes('failed') ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-green-500/10 border border-green-500/20 text-green-400'}`}>
          {syncToast}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button onClick={() => setError(null)} variant="ghost" size="icon-sm" className="text-red-400/60 hover:text-red-400 ml-2">×</Button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        <AgentSquadList
          agents={agents}
          hasRecentHeartbeat={hasRecentHeartbeat}
          formatLastSeen={formatLastSeen}
          wakeLabel={t('wake')}
          spawnLabel={t('spawn')}
          noAgentsLabel={t('noAgents')}
          noAgentsHintLabel={t('noAgentsHint')}
          onSelectAgent={setSelectedAgent}
          onWakeAgent={(agent) => {
            if (agent.session_key) wakeAgent(agent.name, agent.session_key)
            else updateAgentStatus(agent.name, 'idle', 'Manually activated')
          }}
          onSpawnAgent={(agent) => { setSelectedAgent(agent); setShowQuickSpawnModal(true) }}
        />
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && !showQuickSpawnModal && (
        <AgentSquadDetail
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={fetchAgents}
          onStatusUpdate={updateAgentStatus}
          onWakeAgent={wakeAgent}
          onDelete={deleteAgent}
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
          onClose={() => { setShowQuickSpawnModal(false); setSelectedAgent(null) }}
          onSpawned={fetchAgents}
        />
      )}
    </div>
  )
}

export default AgentSquadPanelPhase3
