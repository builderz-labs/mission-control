'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import Link from 'next/link'

const log = createClientLogger('AgentDetailTabs')

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
  offline: '-',
  idle: 'o',
  busy: '~',
  error: '!',
}

// Overview Tab Component
export function OverviewTab({
  agent,
  editing,
  formData,
  setFormData,
  onSave,
  saveBusy,
  onStatusUpdate,
  onWakeAgent,
  onEdit,
  onCancel,
  heartbeatData,
  loadingHeartbeat,
  onPerformHeartbeat
}: {
  agent: Agent
  editing: boolean
  formData: any
  setFormData: (data: any) => void
  onSave: () => Promise<void>
  saveBusy?: boolean
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
  onEdit: () => void
  onCancel: () => void
  heartbeatData: HeartbeatResponse | null
  loadingHeartbeat: boolean
  onPerformHeartbeat: () => Promise<void>
}) {
  const t = useTranslations('agentDetail')
  const [messageFrom, setMessageFrom] = useState('system')
  const [directMessage, setDirectMessage] = useState('')
  const [messageStatus, setMessageStatus] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<Array<{ alias: string; description?: string }>>([])

  useEffect(() => {
    fetch('/api/status?action=models')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.models) setAvailableModels(data.models)
      })
      .catch(() => {})
  }, [])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!directMessage.trim()) return
    try {
      setMessageStatus(null)
      const response = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: messageFrom || 'system',
          to: agent.name,
          message: directMessage
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send message')
      setDirectMessage('')
      setMessageStatus(t('messageSent'))
      setTimeout(() => setMessageStatus(null), 2000)
    } catch (error) {
      setMessageStatus(t('messageFailed'))
    }
  }

  return (
    <div className="p-5">
      <div className="grid md:grid-cols-[1fr_1fr] gap-5">
        {/* Left Column — Agent Details */}
        <div className="space-y-4">
          {/* Status + Actions row */}
          <div className="flex items-center gap-2">
            {(['idle', 'busy', 'offline'] as const).map(status => (
              <button
                key={status}
                onClick={() => onStatusUpdate(agent.name, status)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  agent.status === status
                    ? status === 'idle' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : status === 'busy' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-500/20 text-slate-300 border-slate-500/40'
                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                }`}
              >
                {status}
              </button>
            ))}
            {agent.session_key && (
              <button
                onClick={() => onWakeAgent(agent.name, agent.session_key!)}
                className="ml-auto px-3 py-1 text-xs rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
              >
                Wake
              </button>
            )}
            <button
              onClick={onPerformHeartbeat}
              disabled={loadingHeartbeat}
              className="px-3 py-1 text-xs rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50 ml-auto"
              style={agent.session_key ? { marginLeft: 0 } : undefined}
            >
              {loadingHeartbeat ? '...' : t('heartbeat')}
            </button>
          </div>

          {heartbeatData && (
            <div className="text-xs text-muted-foreground bg-surface-1/30 rounded px-3 py-2">
              <span className={heartbeatData.status === 'HEARTBEAT_OK' ? 'text-green-400' : 'text-yellow-400'}>
                {heartbeatData.status}
              </span>
              {heartbeatData.total_items ? ` · ${t('workItems', { count: heartbeatData.total_items })}` : ''}
              {heartbeatData.message && ` · ${heartbeatData.message}`}
            </div>
          )}

          {/* Key fields */}
          <div className="space-y-3">
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('role')}</span>
              {editing ? (
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData((prev: any) => ({ ...prev, role: e.target.value }))}
                  className="bg-surface-1 text-foreground border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              ) : (
                <span className="text-foreground">{agent.role}</span>
              )}
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('model')}</span>
              {editing ? (
                <select
                  value={formData.model || ''}
                  onChange={(e) => setFormData((prev: any) => ({ ...prev, model: e.target.value }))}
                  className="bg-surface-1 text-foreground border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">{t('default')}</option>
                  {availableModels.map((m) => (
                    <option key={m.alias} value={m.alias}>{m.alias}</option>
                  ))}
                </select>
              ) : (
                <span className="text-foreground font-mono text-xs">
                  {(() => { const p = (agent as any).config?.model?.primary; const m = (agent as any).model; const v = typeof p === 'string' ? p : p?.primary; return v || (typeof m === 'string' ? m : m?.primary) || t('default') })()}
                </span>
              )}
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('sessionKey')}</span>
              {editing ? (
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData((prev: any) => ({ ...prev, session_key: e.target.value }))}
                  className="bg-surface-1 text-foreground border border-border rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder={t('sessionKeyPlaceholder')}
                />
              ) : (
                <span className="text-foreground font-mono text-xs">
                  {agent.session_key || <span className="text-muted-foreground/50">{t('notSet')}</span>}
                </span>
              )}
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('created')}</span>
              <span className="text-xs text-muted-foreground">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('updated')}</span>
              <span className="text-xs text-muted-foreground">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Task Stats — compact row */}
          {agent.taskStats && (
            <div className="flex gap-3 pt-1">
              <div className="text-center">
                <div className="text-lg font-semibold text-foreground">{agent.taskStats.total}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsTotal')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-blue-400">{agent.taskStats.assigned}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsAssigned')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsActive')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsDone')}</div>
              </div>
            </div>
          )}

          {/* Edit / Save */}
          <div className="flex gap-2 pt-1">
            {editing ? (
              <>
                <Button onClick={onSave} size="sm" disabled={saveBusy}>
                  {saveBusy ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                      </svg>
                      {t('saving')}
                    </span>
                  ) : t('save')}
                </Button>
                <Button onClick={onCancel} variant="secondary" size="sm" disabled={saveBusy}>{t('cancel')}</Button>
              </>
            ) : (
              <Button onClick={onEdit} variant="secondary" size="sm">{t('edit')}</Button>
            )}
          </div>
        </div>

        {/* Right Column — Direct Message */}
        <div className="border border-border rounded-lg p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-foreground">{t('message')}</h4>
            {messageStatus && (
              <span className={`text-xs ${messageStatus === 'Sent' ? 'text-green-400' : 'text-rose-400'}`}>
                {messageStatus}
              </span>
            )}
          </div>
          <form onSubmit={handleSendMessage} className="flex flex-col flex-1 gap-2">
            <input
              type="text"
              value={messageFrom}
              onChange={(e) => setMessageFrom(e.target.value)}
              className="bg-surface-1 text-foreground rounded px-2.5 py-1.5 text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder={t('from')}
            />
            <textarea
              value={directMessage}
              onChange={(e) => setDirectMessage(e.target.value)}
              className="flex-1 min-h-[80px] bg-surface-1 text-foreground rounded px-2.5 py-2 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
              placeholder={t('sendMessagePlaceholder', { name: agent.name })}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!directMessage.trim()}>
                {t('send')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// SOUL Tab Component
export function SoulTab({
  agent,
  soulContent,
  templates,
  onSave
}: {
  agent: Agent
  soulContent: string
  templates: SoulTemplate[]
  onSave: (content: string, templateName?: string) => Promise<void>
}) {
  const t = useTranslations('agentDetail')
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(soulContent)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  useEffect(() => {
    setContent(soulContent)
  }, [soulContent])

  const handleSave = async () => {
    await onSave(content)
    setEditing(false)
  }

  const handleLoadTemplate = async (templateName: string) => {
    try {
      const response = await fetch(`/api/agents/${agent.name}/soul?template=${templateName}`, {
        method: 'PATCH'
      })
      if (response.ok) {
        const data = await response.json()
        setContent(data.content)
        setSelectedTemplate(templateName)
      }
    } catch (error) {
      log.error('Failed to load template:', error)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-foreground">{t('soulConfiguration')}</h4>
        <div className="flex gap-2">
          {!editing && (
            <Button
              onClick={() => setEditing(true)}
              size="sm"
            >
              {t('editSoul')}
            </Button>
          )}
        </div>
      </div>

      {/* Template Selector */}
      {editing && templates.length > 0 && (
        <div className="p-4 bg-surface-1/50 rounded-lg">
          <h5 className="text-sm font-medium text-foreground mb-2">{t('loadTemplate')}</h5>
          <div className="flex gap-2">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">{t('selectTemplate')}</option>
              {templates.map(template => (
                <option key={template.name} value={template.name}>
                  {template.description} ({t('chars', { count: template.size })})
                </option>
              ))}
            </select>
            <Button
              onClick={() => selectedTemplate && handleLoadTemplate(selectedTemplate)}
              disabled={!selectedTemplate}
              variant="success"
            >
              {t('load')}
            </Button>
          </div>
        </div>
      )}

      {/* SOUL Editor */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          {t('soulContent', { count: content.length })}
        </label>
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
            placeholder={t('soulEditorPlaceholder')}
          />
        ) : (
          <div className="bg-surface-1/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-muted-foreground italic">{t('noSoulContent')}</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <Button
            onClick={handleSave}
            className="flex-1"
          >
            {t('saveSoul')}
          </Button>
          <Button
            onClick={() => {
              setEditing(false)
              setContent(soulContent)
            }}
            variant="secondary"
            className="flex-1"
          >
            {t('cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}

// Memory Tab Component
export function MemoryTab({
  agent,
  workingMemory,
  onSave
}: {
  agent: Agent
  workingMemory: string
  onSave: (content: string, append?: boolean) => Promise<void>
}) {
  const t = useTranslations('agentDetail')
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(workingMemory)
  const [appendMode, setAppendMode] = useState(false)
  const [newEntry, setNewEntry] = useState('')

  useEffect(() => {
    setContent(workingMemory)
  }, [workingMemory])

  const handleSave = async () => {
    if (appendMode && newEntry.trim()) {
      await onSave(newEntry, true)
      setNewEntry('')
      setAppendMode(false)
    } else {
      await onSave(content)
    }
    setEditing(false)
  }

  const handleClear = async () => {
    if (confirm(t('confirmClearMemory'))) {
      await onSave('')
      setContent('')
      setEditing(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('workingMemory')}</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {t('workingMemoryDesc')}
          </p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <Button
                onClick={() => {
                  setAppendMode(true)
                  setEditing(true)
                }}
                variant="success"
                size="sm"
              >
                {t('addEntry')}
              </Button>
              <Button
                onClick={() => setEditing(true)}
                size="sm"
              >
                {t('editMemory')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
        <strong className="text-blue-200">{t('memoryBannerTitle')}</strong>{' '}
        {t('memoryBannerDesc')}{' '}
        <Link href="/memory" className="text-blue-400 underline hover:text-blue-300">{t('memoryBrowserLink')}</Link> {t('memoryBannerPage')}
      </div>

      {/* Memory Content */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          {t('memoryContent', { count: content.length })}
        </label>
        
        {editing && appendMode ? (
          <div className="space-y-2">
            <div className="bg-surface-1/30 rounded p-4 max-h-40 overflow-y-auto">
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            </div>
            <textarea
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              rows={5}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder={t('addMemoryEntryPlaceholder')}
            />
          </div>
        ) : editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={15}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
            placeholder={t('workingMemoryPlaceholder')}
          />
        ) : (
          <div className="bg-surface-1/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-muted-foreground italic">{t('noWorkingMemory')}</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <Button
            onClick={handleSave}
            className="flex-1"
          >
            {appendMode ? t('addEntry') : t('saveMemory')}
          </Button>
          <Button
            onClick={() => {
              setEditing(false)
              setAppendMode(false)
              setContent(workingMemory)
              setNewEntry('')
            }}
            variant="secondary"
            className="flex-1"
          >
            {t('cancel')}
          </Button>
          {!appendMode && (
            <Button
              onClick={handleClear}
              variant="destructive"
            >
              {t('clearAll')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// Tasks Tab Component
export function TasksTab({ agent }: { agent: Agent }) {
  const t = useTranslations('agentDetail')
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const response = await fetch(`/api/tasks?assigned_to=${agent.name}`)
        if (response.ok) {
          const data = await response.json()
          setTasks(data.tasks || [])
        }
      } catch (error) {
        log.error('Failed to fetch tasks:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchTasks()
  }, [agent.name])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label={t('loadingTasks')} />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-medium text-foreground">{t('assignedTasks')}</h4>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="2" width="10" height="12" rx="1" />
              <path d="M6 6h4M6 9h3" />
            </svg>
          </div>
          <p className="text-sm">{t('noTasksAssigned')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="bg-surface-1/50 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <Link href={`/tasks?taskId=${task.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                    {task.title}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-1">
                    {task.ticket_ref || `Task #${task.id}`}
                    {task.project_name ? ` · ${task.project_name}` : ''}
                  </div>
                  {task.description && (
                    <p className="text-foreground/80 text-sm mt-1">{task.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-md font-medium ${
                    task.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                    task.status === 'done' ? 'bg-green-500/20 text-green-400' :
                    task.status === 'review' ? 'bg-blue-500/20 text-blue-400' :
                    task.status === 'quality_review' ? 'bg-indigo-500/20 text-indigo-400' :
                    'bg-secondary text-muted-foreground'
                  }`}>
                    {task.status}
                  </span>
                  <span className={`px-2 py-1 text-xs rounded-md font-medium ${
                    task.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                    task.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-secondary text-muted-foreground'
                  }`}>
                    {task.priority}
                  </span>
                </div>
              </div>
              
              {task.due_date && (
                <div className="text-xs text-muted-foreground mt-2">
                  {t('due')}: {new Date(task.due_date * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Activity Tab Component
export function ActivityTab({ agent }: { agent: Agent }) {
  const t = useTranslations('agentDetail')
  const [activities, setActivities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const response = await fetch(`/api/activities?actor=${agent.name}&limit=50`)
        if (response.ok) {
          const data = await response.json()
          setActivities(data.activities || [])
        }
      } catch (error) {
        log.error('Failed to fetch activities:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchActivities()
  }, [agent.name])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label={t('loadingActivity')} />
      </div>
    )
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'agent_status_change': return '~'
      case 'task_created': return '+'
      case 'task_updated': return '>'
      case 'comment_added': return '#'
      case 'agent_heartbeat': return '*'
      case 'agent_soul_updated': return '@'
      case 'agent_memory_updated': return '='
      default: return '.'
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-medium text-foreground">{t('recentActivity')}</h4>
      
      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M2 8h8M2 12h10" />
            </svg>
          </div>
          <p className="text-sm">{t('noRecentActivity')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(activity => (
            <div key={activity.id} className="bg-surface-1/50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl">{getActivityIcon(activity.type)}</div>
                <div className="flex-1">
                  <p className="text-foreground">{activity.description}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{activity.type}</span>
                    <span>•</span>
                    <span>{new Date(activity.created_at * 1000).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== NEW COMPONENTS: CreateAgentModal (template wizard) + ConfigTab =====
// These replace the old CreateAgentModal and add the Config tab

// Template data for the wizard (client-side mirror of agent-templates.ts)
const TEMPLATES = [
  { type: 'orchestrator', label: 'Orchestrator', emoji: '\ud83e\udded', description: 'Primary coordinator with full tool access', modelTier: 'opus' as const, toolCount: 23, theme: 'operator strategist' },
  { type: 'developer', label: 'Developer', emoji: '\ud83d\udee0\ufe0f', description: 'Full-stack builder with Docker bridge', modelTier: 'sonnet' as const, toolCount: 21, theme: 'builder engineer' },
  { type: 'specialist-dev', label: 'Specialist Dev', emoji: '\u2699\ufe0f', description: 'Focused developer for specific domains', modelTier: 'sonnet' as const, toolCount: 15, theme: 'specialist developer' },
  { type: 'reviewer', label: 'Reviewer / QA', emoji: '\ud83d\udd2c', description: 'Read-only code review and quality gates', modelTier: 'haiku' as const, toolCount: 7, theme: 'quality reviewer' },
  { type: 'researcher', label: 'Researcher', emoji: '\ud83d\udd0d', description: 'Browser and web access for research', modelTier: 'sonnet' as const, toolCount: 8, theme: 'research analyst' },
  { type: 'content-creator', label: 'Content Creator', emoji: '\u270f\ufe0f', description: 'Write and edit for content generation', modelTier: 'haiku' as const, toolCount: 9, theme: 'content creator' },
  { type: 'security-auditor', label: 'Security Auditor', emoji: '\ud83d\udee1\ufe0f', description: 'Read-only + bash for security scanning', modelTier: 'sonnet' as const, toolCount: 10, theme: 'security auditor' },
]

const MODEL_TIER_COLORS: Record<string, string> = {
  opus: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  sonnet: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  haiku: 'bg-green-500/20 text-green-400 border-green-500/30',
}

const MODEL_TIER_LABELS: Record<string, string> = {
  opus: 'Opus $$$',
  sonnet: 'Sonnet $$',
  haiku: 'Haiku $',
}

const DEFAULT_MODEL_BY_TIER: Record<'opus' | 'sonnet' | 'haiku', string> = {
  opus: 'anthropic/claude-opus-4-5',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'anthropic/claude-haiku-4-5',
}

// Enhanced Create Agent Modal with Template Wizard
export function CreateAgentModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const t = useTranslations('agentDetail')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [formData, setFormData] = useState({
    name: '',
    id: '',
    role: '',
    emoji: '',
    modelTier: 'sonnet' as 'opus' | 'sonnet' | 'haiku',
    modelPrimary: DEFAULT_MODEL_BY_TIER.sonnet,
    workspaceAccess: 'rw' as 'rw' | 'ro' | 'none',
    sandboxMode: 'all' as 'all' | 'non-main',
    dockerNetwork: 'none' as 'none' | 'bridge',
    session_key: '',
    write_to_gateway: true,
    provision_openclaw_workspace: true,
  })
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  type ProgressStep = { label: string; status: 'pending' | 'active' | 'done' | 'error'; error?: string }
  const [progressSteps, setProgressSteps] = useState<ProgressStep[] | null>(null)

  const selectedTemplateData = TEMPLATES.find(t => t.type === selectedTemplate)

  // Auto-generate kebab-case ID from name
  const updateName = (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setFormData(prev => ({ ...prev, name, id }))
  }

  useEffect(() => {
    const loadAvailableModels = async () => {
      try {
        const response = await fetch('/api/status?action=models')
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((model: any) => String(model.name || model.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Keep modal usable without model suggestions.
      }
    }
    loadAvailableModels()
  }, [])

  // When template is selected, pre-fill form
  const selectTemplate = (type: string | null) => {
    setSelectedTemplate(type)
    if (type) {
      const tmpl = TEMPLATES.find(t => t.type === type)
      if (tmpl) {
        setFormData(prev => ({
          ...prev,
          role: tmpl.theme,
          emoji: tmpl.emoji,
          modelTier: tmpl.modelTier,
          modelPrimary: DEFAULT_MODEL_BY_TIER[tmpl.modelTier],
          workspaceAccess: type === 'researcher' || type === 'content-creator' ? 'none' : type === 'reviewer' || type === 'security-auditor' ? 'ro' : 'rw',
          sandboxMode: type === 'orchestrator' ? 'non-main' : 'all',
          dockerNetwork: type === 'developer' || type === 'specialist-dev' ? 'bridge' : 'none',
        }))
      }
    }
  }

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }
    setIsCreating(true)
    setError(null)

    // Build progress steps based on checkbox state
    const steps: ProgressStep[] = [
      { label: t('stepCreatingRecord'), status: 'pending' },
    ]
    if (formData.write_to_gateway) {
      steps.push({ label: t('stepWritingGateway'), status: 'pending' })
    }
    if (formData.provision_openclaw_workspace) {
      steps.push({ label: t('stepProvisioningWorkspace'), status: 'pending' })
    }
    setProgressSteps([...steps])

    // Animate steps to 'active' one-by-one with stagger
    const animateSteps = async () => {
      for (let i = 0; i < steps.length; i++) {
        await new Promise(r => setTimeout(r, 300))
        steps[i].status = 'active'
        setProgressSteps([...steps])
      }
    }

    try {
      const primaryModel = formData.modelPrimary.trim() || DEFAULT_MODEL_BY_TIER[formData.modelTier]

      // Run animation and fetch concurrently
      const [response] = await Promise.all([
        fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            openclaw_id: formData.id || undefined,
            role: formData.role,
            session_key: formData.session_key || undefined,
            template: selectedTemplate || undefined,
            write_to_gateway: formData.write_to_gateway,
            provision_openclaw_workspace: formData.provision_openclaw_workspace,
            gateway_config: {
              model: { primary: primaryModel },
              identity: { name: formData.name, theme: formData.role, emoji: formData.emoji },
              sandbox: {
                mode: formData.sandboxMode,
                workspaceAccess: formData.workspaceAccess,
                scope: 'agent',
                ...(formData.dockerNetwork === 'bridge' ? { docker: { network: 'bridge' } } : {}),
              },
            },
          }),
        }),
        animateSteps(),
      ])

      if (!response.ok) {
        const data = await response.json()
        const errMsg = data.error || 'Failed to create agent'
        // Determine which step failed based on error message
        const failIdx =
          /provision|openclaw/i.test(errMsg) ? steps.findIndex(s => s.label.includes('Provisioning')) :
          /gateway/i.test(errMsg) ? steps.findIndex(s => s.label.includes('gateway')) :
          0
        const idx = failIdx >= 0 ? failIdx : 0
        steps[idx].status = 'error'
        steps[idx].error = errMsg
        // Mark later steps back to pending
        for (let i = idx + 1; i < steps.length; i++) steps[i].status = 'pending'
        setProgressSteps([...steps])
        return
      }

      // All done
      for (const s of steps) s.status = 'done'
      setProgressSteps([...steps])
      setTimeout(() => { onCreated(); onClose() }, 1500)
    } catch (err: any) {
      // Network/unexpected error — fail first step
      steps[0].status = 'error'
      steps[0].error = err.message || 'Unexpected error'
      for (let i = 1; i < steps.length; i++) steps[i].status = 'pending'
      setProgressSteps([...steps])
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border flex-shrink-0">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold text-foreground">{t('createNewAgent')}</h3>
              <div className="flex gap-3 mt-2">
                {[1, 2, 3].map(s => (
                  <div key={s} className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      step === s ? 'bg-primary text-primary-foreground' :
                      step > s ? 'bg-green-500/20 text-green-400' :
                      'bg-surface-2 text-muted-foreground'
                    }`}>
                      {step > s ? '\u2713' : s}
                    </div>
                    <span className={`text-xs ${step === s ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {s === 1 ? t('stepTemplate') : s === 2 ? t('stepConfigure') : t('stepReview')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">x</Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 mb-4 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Choose Template */}
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              {TEMPLATES.map(tmpl => (
                <Button
                  key={tmpl.type}
                  onClick={() => { selectTemplate(tmpl.type); setStep(2) }}
                  variant="outline"
                  className={`p-4 h-auto text-left flex flex-col items-start ${
                    selectedTemplate === tmpl.type ? 'border-primary bg-primary/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{tmpl.emoji}</span>
                    <span className="font-semibold text-foreground">{tmpl.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{tmpl.description}</p>
                  <div className="flex gap-2">
                    <span className={`px-2 py-0.5 text-xs rounded border ${MODEL_TIER_COLORS[tmpl.modelTier]}`}>
                      {MODEL_TIER_LABELS[tmpl.modelTier]}
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded bg-surface-2 text-muted-foreground">
                      {t('toolCount', { count: tmpl.toolCount })}
                    </span>
                  </div>
                </Button>
              ))}
              {/* Custom option */}
              <Button
                onClick={() => { selectTemplate(null); setStep(2) }}
                variant="outline"
                className={`p-4 h-auto text-left flex flex-col items-start border-dashed ${
                  selectedTemplate === null ? 'border-primary' : ''
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">+</span>
                  <span className="font-semibold text-foreground">Custom</span>
                </div>
                <p className="text-xs text-muted-foreground">{t('customDesc')}</p>
              </Button>
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('displayName')}</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateName(e.target.value)}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder={t('displayNamePlaceholder')}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('agentId')}</label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
                    placeholder="frontend-dev"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('roleTheme')}</label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="builder engineer"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('emoji')}</label>
                  <input
                    type="text"
                    value={formData.emoji}
                    onChange={(e) => setFormData(prev => ({ ...prev, emoji: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="e.g. \ud83d\udee0\ufe0f"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">{t('modelTier')}</label>
                <div className="flex gap-2">
                  {(['opus', 'sonnet', 'haiku'] as const).map(tier => (
                    <Button
                      key={tier}
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        modelTier: tier,
                        modelPrimary: DEFAULT_MODEL_BY_TIER[tier],
                      }))}
                      variant={formData.modelTier === tier ? 'outline' : 'secondary'}
                      className={`flex-1 ${
                        formData.modelTier === tier ? MODEL_TIER_COLORS[tier] : ''
                      }`}
                    >
                      {MODEL_TIER_LABELS[tier]}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">{t('primaryModel')}</label>
                <input
                  type="text"
                  value={formData.modelPrimary}
                  onChange={(e) => setFormData(prev => ({ ...prev, modelPrimary: e.target.value }))}
                  list="create-agent-model-suggestions"
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
                  placeholder={DEFAULT_MODEL_BY_TIER[formData.modelTier]}
                />
                <datalist id="create-agent-model-suggestions">
                  {availableModels.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('workspace')}</label>
                  <select
                    value={formData.workspaceAccess}
                    onChange={(e) => setFormData(prev => ({ ...prev, workspaceAccess: e.target.value as any }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="rw">{t('readWrite')}</option>
                    <option value="ro">{t('readOnly')}</option>
                    <option value="none">{t('none')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('sandbox')}</label>
                  <select
                    value={formData.sandboxMode}
                    onChange={(e) => setFormData(prev => ({ ...prev, sandboxMode: e.target.value as any }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="all">{t('sandboxAll')}</option>
                    <option value="non-main">{t('sandboxNonMain')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('network')}</label>
                  <select
                    value={formData.dockerNetwork}
                    onChange={(e) => setFormData(prev => ({ ...prev, dockerNetwork: e.target.value as any }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="none">{t('networkIsolated')}</option>
                    <option value="bridge">{t('networkBridge')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">{t('sessionKeyOptional')}</label>
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder={t('sessionKeyPlaceholder')}
                />
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="space-y-4">
              {progressSteps ? (
                /* Progress view */
                <div className="space-y-3 py-4">
                  <h4 className="text-sm font-medium text-muted-foreground mb-4">{t('settingUpAgent')}</h4>
                  {progressSteps.map((ps, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                        {ps.status === 'active' && (
                          <span className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        )}
                        {ps.status === 'done' && (
                          <span className="text-green-400 text-sm font-bold">✓</span>
                        )}
                        {ps.status === 'error' && (
                          <span className="text-red-400 text-sm font-bold">✕</span>
                        )}
                        {ps.status === 'pending' && (
                          <span className="inline-block w-3 h-3 rounded-full border border-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${
                          ps.status === 'error' ? 'text-red-400' :
                          ps.status === 'done' ? 'text-green-400' :
                          ps.status === 'active' ? 'text-foreground' :
                          'text-muted-foreground'
                        }`}>{ps.label}</span>
                        {ps.error && (
                          <p className="text-xs text-red-400/80 mt-1">{ps.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {progressSteps.every(s => s.status === 'done') && (
                    <p className="text-sm text-green-400 mt-4">{t('agentCreatedSuccess')}</p>
                  )}
                </div>
              ) : (
                /* Review summary */
                <>
                  <div className="bg-surface-1/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{formData.emoji || (selectedTemplateData?.emoji || '?')}</span>
                      <div>
                        <h4 className="text-lg font-bold text-foreground">{formData.name || 'Unnamed'}</h4>
                        <p className="text-muted-foreground text-sm">{formData.role}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground">{t('idLabel')}:</span> <span className="text-foreground font-mono">{formData.id}</span></div>
                      <div><span className="text-muted-foreground">{t('templateLabel')}:</span> <span className="text-foreground">{selectedTemplateData?.label || t('custom')}</span></div>
                      <div><span className="text-muted-foreground">{t('model')}:</span> <span className={`px-2 py-0.5 rounded text-xs ${MODEL_TIER_COLORS[formData.modelTier]}`}>{MODEL_TIER_LABELS[formData.modelTier]}</span></div>
                      <div><span className="text-muted-foreground">{t('toolsLabel')}:</span> <span className="text-foreground">{selectedTemplateData?.toolCount || t('custom')}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground">{t('primaryModel')}:</span> <span className="text-foreground font-mono">{formData.modelPrimary || DEFAULT_MODEL_BY_TIER[formData.modelTier]}</span></div>
                      <div><span className="text-muted-foreground">{t('workspace')}:</span> <span className="text-foreground">{formData.workspaceAccess}</span></div>
                      <div><span className="text-muted-foreground">{t('sandbox')}:</span> <span className="text-foreground">{formData.sandboxMode}</span></div>
                      <div><span className="text-muted-foreground">{t('network')}:</span> <span className="text-foreground">{formData.dockerNetwork}</span></div>
                      {formData.session_key && (
                        <div><span className="text-muted-foreground">{t('session')}:</span> <span className="text-foreground font-mono">{formData.session_key}</span></div>
                      )}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.write_to_gateway}
                      onChange={(e) => setFormData(prev => ({ ...prev, write_to_gateway: e.target.checked }))}
                      className="w-4 h-4 rounded border-border"
                    />
                    <span className="text-sm text-foreground">{t('addToGateway')}</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.provision_openclaw_workspace}
                      onChange={(e) => setFormData(prev => ({ ...prev, provision_openclaw_workspace: e.target.checked }))}
                      className="w-4 h-4 rounded border-border"
                    />
                    <span className="text-sm text-foreground">{t('provisionWorkspace')}</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex gap-3 flex-shrink-0">
          {progressSteps ? (
            /* During/after progress */
            progressSteps.some(s => s.status === 'error') ? (
              <>
                <div className="flex-1" />
                <Button onClick={() => { setProgressSteps(null); handleCreate() }} size="lg">
                  {t('retry')}
                </Button>
                <Button onClick={onClose} variant="secondary">
                  {t('close')}
                </Button>
              </>
            ) : progressSteps.every(s => s.status === 'done') ? (
              <>
                <div className="flex-1" />
                <span className="text-sm text-muted-foreground self-center">{t('closing')}</span>
              </>
            ) : (
              /* In-progress — no buttons */
              <div className="flex-1" />
            )
          ) : (
            /* Normal navigation */
            <>
              {step > 1 && (
                <Button
                  onClick={() => setStep((step - 1) as 1 | 2)}
                  variant="secondary"
                >
                  {t('back')}
                </Button>
              )}
              <div className="flex-1" />
              {step < 3 ? (
                <Button
                  onClick={() => setStep((step + 1) as 2 | 3)}
                  disabled={step === 2 && !formData.name.trim()}
                  size="lg"
                >
                  {t('next')}
                </Button>
              ) : (
                <Button
                  onClick={handleCreate}
                  disabled={isCreating || !formData.name.trim()}
                  size="lg"
                >
                  {t('createAgent')}
                </Button>
              )}
              <Button onClick={onClose} variant="secondary">
                {t('cancel')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Config Tab Component for Agent Detail Modal
export function ConfigTab({
  agent,
  workspaceFiles,
  onSaveWorkspaceFile,
  onSave
}: {
  agent: Agent & { config?: any }
  workspaceFiles?: { identityMd: string; agentMd: string }
  onSaveWorkspaceFile?: (file: 'identity.md' | 'agent.md', content: string) => Promise<void>
  onSave: () => void
}) {
  const t = useTranslations('agentDetail')
  const [config, setConfig] = useState<any>(agent.config || {})
  const [editing, setEditing] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [newFallbackModel, setNewFallbackModel] = useState('')
  const [newAllowTool, setNewAllowTool] = useState('')
  const [newDenyTool, setNewDenyTool] = useState('')
  const [identityMdInput, setIdentityMdInput] = useState('')
  const [agentMdInput, setAgentMdInput] = useState('')
  const [savingIdentityMd, setSavingIdentityMd] = useState(false)
  const [savingAgentMd, setSavingAgentMd] = useState(false)
  const [workspaceDocs, setWorkspaceDocs] = useState<Array<{ name: string; exists: boolean; content: string }>>([])
  const [loadingWorkspaceDocs, setLoadingWorkspaceDocs] = useState(false)

  useEffect(() => {
    setConfig(agent.config || {})
    setJsonInput(JSON.stringify(agent.config || {}, null, 2))
  }, [agent.config])

  useEffect(() => {
    setIdentityMdInput(String(workspaceFiles?.identityMd || ''))
    setAgentMdInput(String(workspaceFiles?.agentMd || ''))
  }, [workspaceFiles?.identityMd, workspaceFiles?.agentMd])

  useEffect(() => {
    const loadWorkspaceDocs = async () => {
      setLoadingWorkspaceDocs(true)
      try {
        const response = await fetch(`/api/agents/${agent.id}/files`)
        if (!response.ok) return
        const payload = await response.json()
        const entries = Object.entries(payload?.files || {}).map(([name, value]: [string, any]) => ({
          name,
          exists: Boolean(value?.exists),
          content: String(value?.content || ''),
        }))
        setWorkspaceDocs(entries)
      } catch {
        setWorkspaceDocs([])
      } finally {
        setLoadingWorkspaceDocs(false)
      }
    }
    loadWorkspaceDocs()
  }, [agent.id])

  useEffect(() => {
    const loadAvailableModels = async () => {
      try {
        const response = await fetch('/api/status?action=models')
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((model: any) => String(model.name || model.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Ignore model suggestions if unavailable.
      }
    }
    loadAvailableModels()
  }, [])

  const updateModelConfig = (updater: (current: { primary?: string; fallbacks?: string[] }) => { primary?: string; fallbacks?: string[] }) => {
    setConfig((prev: any) => {
      const nextModel = updater({ ...(prev?.model || {}) })
      const dedupedFallbacks = [...new Set((nextModel.fallbacks || []).map((value) => (value || '').trim()).filter(Boolean))]
      return {
        ...prev,
        model: {
          ...nextModel,
          fallbacks: dedupedFallbacks,
        },
      }
    })
  }

  const addFallbackModel = () => {
    const trimmed = newFallbackModel.trim()
    if (!trimmed) return
    updateModelConfig((current) => ({
      ...current,
      fallbacks: [...(current.fallbacks || []), trimmed],
    }))
    setNewFallbackModel('')
  }

  const updateIdentityField = (field: string, value: string) => {
    setConfig((prev: any) => ({
      ...prev,
      identity: { ...(prev.identity || {}), [field]: value },
    }))
  }

  const updateSandboxField = (field: string, value: string) => {
    setConfig((prev: any) => ({
      ...prev,
      sandbox: { ...(prev.sandbox || {}), [field]: value },
    }))
  }

  const addTool = (list: 'allow' | 'deny', value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setConfig((prev: any) => {
      const tools = prev.tools || {}
      const existing = Array.isArray(tools[list]) ? tools[list] : []
      if (existing.includes(trimmed)) return prev
      return { ...prev, tools: { ...tools, [list]: [...existing, trimmed] } }
    })
  }

  const removeTool = (list: 'allow' | 'deny', index: number) => {
    setConfig((prev: any) => {
      const tools = prev.tools || {}
      const existing = Array.isArray(tools[list]) ? [...tools[list]] : []
      existing.splice(index, 1)
      return { ...prev, tools: { ...tools, [list]: existing } }
    })
  }

  const saveWorkspaceFile = async (file: 'identity.md' | 'agent.md') => {
    if (!onSaveWorkspaceFile) return
    const content = file === 'identity.md' ? identityMdInput : agentMdInput
    if (file === 'identity.md') {
      setSavingIdentityMd(true)
    } else {
      setSavingAgentMd(true)
    }
    setError(null)
    try {
      await onSaveWorkspaceFile(file, content)
    } catch (err: any) {
      setError(err?.message || `Failed to save ${file}`)
    } finally {
      if (file === 'identity.md') {
        setSavingIdentityMd(false)
      } else {
        setSavingAgentMd(false)
      }
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (!showJson) {
        const primary = String(config?.model?.primary || '').trim()
        if (!primary) {
          throw new Error('Primary model is required')
        }
      }
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_config: showJson ? JSON.parse(jsonInput) : config,
          write_to_gateway: true,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save')
      setEditing(false)
      onSave()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const model = config.model || {}
  const identity = config.identity || {}
  const sandbox = config.sandbox || {}
  const tools = config.tools || {}
  const subagents = config.subagents || {}
  const memorySearch = config.memorySearch || {}
  const sandboxMode = sandbox.mode || sandbox.sandboxMode || sandbox.sandbox_mode || config.sandboxMode || 'not configured'
  const sandboxWorkspace = sandbox.workspaceAccess || sandbox.workspace_access || sandbox.workspace || config.workspaceAccess || 'not configured'
  const sandboxNetwork = sandbox?.docker?.network || sandbox.network || sandbox.dockerNetwork || sandbox.docker_network || 'none'
  const identityName = identity.name || agent.name || 'not configured'
  const identityTheme = identity.theme || agent.role || 'not configured'
  const identityEmoji = identity.emoji || '?'
  const identityPreview = identity.content || ''
  const toolAllow = Array.isArray(tools.allow) ? tools.allow : []
  const toolDeny = Array.isArray(tools.deny) ? tools.deny : []
  const toolRawPreview = typeof tools.raw === 'string' ? tools.raw : ''
  const modelPrimary = model.primary || ''
  const modelFallbacks = Array.isArray(model.fallbacks) ? model.fallbacks : []

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-foreground">{t('openclawConfig')}</h4>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowJson(!showJson)}
            variant="secondary"
            size="xs"
          >
            {showJson ? t('structured') : 'JSON'}
          </Button>
          {!editing && (
            <Button
              onClick={() => setEditing(true)}
              size="sm"
            >
              Edit
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {config.openclawId && (
        <div className="text-xs text-muted-foreground">
          OpenClaw ID: <span className="font-mono text-foreground">{config.openclawId}</span>
          {config.isDefault && <span className="ml-2 px-1.5 py-0.5 bg-primary/20 text-primary rounded text-xs">{t('default')}</span>}
        </div>
      )}

      {showJson ? (
        /* JSON view */
        <div>
          {editing ? (
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              rows={20}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          ) : (
            <pre className="bg-surface-1/30 rounded p-4 text-xs text-foreground/90 overflow-auto max-h-96 font-mono">
              {JSON.stringify(config, null, 2)}
            </pre>
          )}
        </div>
      ) : (
        /* Structured view */
        <div className="space-y-4">
          {/* Model */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">{t('model')}</h5>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t('primaryModel')}</label>
                  <input
                    value={modelPrimary}
                    onChange={(e) => updateModelConfig((current) => ({ ...current, primary: e.target.value }))}
                    list="agent-model-suggestions"
                    placeholder="anthropic/claude-sonnet-4-20250514"
                    className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <datalist id="agent-model-suggestions">
                    {availableModels.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t('fallbackModels')}</label>
                  <div className="space-y-2">
                    {modelFallbacks.map((fallback: string, index: number) => (
                      <div key={`${fallback}-${index}`} className="flex gap-2">
                        <input
                          value={fallback}
                          onChange={(e) => {
                            const next = [...modelFallbacks]
                            next[index] = e.target.value
                            updateModelConfig((current) => ({ ...current, fallbacks: next }))
                          }}
                          list="agent-model-suggestions"
                          className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <Button
                          onClick={() => {
                            const next = modelFallbacks.filter((_: string, i: number) => i !== index)
                            updateModelConfig((current) => ({ ...current, fallbacks: next }))
                          }}
                          variant="destructive"
                          size="xs"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        value={newFallbackModel}
                        onChange={(e) => setNewFallbackModel(e.target.value)}
                        list="agent-model-suggestions"
                        placeholder={t('addFallbackModel')}
                        className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <Button
                        onClick={addFallbackModel}
                        variant="secondary"
                        size="xs"
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm">
                <div><span className="text-muted-foreground">{t('primary')}:</span> <span className="text-foreground font-mono">{modelPrimary || t('notConfigured')}</span></div>
                {modelFallbacks.length > 0 && (
                  <div className="mt-1">
                    <span className="text-muted-foreground">{t('fallbacks')}:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {modelFallbacks.map((fb: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 text-xs bg-surface-2 rounded text-muted-foreground font-mono">{fb.split('/').pop()}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Identity */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">{t('identity')}</h5>
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{t('emoji')}</label>
                    <input
                      value={identityEmoji}
                      onChange={(e) => updateIdentityField('emoji', e.target.value)}
                      className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
                      placeholder="🤖"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{t('name')}</label>
                    <input
                      value={identity.name || ''}
                      onChange={(e) => updateIdentityField('name', e.target.value)}
                      className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                      placeholder="Agent name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{t('themeRole')}</label>
                    <input
                      value={identity.theme || ''}
                      onChange={(e) => updateIdentityField('theme', e.target.value)}
                      className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                      placeholder="e.g. backend engineer"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t('identityContent')}</label>
                  <textarea
                    value={identity.content || ''}
                    onChange={(e) => updateIdentityField('content', e.target.value)}
                    rows={4}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="Describe the agent's identity and personality..."
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-2xl">{identityEmoji}</span>
                  <div>
                    <div className="text-foreground font-medium">{identityName}</div>
                    <div className="text-muted-foreground">{identityTheme}</div>
                  </div>
                </div>
                {identityPreview && (
                  <pre className="mt-3 text-xs text-muted-foreground bg-surface-1 rounded p-2 overflow-auto whitespace-pre-wrap">
                    {identityPreview}
                  </pre>
                )}
              </>
            )}
          </div>

          {/* Workspace files */}
          <div className="bg-surface-1/50 rounded-lg p-4 space-y-4">
            <h5 className="text-sm font-medium text-foreground">{t('workspaceFiles')}</h5>
            <p className="text-xs text-muted-foreground">
              {t('workspaceFilesDesc')}
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground font-medium">identity.md</label>
                {editing && onSaveWorkspaceFile && (
                  <Button
                    onClick={() => saveWorkspaceFile('identity.md')}
                    disabled={savingIdentityMd}
                    size="xs"
                  >
                    {savingIdentityMd ? t('saving') : t('saveIdentityMd')}
                  </Button>
                )}
              </div>
              {editing ? (
                <textarea
                  rows={6}
                  value={identityMdInput}
                  onChange={(e) => setIdentityMdInput(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder="identity.md content..."
                />
              ) : (
                <pre className="bg-surface-1 rounded p-3 text-xs text-muted-foreground overflow-auto whitespace-pre-wrap min-h-[96px]">
                  {identityMdInput || t('identityMdEmpty')}
                </pre>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground font-medium">agent.md</label>
                {editing && onSaveWorkspaceFile && (
                  <Button onClick={() => saveWorkspaceFile('agent.md')} disabled={savingAgentMd} size="xs">
                    {savingAgentMd ? t('saving') : t('saveAgentMd')}
                  </Button>
                )}
              </div>
              {editing ? (
                <textarea
                  rows={8}
                  value={agentMdInput}
                  onChange={(e) => setAgentMdInput(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder="agent.md content..."
                />
              ) : (
                <pre className="bg-surface-1 rounded p-3 text-xs text-muted-foreground overflow-auto whitespace-pre-wrap min-h-[120px]">
                  {agentMdInput || t('agentMdEmpty')}
                </pre>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium">{t('otherMarkdownFiles')}</label>
              {loadingWorkspaceDocs ? (
                <div className="text-xs text-muted-foreground">{t('loadingWorkspaceFiles')}</div>
              ) : (
                <div className="space-y-2">
                  {workspaceDocs
                    .filter((doc) => !['identity.md', 'agent.md'].includes(doc.name))
                    .map((doc) => (
                      <div key={doc.name} className="bg-surface-1 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono text-foreground">{doc.name}</span>
                          <span className={`text-2xs ${doc.exists ? 'text-green-400' : 'text-muted-foreground'}`}>
                            {doc.exists ? t('chars', { count: doc.content.length }) : t('missing')}
                          </span>
                        </div>
                        <pre className="text-xs text-muted-foreground overflow-auto whitespace-pre-wrap max-h-32">
                          {doc.exists ? doc.content : t('fileNotFound', { name: doc.name })}
                        </pre>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Sandbox */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">{t('sandbox')}</h5>
            {editing ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t('mode')}</label>
                  <select
                    value={sandbox.mode || ''}
                    onChange={(e) => updateSandboxField('mode', e.target.value)}
                    className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="">{t('notConfigured')}</option>
                    <option value="all">{t('all')}</option>
                    <option value="non-main">{t('nonMain')}</option>
                    <option value="none">{t('none')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t('workspaceAccess')}</label>
                  <select
                    value={sandbox.workspaceAccess || ''}
                    onChange={(e) => updateSandboxField('workspaceAccess', e.target.value)}
                    className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="">{t('notConfigured')}</option>
                    <option value="rw">{t('readWrite')}</option>
                    <option value="ro">{t('readOnly')}</option>
                    <option value="none">{t('none')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t('network')}</label>
                  <input
                    value={sandbox.network || ''}
                    onChange={(e) => updateSandboxField('network', e.target.value)}
                    className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder={t('none')}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><span className="text-muted-foreground">{t('mode')}:</span> <span className="text-foreground">{sandboxMode}</span></div>
                <div><span className="text-muted-foreground">{t('workspace')}:</span> <span className="text-foreground">{sandboxWorkspace}</span></div>
                <div><span className="text-muted-foreground">{t('network')}:</span> <span className="text-foreground">{sandboxNetwork}</span></div>
              </div>
            )}
          </div>

          {/* Tools */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">{t('tools')}</h5>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-green-400 font-medium mb-1">{t('allowList')}</label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {toolAllow.map((tool: string, i: number) => (
                      <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded border border-green-500/20 flex items-center gap-1">
                        {tool}
                        <Button onClick={() => removeTool('allow', i)} variant="ghost" size="icon-xs" className="text-green-400/60 hover:text-green-400 ml-1 h-auto w-auto p-0">&times;</Button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newAllowTool}
                      onChange={(e) => setNewAllowTool(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTool('allow', newAllowTool); setNewAllowTool('') } }}
                      placeholder={t('addAllowedTool')}
                      className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <Button
                      onClick={() => { addTool('allow', newAllowTool); setNewAllowTool('') }}
                      variant="outline"
                      size="sm"
                      className="bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
                    >
                      {t('add')}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-red-400 font-medium mb-1">{t('denyList')}</label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {toolDeny.map((tool: string, i: number) => (
                      <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20 flex items-center gap-1">
                        {tool}
                        <Button onClick={() => removeTool('deny', i)} variant="ghost" size="icon-xs" className="text-red-400/60 hover:text-red-400 ml-1 h-auto w-auto p-0">&times;</Button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newDenyTool}
                      onChange={(e) => setNewDenyTool(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTool('deny', newDenyTool); setNewDenyTool('') } }}
                      placeholder={t('addDeniedTool')}
                      className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <Button
                      onClick={() => { addTool('deny', newDenyTool); setNewDenyTool('') }}
                      variant="outline"
                      size="sm"
                      className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                    >
                      {t('add')}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {toolAllow.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs text-green-400 font-medium">{t('allowCount', { count: toolAllow.length })}:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {toolAllow.map((tool: string) => (
                        <span key={tool} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded border border-green-500/20">{tool}</span>
                      ))}
                    </div>
                  </div>
                )}
                {toolDeny.length > 0 && (
                  <div>
                    <span className="text-xs text-red-400 font-medium">{t('denyCount', { count: toolDeny.length })}:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {toolDeny.map((tool: string) => (
                        <span key={tool} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20">{tool}</span>
                      ))}
                    </div>
                  </div>
                )}
                {toolAllow.length === 0 && toolDeny.length === 0 && !toolRawPreview && (
                  <div className="text-xs text-muted-foreground">{t('noToolsConfigured')}</div>
                )}
                {toolRawPreview && (
                  <pre className="mt-3 text-xs text-muted-foreground bg-surface-1 rounded p-2 overflow-auto whitespace-pre-wrap">
                    {toolRawPreview}
                  </pre>
                )}
              </>
            )}
          </div>

          {/* Subagents */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">{t('subAgents')}</h5>
            {editing ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {(subagents.allowAgents || []).map((a: string, idx: number) => (
                    <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-violet-500/10 text-violet-400 rounded border border-violet-500/20">
                      {a}
                      <button
                        onClick={() => {
                          setConfig((prev: any) => {
                            const sa = { ...(prev.subagents || {}) }
                            const list = [...(sa.allowAgents || [])]
                            list.splice(idx, 1)
                            return { ...prev, subagents: { ...sa, allowAgents: list } }
                          })
                        }}
                        className="text-violet-400/60 hover:text-violet-400 ml-0.5"
                        title={`Remove sub-agent ${a}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t('addSubAgentPlaceholder')}
                    className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim()
                        if (!val) return
                        setConfig((prev: any) => {
                          const sa = { ...(prev.subagents || {}) }
                          const existing = Array.isArray(sa.allowAgents) ? sa.allowAgents : []
                          if (existing.includes(val)) return prev
                          return { ...prev, subagents: { ...sa, allowAgents: [...existing, val] } }
                        });
                        (e.target as HTMLInputElement).value = ''
                      }
                    }}
                  />
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={(e) => {
                      const input = (e.target as HTMLElement).parentElement?.querySelector('input') as HTMLInputElement | null
                      if (!input) return
                      const val = input.value.trim()
                      if (!val) return
                      setConfig((prev: any) => {
                        const sa = { ...(prev.subagents || {}) }
                        const existing = Array.isArray(sa.allowAgents) ? sa.allowAgents : []
                        if (existing.includes(val)) return prev
                        return { ...prev, subagents: { ...sa, allowAgents: [...existing, val] } }
                      })
                      input.value = ''
                    }}
                  >
                    {t('add')}
                  </Button>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">{t('subAgentModelOverride')}</label>
                  <select
                    value={subagents.model || ''}
                    onChange={(e) => {
                      setConfig((prev: any) => ({
                        ...prev,
                        subagents: { ...(prev.subagents || {}), model: e.target.value || undefined }
                      }))
                    }}
                    className="w-full mt-1 px-2 py-1 text-xs border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">{t('defaultInheritFromAgent')}</option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <>
                {subagents.allowAgents && subagents.allowAgents.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {subagents.allowAgents.map((a: string) => (
                        <span key={a} className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-400 rounded border border-violet-500/20">{a}</span>
                      ))}
                    </div>
                    {subagents.model && (
                      <div className="text-xs text-muted-foreground mt-1">{t('modelLabel')}: {subagents.model}</div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">{t('noSubAgentsConfigured')}</div>
                )}
              </>
            )}
          </div>

          {/* Memory Search */}
          {memorySearch.sources && (
            <div className="bg-surface-1/50 rounded-lg p-4">
              <h5 className="text-sm font-medium text-foreground mb-2">{t('memorySearch')}</h5>
              <div className="flex gap-1">
                {memorySearch.sources.map((s: string) => (
                  <span key={s} className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {editing && (
        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? t('saving') : t('save')}
          </Button>
          <Button
            onClick={() => {
              setEditing(false)
              setConfig(agent.config || {})
              setJsonInput(JSON.stringify(agent.config || {}, null, 2))
            }}
            variant="secondary"
          >
            {t('cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}

// ===== Files Tab — Agent workspace file browser with inline editor =====

interface FileEntry {
  name: string
  exists: boolean
  content: string
}

export function FilesTab({ agent }: { agent: Agent }) {
  const t = useTranslations('agentDetail')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [workspace, setWorkspace] = useState<string | null>(null)

  const loadFiles = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/agents/${agent.id}/files`)
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load files')
      }
      const data = await response.json()
      setWorkspace(data.workspace || null)
      const entries = Object.entries(data.files || {}).map(([name, value]: [string, any]) => ({
        name,
        exists: Boolean(value?.exists),
        content: String(value?.content || ''),
      }))
      setFiles(entries)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFiles() }, [agent.id])

  const activeEntry = activeFile ? files.find(f => f.name === activeFile) : null
  const baseContent = activeEntry?.content || ''
  const isDirty = activeFile ? draft !== baseContent : false

  const selectFile = (name: string) => {
    const entry = files.find(f => f.name === name)
    setActiveFile(name)
    setDraft(entry?.content || '')
  }

  const handleSave = async () => {
    if (!activeFile) return
    setSaving(true)
    try {
      const response = await fetch(`/api/agents/${agent.id}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: activeFile, content: draft }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save file')
      }
      setFiles(prev => prev.map(f =>
        f.name === activeFile ? { ...f, exists: true, content: draft } : f
      ))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && files.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label="Loading files" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('workspaceFiles')}</h4>
          {workspace && (
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{workspace}</p>
          )}
        </div>
        <Button onClick={loadFiles} size="sm" variant="secondary" disabled={loading}>
          {loading ? '...' : t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[200px_1fr] gap-4 min-h-[400px]">
        {/* File list */}
        <div className="space-y-1 border-r border-border pr-3">
          {files.map(file => (
            <button
              key={file.name}
              onClick={() => selectFile(file.name)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                activeFile === file.name
                  ? 'bg-primary/10 text-foreground border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-1/50'
              }`}
            >
              <div className="font-mono text-xs">{file.name}</div>
              <div className="text-2xs mt-0.5">
                {file.exists
                  ? t('charCount', { count: file.content.length })
                  : <span className="text-amber-400">{t('missing')}</span>
                }
              </div>
            </button>
          ))}
        </div>

        {/* Editor */}
        <div>
          {!activeEntry ? (
            <div className="text-muted-foreground text-sm flex items-center justify-center h-full">
              {t('selectFile')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-mono text-sm text-foreground">{activeEntry.name}</span>
                  {!activeEntry.exists && (
                    <span className="ml-2 px-1.5 py-0.5 text-2xs bg-amber-500/20 text-amber-400 rounded">{t('missing')}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setDraft(baseContent)}
                    size="xs"
                    variant="secondary"
                    disabled={!isDirty}
                  >
                    {t('reset')}
                  </Button>
                  <Button
                    onClick={handleSave}
                    size="xs"
                    disabled={saving || !isDirty}
                  >
                    {saving ? t('saving') : t('save')}
                  </Button>
                </div>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={20}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
                placeholder={activeEntry.exists ? '' : t('fileNotExistYet')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== Tools Tab — Tool allow/deny list management =====

export function ToolsTab({ agent }: { agent: Agent }) {
  const t = useTranslations('agentDetail')
  const agentConfig = (agent as any).config || {}
  const tools = agentConfig.tools || {}
  const toolAllow = Array.isArray(tools.allow) ? tools.allow : []
  const toolDeny = Array.isArray(tools.deny) ? tools.deny : []
  const toolAlsoAllow = Array.isArray(tools.alsoAllow) ? tools.alsoAllow : []
  const profile = tools.profile || 'default'

  const [allowList, setAllowList] = useState<string[]>(toolAllow)
  const [denyList, setDenyList] = useState<string[]>(toolDeny)
  const [alsoAllowList, setAlsoAllowList] = useState<string[]>(toolAlsoAllow)
  const [newAllow, setNewAllow] = useState('')
  const [newDeny, setNewDeny] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const isDirty = JSON.stringify(allowList) !== JSON.stringify(toolAllow)
    || JSON.stringify(denyList) !== JSON.stringify(toolDeny)
    || JSON.stringify(alsoAllowList) !== JSON.stringify(toolAlsoAllow)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_config: {
            tools: {
              ...tools,
              allow: allowList,
              deny: denyList,
              alsoAllow: alsoAllowList,
            },
          },
          write_to_gateway: true,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save tools')
      }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addToList = (list: string[], setList: (v: string[]) => void, value: string) => {
    const trimmed = value.trim()
    if (!trimmed || list.includes(trimmed)) return
    setList([...list, trimmed])
  }

  const removeFromList = (list: string[], setList: (v: string[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index))
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('toolConfiguration')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('profileLabel')}: <span className="font-mono text-foreground">{profile}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {success && <span className="text-xs text-green-400">{t('saved')}</span>}
          <Button onClick={handleSave} size="sm" disabled={saving || !isDirty}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Allow list */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-green-400 mb-2">{t('allowListCount', { count: allowList.length })}</h5>
        <div className="flex flex-wrap gap-1 mb-3">
          {allowList.map((tool, i) => (
            <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded border border-green-500/20 flex items-center gap-1">
              {tool}
              <button onClick={() => removeFromList(allowList, setAllowList, i)} className="text-green-400/60 hover:text-green-400 ml-0.5">x</button>
            </span>
          ))}
          {allowList.length === 0 && <span className="text-xs text-muted-foreground">{t('noExplicitAllowList')}</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={newAllow}
            onChange={(e) => setNewAllow(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addToList(allowList, setAllowList, newAllow)
                setNewAllow('')
              }
            }}
            placeholder={t('addToolToAllowList')}
            className="flex-1 bg-surface-1 text-foreground rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button onClick={() => { addToList(allowList, setAllowList, newAllow); setNewAllow('') }} variant="secondary" size="xs">
            {t('add')}
          </Button>
        </div>
      </div>

      {/* Also-Allow list */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-cyan-400 mb-2">{t('alsoAllowCount', { count: alsoAllowList.length })}</h5>
        <p className="text-2xs text-muted-foreground mb-2">{t('alsoAllowDesc')}</p>
        <div className="flex flex-wrap gap-1 mb-3">
          {alsoAllowList.map((tool, i) => (
            <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded border border-cyan-500/20 flex items-center gap-1">
              {tool}
              <button onClick={() => removeFromList(alsoAllowList, setAlsoAllowList, i)} className="text-cyan-400/60 hover:text-cyan-400 ml-0.5">x</button>
            </span>
          ))}
          {alsoAllowList.length === 0 && <span className="text-xs text-muted-foreground">{t('none')}</span>}
        </div>
      </div>

      {/* Deny list */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-red-400 mb-2">{t('denyListCount', { count: denyList.length })}</h5>
        <div className="flex flex-wrap gap-1 mb-3">
          {denyList.map((tool, i) => (
            <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20 flex items-center gap-1">
              {tool}
              <button onClick={() => removeFromList(denyList, setDenyList, i)} className="text-red-400/60 hover:text-red-400 ml-0.5">x</button>
            </span>
          ))}
          {denyList.length === 0 && <span className="text-xs text-muted-foreground">{t('noDeniedTools')}</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={newDeny}
            onChange={(e) => setNewDeny(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addToList(denyList, setDenyList, newDeny)
                setNewDeny('')
              }
            }}
            placeholder={t('addToolToDenyList')}
            className="flex-1 bg-surface-1 text-foreground rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button onClick={() => { addToList(denyList, setDenyList, newDeny); setNewDeny('') }} variant="secondary" size="xs">
            {t('add')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ===== Channels Tab — Per-agent channel assignment view =====

interface ChannelAccountInfo {
  id?: string
  connected?: boolean
  running?: boolean
  configured?: boolean
  enabled?: boolean
  probe?: { ok?: boolean }
}

interface ChannelEntryInfo {
  id: string
  label: string
  accounts: ChannelAccountInfo[]
}

export function ChannelsTab({ agent }: { agent: Agent }) {
  const t = useTranslations('agentDetail')
  const [channels, setChannels] = useState<ChannelEntryInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadChannels = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/channels')
      if (!response.ok) throw new Error('Failed to load channels')
      const data = await response.json()

      const snapshot = data.channels || data
      const channelOrder: string[] = snapshot.channelOrder || []
      const channelMeta: Array<{ id: string; label?: string }> = snapshot.channelMeta || []
      const channelAccounts: Record<string, ChannelAccountInfo[]> = snapshot.channelAccounts || {}
      const channelLabels: Record<string, string> = snapshot.channelLabels || {}

      const ids = new Set<string>()
      for (const id of channelOrder) ids.add(id)
      for (const entry of channelMeta) ids.add(entry.id)
      for (const id of Object.keys(channelAccounts)) ids.add(id)

      const entries: ChannelEntryInfo[] = Array.from(ids).map(id => {
        const meta = channelMeta.find(m => m.id === id)
        return {
          id,
          label: meta?.label || channelLabels[id] || id,
          accounts: channelAccounts[id] || [],
        }
      })

      setChannels(entries)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadChannels() }, [])

  if (loading && channels.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label="Loading channels" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('channelStatus')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('channelStatusDesc', { agent: agent.name })}
          </p>
        </div>
        <Button onClick={loadChannels} size="sm" variant="secondary" disabled={loading}>
          {loading ? '...' : t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {channels.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">
          {t('noChannelsFound')}
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map(channel => {
            const total = channel.accounts.length
            const connected = channel.accounts.filter(a => {
              const probeOk = a.probe && typeof a.probe === 'object' && 'ok' in a.probe ? Boolean(a.probe.ok) : false
              return a.connected === true || a.running === true || probeOk
            }).length
            const enabled = channel.accounts.filter(a => a.enabled).length
            const configured = channel.accounts.filter(a => a.configured).length

            return (
              <div key={channel.id} className="bg-surface-1/50 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{channel.label}</div>
                  <div className="text-xs font-mono text-muted-foreground">{channel.id}</div>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{total > 0 ? t('connectedOf', { connected, total }) : t('noAccounts')}</span>
                  <span>{configured > 0 ? t('configuredCount', { count: configured }) : t('notConfigured')}</span>
                  <span className={enabled > 0 ? 'text-green-400' : ''}>{total > 0 ? t('enabledCount', { count: enabled }) : t('disabled')}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ===== Cron Tab — Per-agent cron jobs =====

interface AgentCronJob {
  name: string
  description?: string
  agentId?: string
  schedule?: string
  cron?: string
  enabled?: boolean
  lastRun?: string | number | null
  nextRun?: string | number | null
  sessionTarget?: string
  state?: string
  payload?: any
}

export function CronTab({ agent }: { agent: Agent }) {
  const t = useTranslations('agentDetail')
  const [allJobs, setAllJobs] = useState<AgentCronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const loadCron = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/cron?action=list')
      if (!response.ok) throw new Error('Failed to load cron jobs')
      const data = await response.json()
      setAllJobs(data.jobs || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCron() }, [])

  const agentName = agent.name.toLowerCase().replace(/\s+/g, '-')
  const agentJobs = showAll
    ? allJobs
    : allJobs.filter(j =>
        j.agentId === agent.name
        || j.agentId === agentName
        || j.agentId === String(agent.id)
      )

  const formatTime = (value: string | number | null | undefined) => {
    if (!value) return 'n/a'
    const d = typeof value === 'number' ? new Date(value) : new Date(value)
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString()
  }

  if (loading && allJobs.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label="Loading cron jobs" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('cronJobs')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {showAll ? t('allCronJobsCount', { count: agentJobs.length, total: allJobs.length }) : t('agentCronJobsCount', { count: agentJobs.length, total: allJobs.length })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowAll(!showAll)}
            size="xs"
            variant={showAll ? 'outline' : 'secondary'}
          >
            {showAll ? t('agentOnly') : t('showAll')}
          </Button>
          <Button onClick={loadCron} size="sm" variant="secondary" disabled={loading}>
            {loading ? '...' : t('refresh')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {agentJobs.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">
          {showAll ? t('noCronJobsFound') : t('noCronJobsAssigned', { agent: agent.name })}
        </div>
      ) : (
        <div className="space-y-2">
          {agentJobs.map(job => (
            <div key={job.name} className="bg-surface-1/50 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{job.name}</div>
                  {job.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{job.description}</div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-0.5 text-xs bg-surface-2 rounded font-mono">
                      {job.schedule || job.cron || t('noSchedule')}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      job.enabled ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {job.enabled ? t('enabled') : t('disabled')}
                    </span>
                    {job.sessionTarget && (
                      <span className="px-2 py-0.5 text-xs bg-surface-2 rounded text-muted-foreground">
                        {job.sessionTarget}
                      </span>
                    )}
                    {job.agentId && (
                      <span className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-400 rounded">
                        {job.agentId}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground space-y-1">
                  <div>{t('last')}: {formatTime(job.lastRun)}</div>
                  <div>{t('next')}: {formatTime(job.nextRun)}</div>
                  {job.state && <div className="font-mono">{job.state}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== Models Tab — Model fallback chain =====

export function ModelsTab({ agent }: { agent: Agent }) {
  const t = useTranslations('agentDetail')
  const agentConfig = (agent as any).config || {}
  const modelCfg = agentConfig.model || {}
  const modelPrimary = typeof modelCfg === 'string' ? modelCfg : (modelCfg.primary || '')
  const modelFallbacks: string[] = Array.isArray(modelCfg.fallbacks) ? modelCfg.fallbacks : []

  const [primary, setPrimary] = useState(modelPrimary)
  const [fallbacks, setFallbacks] = useState<string[]>(modelFallbacks)
  const [newFallback, setNewFallback] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [availableModels, setAvailableModels] = useState<Array<{ alias: string }>>([])

  useEffect(() => {
    fetch('/api/status?action=models')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.models) setAvailableModels(data.models)
      })
      .catch(() => {})
  }, [])

  const isDirty = primary !== modelPrimary || JSON.stringify(fallbacks) !== JSON.stringify(modelFallbacks)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_config: {
            model: {
              primary: (primary || '').trim(),
              fallbacks: fallbacks.filter(f => f && f.trim()),
            },
          },
          write_to_gateway: true,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save model config')
      }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addFallback = () => {
    const trimmed = newFallback.trim()
    if (!trimmed || fallbacks.includes(trimmed)) return
    setFallbacks([...fallbacks, trimmed])
    setNewFallback('')
  }

  const removeFallback = (index: number) => {
    setFallbacks(fallbacks.filter((_, i) => i !== index))
  }

  const moveFallback = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= fallbacks.length) return
    const next = [...fallbacks]
    const [item] = next.splice(index, 1)
    next.splice(newIndex, 0, item)
    setFallbacks(next)
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('modelConfiguration')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{t('modelConfigurationDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          {success && <span className="text-xs text-green-400">{t('saved')}</span>}
          <Button onClick={handleSave} size="sm" disabled={saving || !isDirty}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Primary model */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-foreground mb-2">{t('primaryModel')}</h5>
        <select
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">{t('default')}</option>
          {availableModels.map(m => (
            <option key={m.alias} value={m.alias}>{m.alias}</option>
          ))}
          {primary && !availableModels.find(m => m.alias === primary) && (
            <option value={primary}>{primary}</option>
          )}
        </select>
      </div>

      {/* Fallback chain */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-foreground mb-2">{t('fallbackChainCount', { count: fallbacks.length })}</h5>
        <p className="text-2xs text-muted-foreground mb-3">
          {t('fallbackChainDesc')}
        </p>

        {fallbacks.length === 0 ? (
          <div className="text-xs text-muted-foreground mb-3">{t('noFallbackModels')}</div>
        ) : (
          <div className="space-y-1 mb-3">
            {fallbacks.map((fb, i) => (
              <div key={`${fb}-${i}`} className="flex items-center gap-2 bg-surface-1 rounded px-3 py-1.5">
                <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                <span className="flex-1 font-mono text-xs text-foreground">{fb}</span>
                <button
                  onClick={() => moveFallback(i, -1)}
                  disabled={i === 0}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                  title={t('moveUp')}
                >
                  ^
                </button>
                <button
                  onClick={() => moveFallback(i, 1)}
                  disabled={i === fallbacks.length - 1}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                  title={t('moveDown')}
                >
                  v
                </button>
                <button
                  onClick={() => removeFallback(i)}
                  className="text-xs text-red-400/60 hover:text-red-400 px-1"
                  title={t('remove')}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={newFallback}
            onChange={(e) => setNewFallback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addFallback()
              }
            }}
            list="model-fallback-suggestions"
            placeholder={t('addFallbackModel')}
            className="flex-1 bg-surface-1 text-foreground rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <datalist id="model-fallback-suggestions">
            {availableModels.map(m => (
              <option key={m.alias} value={m.alias} />
            ))}
          </datalist>
          <Button onClick={addFallback} variant="secondary" size="xs">
            {t('add')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Persona Tab ---

interface PersonaData {
  persona: {
    personality?: {
      traits: string[]
      big_five: { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number }
    }
    skills?: string[]
    style?: string
  }
  padState: { pleasure: number; arousal: number; dominance: number; updated_at: number }
  activeBiases: Array<{ name: string; description: string }>
  trustNetwork: Array<{ agent_id: number; agent_name: string; trust_score: number; interaction_count: number }>
  presets: string[]
}

const OCEAN_LABELS: Array<{ key: string; label: string }> = [
  { key: 'openness', label: 'Openness' },
  { key: 'conscientiousness', label: 'Conscientiousness' },
  { key: 'extraversion', label: 'Extraversion' },
  { key: 'agreeableness', label: 'Agreeableness' },
  { key: 'neuroticism', label: 'Neuroticism' },
]

const PAD_LABELS: Array<{ key: string; label: string }> = [
  { key: 'pleasure', label: 'Pleasure' },
  { key: 'arousal', label: 'Arousal' },
  { key: 'dominance', label: 'Dominance' },
]

function padToEmotionLabelClient(p: number, a: number, d: number): string {
  if (p >= 0 && a >= 0 && d >= 0) return 'Exuberant'
  if (p >= 0 && a >= 0 && d < 0) return 'Dependent'
  if (p >= 0 && a < 0 && d >= 0) return 'Relaxed'
  if (p >= 0 && a < 0 && d < 0) return 'Docile'
  if (p < 0 && a >= 0 && d >= 0) return 'Hostile'
  if (p < 0 && a >= 0 && d < 0) return 'Anxious'
  if (p < 0 && a < 0 && d >= 0) return 'Disdainful'
  return 'Bored'
}

export function PersonaTab({ agent }: { agent: { id: number; name: string } }) {
  const [data, setData] = useState<PersonaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [oceanValues, setOceanValues] = useState<Record<string, number>>({
    openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5,
  })
  const [padValues, setPadValues] = useState<Record<string, number>>({
    pleasure: 0, arousal: 0, dominance: 0,
  })
  const [selectedPreset, setSelectedPreset] = useState('')

  const fetchPersona = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agent.id}/persona`)
      if (!res.ok) throw new Error('Failed to fetch persona')
      const json = await res.json()
      setData(json)
      if (json.persona?.personality?.big_five) {
        setOceanValues(json.persona.personality.big_five)
      }
      setPadValues({
        pleasure: json.padState?.pleasure ?? 0,
        arousal: json.padState?.arousal ?? 0,
        dominance: json.padState?.dominance ?? 0,
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [agent.id])

  useEffect(() => { fetchPersona() }, [fetchPersona])

  const saveOcean = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}/persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bigFive: oceanValues }),
      })
      if (!res.ok) throw new Error('Failed to save OCEAN traits')
      await fetchPersona()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const applyPresetAction = async () => {
    if (!selectedPreset) return
    setSaving(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}/persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: selectedPreset }),
      })
      if (!res.ok) throw new Error('Failed to apply preset')
      await fetchPersona()
      setSelectedPreset('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const savePad = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}/persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ padState: padValues }),
      })
      if (!res.ok) throw new Error('Failed to save PAD state')
      await fetchPersona()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const resetPad = async () => {
    setPadValues({ pleasure: 0, arousal: 0, dominance: 0 })
    setSaving(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}/persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ padState: { pleasure: 0, arousal: 0, dominance: 0 } }),
      })
      if (!res.ok) throw new Error('Failed to reset PAD')
      await fetchPersona()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6"><Loader /></div>

  if (error) return (
    <div className="p-6">
      <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
    </div>
  )

  const emotionLabel = padToEmotionLabelClient(padValues.pleasure, padValues.arousal, padValues.dominance)

  return (
    <div className="p-5 space-y-6">
      {/* OCEAN Traits Editor */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">Big Five (OCEAN) Traits</h4>
          <Button onClick={saveOcean} disabled={saving} variant="secondary" size="xs">
            {saving ? 'Saving...' : 'Save Traits'}
          </Button>
        </div>
        <div className="space-y-2">
          {OCEAN_LABELS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={oceanValues[key] ?? 0.5}
                onChange={e => setOceanValues(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs font-mono text-foreground w-8 text-right">{(oceanValues[key] ?? 0.5).toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Preset Selector */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Preset Templates</h4>
        <div className="flex items-center gap-2">
          <select
            value={selectedPreset}
            onChange={e => setSelectedPreset(e.target.value)}
            className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Select a preset...</option>
            {(data?.presets ?? []).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <Button onClick={applyPresetAction} disabled={saving || !selectedPreset} variant="secondary" size="xs">
            Apply Preset
          </Button>
        </div>
      </div>

      {/* PAD Emotional State */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-foreground">PAD Emotional State</h4>
            <span className="text-xs text-muted-foreground">Current emotion: <span className="text-foreground font-medium">{emotionLabel}</span></span>
          </div>
          <div className="flex gap-1.5">
            <Button onClick={resetPad} disabled={saving} variant="ghost" size="xs">
              Reset to Baseline
            </Button>
            <Button onClick={savePad} disabled={saving} variant="secondary" size="xs">
              {saving ? 'Saving...' : 'Save PAD'}
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          {PAD_LABELS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.1"
                value={padValues[key] ?? 0}
                onChange={e => setPadValues(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs font-mono text-foreground w-8 text-right">{(padValues[key] ?? 0).toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active Biases Display */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Active Cognitive Biases</h4>
        {(data?.activeBiases ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No active biases for current trait profile.</p>
        ) : (
          <div className="space-y-1.5">
            {(data?.activeBiases ?? []).map(bias => (
              <div key={bias.name} className="bg-surface-1/50 rounded-md px-3 py-2">
                <span className="text-xs font-medium text-foreground">{bias.name}</span>
                <p className="text-2xs text-muted-foreground mt-0.5">{bias.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trust Network */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Trust Network</h4>
        {(data?.trustNetwork ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No trust relationships established yet.</p>
        ) : (
          <div className="space-y-1.5">
            {(data?.trustNetwork ?? []).map(entry => (
              <div key={entry.agent_id} className="flex items-center gap-3">
                <span className="text-xs text-foreground w-28 truncate">{entry.agent_name}</span>
                <div className="flex-1 h-1.5 bg-surface-1 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(entry.trust_score * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-muted-foreground w-10 text-right">{entry.trust_score.toFixed(2)}</span>
                <span className="text-2xs text-muted-foreground">({entry.interaction_count})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
