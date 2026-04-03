'use client'

import { useState, useEffect, useRef } from 'react'
import { getErrorMessage } from '@/lib/types/sql'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { createClientLogger } from '@/lib/client-logger'
import {
  OverviewTab,
  SoulTab,
  MemoryTab,
  TasksTab,
  ActivityTab,
  ConfigTab,
  FilesTab,
  ToolsTab,
  ChannelsTab,
  CronTab,
  ModelsTab,
} from '../agent-detail-tabs'
import {
  statusColors,
  statusBadgeStyles,
  type Agent,
  type HeartbeatResponse,
  type SoulTemplate,
} from './agent-squad-types'

const log = createClientLogger('AgentSquadDetail')

type AgentWithExtras = Agent & { config?: any; working_memory?: string }
type ActiveTab = 'overview' | 'soul' | 'memory' | 'config' | 'tasks' | 'activity' | 'files' | 'tools' | 'channels' | 'cron' | 'models'

interface AgentSquadDetailProps {
  agent: Agent
  onClose: () => void
  onUpdate: () => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
  onDelete: (agentId: number, removeWorkspace: boolean) => Promise<void>
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'files',    label: 'Files' },
  { id: 'tools',    label: 'Tools' },
  { id: 'models',   label: 'Models' },
  { id: 'channels', label: 'Channels' },
  { id: 'cron',     label: 'Cron' },
  { id: 'soul',     label: 'SOUL' },
  { id: 'memory',   label: 'Memory' },
  { id: 'tasks',    label: 'Tasks' },
  { id: 'config',   label: 'Config' },
  { id: 'activity', label: 'Activity' },
] as const

function formatLastSeen(timestamp?: number): string {
  if (!timestamp) return 'Never'
  const diffMs = Date.now() - timestamp * 1000
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

export function AgentSquadDetail({
  agent,
  onClose,
  onUpdate,
  onStatusUpdate,
  onWakeAgent,
  onDelete,
}: AgentSquadDetailProps) {
  const [agentState, setAgentState] = useState<AgentWithExtras>(agent as AgentWithExtras)
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    role: agent.role,
    session_key: agent.session_key || '',
    soul_content: agent.soul_content || '',
    working_memory: (agent as any).working_memory || '',
    model: (() => {
      const p = (agent as any).config?.model?.primary
      return (typeof p === 'string' ? p : p?.primary) || ''
    })(),
  })
  const [workspaceFiles, setWorkspaceFiles] = useState({ identityMd: '', agentMd: '' })
  const [soulTemplates, setSoulTemplates] = useState<SoulTemplate[]>([])
  const [heartbeatData, setHeartbeatData] = useState<HeartbeatResponse | null>(null)
  const [loadingHeartbeat, setLoadingHeartbeat] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const deleteMenuRef = useRef<HTMLDivElement>(null)

  // Close delete dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deleteBusy) return
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
        setShowDeleteMenu(false)
      }
    }
    if (showDeleteMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDeleteMenu, deleteBusy])

  // Sync local state when parent passes a new agent
  useEffect(() => {
    setAgentState(agent as AgentWithExtras)
    setFormData({
      role: agent.role,
      session_key: agent.session_key || '',
      soul_content: agent.soul_content || '',
      working_memory: (agent as any).working_memory || '',
      model: (() => {
        const p = (agent as any).config?.model?.primary
        return (typeof p === 'string' ? p : p?.primary) || ''
      })(),
    })
  }, [agent])

  // Load full agent data (soul, memory, files) on open
  useEffect(() => {
    const loadCanonicalAgentData = async () => {
      try {
        const [agentRes, soulRes, memoryRes, filesRes] = await Promise.all([
          fetch(`/api/agents/${agent.id}`),
          fetch(`/api/agents/${agent.id}/soul`),
          fetch(`/api/agents/${agent.id}/memory`),
          fetch(`/api/agents/${agent.id}/files`),
        ])

        if (agentRes.ok) {
          const payload = await agentRes.json()
          if (payload?.agent) {
            const freshAgent = payload.agent as AgentWithExtras
            setAgentState((prev) => ({ ...prev, ...freshAgent }))
            setFormData((prev) => ({
              ...prev,
              role: freshAgent.role || prev.role,
              session_key: freshAgent.session_key || '',
              model: (freshAgent as any).config?.model?.primary || prev.model,
            }))
          }
        }

        if (soulRes.ok) {
          const payload = await soulRes.json()
          setFormData((prev) => ({ ...prev, soul_content: String(payload?.soul_content || '') }))
        }

        if (memoryRes.ok) {
          const payload = await memoryRes.json()
          setFormData((prev) => ({ ...prev, working_memory: String(payload?.working_memory || '') }))
        }

        if (filesRes.ok) {
          const payload = await filesRes.json()
          setWorkspaceFiles({
            identityMd: String(payload?.files?.['identity.md']?.content || ''),
            agentMd: String(payload?.files?.['agent.md']?.content || ''),
          })
        }
      } catch (error) {
        log.error('Failed to load canonical agent data:', error)
      }
    }

    loadCanonicalAgentData()
  }, [agent.id])

  // Load SOUL templates when tab is active
  useEffect(() => {
    if (activeTab !== 'soul') return
    const loadTemplates = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/soul`, {
          method: 'PATCH',
          signal: AbortSignal.timeout(8000),
        })
        if (response.ok) {
          const data = await response.json()
          setSoulTemplates(data.templates || [])
        }
      } catch (error) {
        log.error('Failed to load SOUL templates:', error)
      }
    }
    loadTemplates()
  }, [activeTab, agent.name])

  const performHeartbeat = async () => {
    setLoadingHeartbeat(true)
    try {
      const response = await fetch(`/api/agents/${agent.name}/heartbeat`, { signal: AbortSignal.timeout(8000) })
      if (response.ok) {
        setHeartbeatData(await response.json())
      }
    } catch (error) {
      log.error('Failed to perform heartbeat:', error)
    } finally {
      setLoadingHeartbeat(false)
    }
  }

  const handleSave = async () => {
    setSaveBusy(true)
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentState.name, ...formData }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error('Failed to update agent')
      setEditing(false)
      onUpdate()
    } catch (error) {
      log.error('Failed to update agent:', error)
    } finally {
      setSaveBusy(false)
    }
  }

  const handleSoulSave = async (content: string, templateName?: string) => {
    try {
      const response = await fetch(`/api/agents/${agentState.id}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul_content: content, template_name: templateName }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error('Failed to update SOUL')
      setFormData(prev => ({ ...prev, soul_content: content }))
      setAgentState(prev => ({ ...prev, soul_content: content }))
      onUpdate()
    } catch (error) {
      log.error('Failed to update SOUL:', error)
    }
  }

  const handleMemorySave = async (content: string, append: boolean = false) => {
    try {
      const response = await fetch(`/api/agents/${agentState.id}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_memory: content, append }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error('Failed to update memory')
      const data = await response.json()
      setFormData(prev => ({ ...prev, working_memory: data.working_memory }))
      setAgentState(prev => ({ ...prev, working_memory: data.working_memory }))
      onUpdate()
    } catch (error) {
      log.error('Failed to update memory:', error)
    }
  }

  const handleWorkspaceFileSave = async (file: 'identity.md' | 'agent.md', content: string) => {
    const response = await fetch(`/api/agents/${agentState.id}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, content }),
      signal: AbortSignal.timeout(8000),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error || `Failed to save ${file}`)
    }
    setWorkspaceFiles((prev) => ({
      ...prev,
      ...(file === 'identity.md' ? { identityMd: content } : { agentMd: content }),
    }))
  }

  const handleDelete = async (removeWorkspace: boolean) => {
    const scope = removeWorkspace ? 'agent and workspace' : 'agent'
    if (!window.confirm(`Delete ${scope} for "${agentState.name}"? This cannot be undone.`)) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await onDelete(agentState.id, removeWorkspace)
      onClose()
    } catch (error: unknown) {
      setDeleteError(getErrorMessage(error) || `Failed to delete ${scope}`)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/80 rounded-lg shadow-2xl shadow-black/40 max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 pt-5 pb-0 border-b border-border">
          <div className="flex justify-between items-center gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <AgentAvatar name={agent.name} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground leading-tight truncate">{agentState.name}</h3>
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${statusBadgeStyles[agentState.status]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusColors[agentState.status]}`} />
                    {agentState.status}
                  </span>
                  {agentState.session_key && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                      Session
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-muted-foreground">{agentState.role}</span>
                  <span className="text-xs text-muted-foreground/60">·</span>
                  <span className="text-xs text-muted-foreground/60">seen {formatLastSeen(agentState.last_seen)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Delete dropdown */}
              <div className="relative" ref={deleteMenuRef}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-rose-400"
                  title="Delete agent"
                  onClick={() => setShowDeleteMenu(prev => !prev)}
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12.67 4v9.33a1.33 1.33 0 0 1-1.34 1.34H4.67a1.33 1.33 0 0 1-1.34-1.34V4" />
                  </svg>
                </Button>
                {showDeleteMenu && (
                  <div className="absolute right-0 top-full mt-1 flex flex-col gap-1 bg-card border border-border rounded-md shadow-xl p-1.5 z-10 min-w-[180px]">
                    <button
                      onClick={() => handleDelete(false)}
                      disabled={deleteBusy}
                      className="text-left text-xs px-2.5 py-1.5 rounded text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                    >
                      {deleteBusy ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                          </svg>
                          Deleting...
                        </span>
                      ) : 'Delete agent'}
                    </button>
                    <button
                      onClick={() => handleDelete(true)}
                      disabled={deleteBusy}
                      className="text-left text-xs px-2.5 py-1.5 rounded text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                    >
                      {deleteBusy ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                          </svg>
                          Deleting...
                        </span>
                      ) : 'Delete agent + workspace'}
                    </button>
                  </div>
                )}
              </div>

              <Button
                onClick={onClose}
                aria-label="Close agent details"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </Button>
            </div>
          </div>

          {deleteError && (
            <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {deleteError}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex gap-0 overflow-x-auto -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'overview' && (
            <OverviewTab
              agent={agentState}
              editing={editing}
              formData={formData}
              setFormData={setFormData}
              onSave={handleSave}
              saveBusy={saveBusy}
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
              agent={agentState}
              soulContent={formData.soul_content}
              templates={soulTemplates}
              onSave={handleSoulSave}
            />
          )}
          {activeTab === 'memory' && (
            <MemoryTab
              agent={agentState}
              workingMemory={formData.working_memory}
              onSave={handleMemorySave}
            />
          )}
          {activeTab === 'tasks' && <TasksTab agent={agentState} />}
          {activeTab === 'config' && (
            <ConfigTab
              agent={agentState}
              workspaceFiles={workspaceFiles}
              onSaveWorkspaceFile={handleWorkspaceFileSave}
              onSave={onUpdate}
            />
          )}
          {activeTab === 'files' && <FilesTab agent={agentState} />}
          {activeTab === 'tools' && <ToolsTab agent={agentState} />}
          {activeTab === 'channels' && <ChannelsTab agent={agentState} />}
          {activeTab === 'cron' && <CronTab agent={agentState} />}
          {activeTab === 'models' && <ModelsTab agent={agentState} />}
          {activeTab === 'activity' && <ActivityTab agent={agentState} />}
        </div>
      </div>
    </div>
  )
}
