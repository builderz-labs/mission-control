'use client'

import { useState, useEffect, useCallback } from 'react'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { Button } from '@/components/ui/button'
import { PropertyChip } from '@/components/ui/property-chip'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'
import { useMissionControl } from '@/store'
import { Refresh, NavArrowLeft } from 'iconoir-react'
import { PixelLoader, pixelLoaderPatterns } from '@/components/ui/pixel-loader'
import {
  OverviewTab,
  SoulTab,
  MemoryTab,
  TasksTab,
  ActivityTab,
  ConfigTab,
  FilesTab,
  SkillsTab,
} from './agent-detail-tabs'

interface Agent {
  id: number
  name: string
  role: string
  team?: string
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

interface ModelInfo {
  id: string
  name: string
  provider: string
}

const statusColors: Record<string, string> = {
  offline: 'bg-zinc-500',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
}

export function AgentDetailPage({ agentName }: { agentName: string }) {
  const { setActiveTab } = useMissionControl()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTabLocal] = useState<'overview' | 'soul' | 'memory' | 'config' | 'tasks' | 'files' | 'skills' | 'activity'>('overview')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    role: '',
    session_key: '',
    soul_content: '',
    working_memory: ''
  })
  const [soulSource, setSoulSource] = useState<'disk' | 'db' | undefined>(undefined)
  const [memorySource, setMemorySource] = useState<'disk' | 'db' | undefined>(undefined)
  const [dailyFiles, setDailyFiles] = useState<Array<{ filename: string; date: string; size: number; modified: number }>>([])
  const [soulTemplates, setSoulTemplates] = useState<SoulTemplate[]>([])
  const [heartbeatData, setHeartbeatData] = useState<HeartbeatResponse | null>(null)
  const [loadingHeartbeat, setLoadingHeartbeat] = useState(false)
  const [restartingSession, setRestartingSession] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelDraft, setModelDraft] = useState('')
  const [modelDirty, setModelDirty] = useState(false)
  const [modelSavedPendingApply, setModelSavedPendingApply] = useState(false)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelApplying, setModelApplying] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  // Fetch agent details
  const fetchAgent = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch('/api/agents')
      if (!response.ok) throw new Error('Failed to fetch agents')

      const data = await response.json()
      const foundAgent = data.agents?.find((a: Agent) => a.name === agentName)

      if (!foundAgent) {
        setError(`Agent "${agentName}" not found`)
        return
      }

      setAgent(foundAgent)
      const currentModel = typeof foundAgent.config?.model === 'string'
        ? foundAgent.config.model
        : (foundAgent.config?.model?.primary || '')
      setModelDraft(currentModel)
      setModelDirty(false)
      setModelSavedPendingApply(false)
      setModelError(null)
      setFormData({
        role: foundAgent.role,
        session_key: foundAgent.session_key || '',
        soul_content: foundAgent.soul_content || '',
        working_memory: foundAgent.working_memory || ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [agentName])

  useEffect(() => {
    fetchAgent()
  }, [fetchAgent])

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.models) setAvailableModels(data.models) })
      .catch(() => {})
  }, [])

  // Load SOUL content from disk-first API + templates
  useEffect(() => {
    if (activeTab !== 'soul' || !agent) return

    const loadSoul = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/soul`)
        if (response.ok) {
          const data = await response.json()
          setFormData(prev => ({ ...prev, soul_content: data.soul_content || '' }))
          setSoulSource(data.source)
          setSoulTemplates(data.available_templates?.map((name: string) => ({ name, description: name, size: 0 })) || [])
        }
      } catch (error) {
        console.error('Failed to load SOUL:', error)
      }
    }

    const loadTemplates = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/soul`, {
          method: 'PATCH'
        })
        if (response.ok) {
          const data = await response.json()
          if (data.templates) setSoulTemplates(data.templates)
        }
      } catch (error) {
        console.error('Failed to load SOUL templates:', error)
      }
    }

    loadSoul()
    loadTemplates()
  }, [activeTab, agent])

  // Load memory content from disk-first API
  useEffect(() => {
    if (activeTab !== 'memory' || !agent) return

    const loadMemory = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/memory`)
        if (response.ok) {
          const data = await response.json()
          setFormData(prev => ({ ...prev, working_memory: data.working_memory || '' }))
          setMemorySource(data.source)
          setDailyFiles(data.daily_files || [])
        }
      } catch (error) {
        console.error('Failed to load memory:', error)
      }
    }

    loadMemory()
  }, [activeTab, agent])

  // Perform heartbeat check
  const performHeartbeat = async () => {
    if (!agent) return
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

      // Refresh agent data
      fetchAgent()
    } catch (error) {
      console.error('Failed to update agent status:', error)
      setError('Failed to update agent status')
    }
  }

  // Wake agent via session_send
  const wakeAgent = async (agentName: string, sessionKey: string) => {
    try {
      const response = await fetch(`/api/agents/${agentName}/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `🤖 **Wake Up Call**\n\nAgent ${agentName}, you have been manually woken up.\nCheck Mission Control for any pending tasks or notifications.\n\n⏰ ${new Date().toLocaleString()}`
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to wake agent')
      }

      await updateAgentStatus(agentName, 'idle', 'Manually woken via session')
    } catch (error) {
      console.error('Failed to wake agent:', error)
      setError('Failed to wake agent')
    }
  }

  const handleSave = async () => {
    if (!agent) return
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
      fetchAgent()
    } catch (error) {
      console.error('Failed to update agent:', error)
    }
  }

  const handleSoulSave = async (content: string, templateName?: string) => {
    if (!agent) return
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
      fetchAgent()
    } catch (error) {
      console.error('Failed to update SOUL:', error)
    }
  }

  const handleMemorySave = async (content: string, append: boolean = false) => {
    if (!agent) return
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
      fetchAgent()
    } catch (error) {
      console.error('Failed to update memory:', error)
    }
  }

  const handleRestartSession = async () => {
    if (!agent || !agent.session_key) return

    const confirmed = confirm(`Restart ${agent.name}? This will kill the current session and start a new one.`)
    if (!confirmed) return

    setRestartingSession(true)
    try {
      // Step 1: Terminate the current session
      const terminateResponse = await fetch(`/api/sessions/${agent.session_key}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'terminate' })
      })

      if (!terminateResponse.ok) {
        const data = await terminateResponse.json()
        throw new Error(data.error || 'Failed to terminate session')
      }

      // Step 2: Wake the agent with a new session
      await wakeAgent(agent.name, agent.session_key)

      // Step 3: Update the agent status
      await updateAgentStatus(agent.name, 'idle', 'Session restarted')

      // Refresh agent data
      fetchAgent()
    } catch (error) {
      console.error('Failed to restart session:', error)
      alert(`Failed to restart session: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setRestartingSession(false)
    }
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '#' },
    { id: 'soul', label: 'SOUL', icon: '~' },
    { id: 'memory', label: 'Memory', icon: '@' },
    { id: 'files', label: 'Files', icon: '/' },
    { id: 'skills', label: 'Skills', icon: '⚡' },
    { id: 'tasks', label: 'Tasks', icon: '+' },
    { id: 'config', label: 'Config', icon: '*' },
    { id: 'activity', label: 'Activity', icon: '>' }
  ]

  const currentModel = typeof agent?.config?.model === 'string'
    ? agent?.config?.model
    : (agent?.config?.model?.primary || '')

  const handleModelSelect = (value: string) => {
    setModelDraft(value)
    setModelDirty(value !== currentModel)
    setModelSavedPendingApply(false)
    setModelError(null)
  }

  const handleModelSave = async () => {
    if (!agent || !modelDraft) return
    setModelSaving(true)
    setModelError(null)
    try {
      const gwRes = await fetch('/api/gateway-config')
      if (!gwRes.ok) throw new Error('Failed to read gateway config')
      const gwData = await gwRes.json()
      const agentList = gwData.config?.agents?.list
      if (!Array.isArray(agentList)) throw new Error('No agents.list in gateway config')

      const idx = agentList.findIndex((a: any) =>
        a.identity?.name === agent.name ||
        a.id === agent.name ||
        a.id === agent.config?.openclawId ||
        a.openclawId === agent.config?.openclawId
      )
      if (idx === -1) throw new Error(`Agent "${agent.name}" not found in gateway config`)

      const res = await fetch('/api/gateway-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [`agents.list.${idx}.model`]: modelDraft } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update model')

      setAgent(prev => prev ? ({
        ...prev,
        config: {
          ...(prev.config || {}),
          model: modelDraft,
        },
      }) : prev)
      setModelDraft(modelDraft)
      setModelDirty(false)
      setModelSavedPendingApply(true)
    } catch (err: any) {
      setModelError(err.message || 'Failed to save model')
    } finally {
      setModelSaving(false)
    }
  }

  const handleModelApply = async () => {
    setModelApplying(true)
    setModelError(null)
    try {
      const res = await fetch('/api/gateway-config/apply', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data?.ok === false) throw new Error(data.error || 'Failed to apply config')
      setModelSavedPendingApply(false)
    } catch (err: any) {
      setModelError(err.message || 'Failed to apply model config')
    } finally {
      setModelApplying(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <PixelLoader pattern={pixelLoaderPatterns.spiral} color="hsl(var(--primary))" size={40} speed={120} />
        <span className="text-sm text-muted-foreground">Loading agent...</span>
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <button
            onClick={() => setActiveTab('agents')}
            className="p-2 rounded-md hover:bg-secondary transition-smooth"
            title="Back to Crew"
          >
            <NavArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-foreground">Agent Not Found</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground">{error || 'Agent not found'}</p>
            <button
              onClick={() => setActiveTab('agents')}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
            >
              Back to Crew
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={(val) => setActiveTabLocal(val as any)} className="flex-1 min-h-0 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border flex-shrink-0">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveTab('agents')}
                className="p-2 rounded-md hover:bg-secondary transition-smooth"
                title="Back to Crew"
              >
                <NavArrowLeft className="w-5 h-5" />
              </button>
              <AgentAvatar agent={agent.name} size="lg" />
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl font-bold text-foreground">{agent.name}</h3>
                  {/* Heartbeat interval badge */}
                  {agent.config?.heartbeat?.every && (
                    <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded" title="Heartbeat interval">
                      ⏱ {agent.config.heartbeat.every}
                    </span>
                  )}
                  {/* Tools deny count badge */}
                  {agent.config?.tools?.deny && agent.config.tools.deny.length > 0 && (
                    <span
                      className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded cursor-help"
                      title={`Denied tools: ${agent.config.tools.deny.join(', ')}`}
                    >
                      🚫 {agent.config.tools.deny.length} denied
                    </span>
                  )}
                  {/* Team badge */}
                  {agent.team && (
                    <span className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded" title="Team">
                      {agent.team}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap min-h-7">
                  <PropertyChip
                    value={modelDraft || currentModel || ''}
                    options={availableModels.map(m => ({
                      value: m.id,
                      label: m.name,
                      group: m.provider,
                    }))}
                    onSelect={handleModelSelect}
                    searchable
                    readOnly={modelSaving || modelApplying}
                  />
                  {modelSaving || modelApplying ? <PixelLoader size={12} speed={120} /> : null}
                  {modelDirty && (
                    <Button size="sm" onClick={handleModelSave} disabled={modelSaving || modelApplying}>
                      {modelSaving ? 'Saving…' : 'Save'}
                    </Button>
                  )}
                  {!modelDirty && modelSavedPendingApply && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleModelApply}
                      disabled={modelApplying}
                      className="border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 animate-pulse"
                    >
                      {modelApplying ? 'Applying…' : 'Apply'}
                    </Button>
                  )}
                </div>
                {modelError && (
                  <p className="text-xs text-red-400">{modelError}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${statusColors[agent.status]}`}></div>
              <span className="text-foreground">{agent.status}</span>
              <button
                onClick={agent.session_key ? handleRestartSession : () => wakeAgent(agent.name, '')}
                disabled={restartingSession}
                className="p-1.5 rounded-md bg-surface-1 text-muted-foreground hover:text-foreground hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
                title={agent.session_key ? 'Restart Session' : 'Wake Agent'}
              >
                <Refresh className={`w-4 h-4 ${restartingSession ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <TabsList className="w-full">
            {tabs.map(tab => (
              <TabsTab key={tab.id} value={tab.id}>
                <span>{tab.icon}</span>
                {tab.label}
              </TabsTab>
            ))}
          </TabsList>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          <TabsPanel value="overview">
            <OverviewTab
              agent={agent}
              editing={editing}
              formData={formData}
              setFormData={setFormData}
              onSave={handleSave}
              onStatusUpdate={updateAgentStatus}
              onWakeAgent={wakeAgent}
              onEdit={() => setEditing(true)}
              onCancel={() => setEditing(false)}
              heartbeatData={heartbeatData}
              loadingHeartbeat={loadingHeartbeat}
              onPerformHeartbeat={performHeartbeat}
            />
          </TabsPanel>

          <TabsPanel value="soul">
            <SoulTab
              agent={agent}
              soulContent={formData.soul_content}
              source={soulSource}
              templates={soulTemplates}
              onSave={handleSoulSave}
            />
          </TabsPanel>

          <TabsPanel value="memory">
            <MemoryTab
              agent={agent}
              workingMemory={formData.working_memory}
              source={memorySource}
              dailyFiles={dailyFiles}
              onSave={handleMemorySave}
            />
          </TabsPanel>

          <TabsPanel value="files">
            <FilesTab agent={agent} />
          </TabsPanel>

          <TabsPanel value="skills">
            <SkillsTab agent={agent} />
          </TabsPanel>

          <TabsPanel value="tasks">
            <TasksTab agent={agent} />
          </TabsPanel>

          <TabsPanel value="config">
            <ConfigTab agent={agent} onSave={fetchAgent} />
          </TabsPanel>

          <TabsPanel value="activity">
            <ActivityTab agent={agent} />
          </TabsPanel>
        </div>
      </Tabs>
    </div>
  )
}
