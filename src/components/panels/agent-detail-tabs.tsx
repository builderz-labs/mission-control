'use client'

import { useState, useEffect } from 'react'
import { BlockEditor } from '@/components/ui/block-editor'
import { PropertyChip } from '@/components/ui/property-chip'
import { PixelLoader } from '@/components/ui/pixel-loader'

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
  offline: 'bg-zinc-500',
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
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
  onEdit: () => void
  onCancel: () => void
  heartbeatData: HeartbeatResponse | null
  loadingHeartbeat: boolean
  onPerformHeartbeat: () => Promise<void>
}) {
  const [messageFrom, setMessageFrom] = useState('system')
  const [directMessage, setDirectMessage] = useState('')
  const [messageStatus, setMessageStatus] = useState<string | null>(null)

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
      setMessageStatus('Message sent')
    } catch (error) {
      setMessageStatus('Failed to send message')
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Status Controls */}
      <div className="p-4 bg-surface-1/50 rounded-lg">
        <h4 className="text-sm font-medium text-foreground mb-3">Status Control</h4>
        <div className="flex gap-2 mb-3">
          {(['idle', 'busy', 'offline'] as const).map(status => (
            <button
              key={status}
              onClick={() => onStatusUpdate(agent.name, status)}
              className={`px-3 py-1 text-sm rounded transition-smooth ${
                agent.status === status
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:bg-surface-2'
              }`}
            >
              {statusIcons[status]} {status}
            </button>
          ))}
        </div>

        {/* Wake Agent Button */}
        {agent.session_key && (
          <button
            onClick={() => onWakeAgent(agent.name, agent.session_key!)}
            className="w-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 py-2 rounded-md hover:bg-cyan-500/30 transition-smooth"
          >
            Wake Agent via Session
          </button>
        )}
      </div>

      {/* Direct Message */}
      <div className="p-4 bg-surface-1/50 rounded-lg">
        <h4 className="text-sm font-medium text-foreground mb-3">Direct Message</h4>
        {messageStatus && (
          <div className="text-xs text-foreground/80 mb-2">{messageStatus}</div>
        )}
        <form onSubmit={handleSendMessage} className="space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input
              type="text"
              value={messageFrom}
              onChange={(e) => setMessageFrom(e.target.value)}
              className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Message</label>
            <textarea
              value={directMessage}
              onChange={(e) => setDirectMessage(e.target.value)}
              className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-xs"
            >
              Send Message
            </button>
          </div>
        </form>
      </div>

      {/* Heartbeat Check */}
      <div className="p-4 bg-surface-1/50 rounded-lg">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-medium text-foreground">Heartbeat Check</h4>
          <button
            onClick={onPerformHeartbeat}
            disabled={loadingHeartbeat}
            className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
          >
            {loadingHeartbeat ? 'Checking...' : 'Check Now'}
          </button>
        </div>
        
        {heartbeatData && (
          <div className="space-y-2">
            <div className="text-sm text-foreground/80">
              <strong>Status:</strong> {heartbeatData.status}
            </div>
            <div className="text-sm text-foreground/80">
              <strong>Checked:</strong> {new Date(heartbeatData.checked_at * 1000).toLocaleString()}
            </div>
            
            {heartbeatData.work_items && heartbeatData.work_items.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-medium text-yellow-400 mb-2">
                  Work Items Found: {heartbeatData.total_items}
                </div>
                {heartbeatData.work_items.map((item, idx) => (
                  <div key={idx} className="text-sm text-foreground/80 ml-2">
                    • {item.type}: {item.count} items
                  </div>
                ))}
              </div>
            )}
            
            {heartbeatData.message && (
              <div className="text-sm text-foreground/80">
                <strong>Message:</strong> {heartbeatData.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Agent Details */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Role</label>
          {editing ? (
            <input
              type="text"
              value={formData.role}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, role: e.target.value }))}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          ) : (
            <p className="text-foreground">{agent.role}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Session Key</label>
          {editing ? (
            <input
              type="text"
              value={formData.session_key}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, session_key: e.target.value }))}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="OpenClaw session identifier"
            />
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-foreground font-mono">{agent.session_key || 'Not set'}</p>
              {agent.session_key && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <span>Bound</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Task Statistics */}
        {agent.taskStats && (
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Task Statistics</label>
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-foreground">{agent.taskStats.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-blue-400">{agent.taskStats.assigned}</div>
                <div className="text-xs text-muted-foreground">Assigned</div>
              </div>
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                <div className="text-xs text-muted-foreground">In Progress</div>
              </div>
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                <div className="text-xs text-muted-foreground">Done</div>
              </div>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Created:</span>
            <span className="text-foreground ml-2">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Last Updated:</span>
            <span className="text-foreground ml-2">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
          </div>
          {agent.last_seen && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Last Seen:</span>
              <span className="text-foreground ml-2">{new Date(agent.last_seen * 1000).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        {editing ? (
          <>
            <button
              onClick={onSave}
              className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
            >
              Save Changes
            </button>
            <button
              onClick={onCancel}
              className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onEdit}
            className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
          >
            Edit Agent
          </button>
        )}
      </div>
    </div>
  )
}

// SOUL Tab Component
export function SoulTab({
  agent,
  soulContent,
  source,
  templates,
  onSave
}: {
  agent: Agent
  soulContent: string
  source?: 'disk' | 'db'
  templates: SoulTemplate[]
  onSave: (content: string, templateName?: string) => Promise<void>
}) {
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
      console.error('Failed to load template:', error)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h4 className="text-lg font-medium text-foreground">SOUL Configuration</h4>
          {source && (
            <span className={`px-2 py-0.5 text-xs rounded-md font-medium ${
              source === 'disk'
                ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25'
            }`}>
              Source: {source}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
            >
              Edit SOUL
            </button>
          )}
        </div>
      </div>

      {/* Template Selector */}
      {editing && templates.length > 0 && (
        <div className="p-4 bg-surface-1/50 rounded-lg">
          <h5 className="text-sm font-medium text-foreground mb-2">Load Template</h5>
          <div className="flex gap-2">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Select a template...</option>
              {templates.map(template => (
                <option key={template.name} value={template.name}>
                  {template.description} ({template.size} chars)
                </option>
              ))}
            </select>
            <button
              onClick={() => selectedTemplate && handleLoadTemplate(selectedTemplate)}
              disabled={!selectedTemplate}
              className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-md hover:bg-green-500/30 disabled:opacity-50 transition-smooth"
            >
              Load
            </button>
          </div>
        </div>
      )}

      {/* SOUL Editor */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          SOUL Content ({content.length} characters)
        </label>
        <BlockEditor
          initialMarkdown={content}
          onChange={(md) => setContent(md)}
          onBlur={(md) => setContent(md)}
          placeholder="Define the agent's personality, instructions, and behavior patterns..."
          editable={editing}
          compact={true}
        />
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
          >
            Save SOUL
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setContent(soulContent)
            }}
            className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

// Memory Tab Component
interface DailyMemoryFile {
  filename: string
  date: string
  size: number
  modified: number
}

export function MemoryTab({
  agent,
  workingMemory,
  source,
  dailyFiles,
  onSave
}: {
  agent: Agent
  workingMemory: string
  source?: 'disk' | 'db'
  dailyFiles?: DailyMemoryFile[]
  onSave: (content: string, append?: boolean) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(workingMemory)
  const [appendMode, setAppendMode] = useState(false)
  const [newEntry, setNewEntry] = useState('')
  const [expandedDaily, setExpandedDaily] = useState(false)
  const [viewingFile, setViewingFile] = useState<{ filename: string; content: string } | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)

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
    if (confirm('Are you sure you want to clear all working memory?')) {
      await onSave('')
      setContent('')
      setEditing(false)
    }
  }

  const handleViewDailyFile = async (filename: string) => {
    setLoadingFile(true)
    try {
      const response = await fetch(`/api/agents/${agent.name}/files/${encodeURIComponent(filename)}`)
      if (response.ok) {
        const data = await response.json()
        setViewingFile({ filename, content: data.content })
      }
    } catch (error) {
      console.error('Failed to load daily file:', error)
    } finally {
      setLoadingFile(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h4 className="text-lg font-medium text-foreground">Working Memory</h4>
          {source && (
            <span className={`px-2 py-0.5 text-xs rounded-md font-medium ${
              source === 'disk'
                ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25'
            }`}>
              Source: {source}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <button
                onClick={() => {
                  setAppendMode(true)
                  setEditing(true)
                }}
                className="px-3 py-1 text-sm bg-green-500/20 text-green-400 border border-green-500/30 rounded-md hover:bg-green-500/30 transition-smooth"
              >
                Add Entry
              </button>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
              >
                Edit Memory
              </button>
            </>
          )}
        </div>
      </div>

      {/* Memory Content */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          MEMORY.md ({content.length} characters)
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
              placeholder="Add new memory entry..."
            />
          </div>
        ) : (
          <BlockEditor
            initialMarkdown={content}
            onChange={(md) => setContent(md)}
            onBlur={(md) => setContent(md)}
            placeholder="Working memory for temporary notes, current tasks, and session data..."
            editable={editing}
            compact={true}
          />
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
          >
            {appendMode ? 'Add Entry' : 'Save Memory'}
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setAppendMode(false)
              setContent(workingMemory)
              setNewEntry('')
            }}
            className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
          >
            Cancel
          </button>
          {!appendMode && (
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-smooth"
            >
              Clear All
            </button>
          )}
        </div>
      )}

      {/* Daily Memory Files */}
      {dailyFiles && dailyFiles.length > 0 && (
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setExpandedDaily(!expandedDaily)}
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-smooth"
          >
            <span className="text-xs">{expandedDaily ? 'v' : '>'}</span>
            Daily Memory Files ({dailyFiles.length})
          </button>

          {expandedDaily && (
            <div className="mt-3 space-y-1.5">
              {dailyFiles.map(file => (
                <button
                  key={file.filename}
                  onClick={() => handleViewDailyFile(file.filename)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-surface-1/30 rounded-md hover:bg-surface-1/60 transition-smooth text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">#</span>
                    <span className="text-sm text-foreground">{file.date}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {file.size >= 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Daily File Viewer */}
          {viewingFile && (
            <div className="mt-3 border border-border rounded-lg">
              <div className="flex justify-between items-center px-4 py-2 border-b border-border bg-surface-1/30">
                <span className="text-sm font-medium text-foreground">{viewingFile.filename}</span>
                <button
                  onClick={() => setViewingFile(null)}
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  x
                </button>
              </div>
              <div className="p-4 max-h-64 overflow-y-auto">
                <pre className="text-foreground whitespace-pre-wrap text-sm font-mono">{viewingFile.content}</pre>
              </div>
            </div>
          )}

          {loadingFile && (
            <div className="mt-3 flex items-center gap-2 text-muted-foreground text-sm">
              <PixelLoader size={16} speed={150} />
              Loading...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Tasks Tab Component
export function TasksTab({ agent }: { agent: Agent }) {
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
        console.error('Failed to fetch tasks:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchTasks()
  }, [agent.name])

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <PixelLoader size={32} speed={150} />
          <span className="ml-2 text-muted-foreground">Loading tasks...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-medium text-foreground">Assigned Tasks</h4>
      
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="2" width="10" height="12" rx="1" />
              <path d="M6 6h4M6 9h3" />
            </svg>
          </div>
          <p className="text-sm">No tasks assigned</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="bg-surface-1/50 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h5 className="font-medium text-foreground">{task.title}</h5>
                  {task.description && (
                    <p className="text-foreground/80 text-sm mt-1">{task.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-md font-medium ${
                    task.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                    task.status === 'done' ? 'bg-green-500/20 text-green-400' :
                    task.status === 'review' ? 'bg-purple-500/20 text-purple-400' :
                    task.status === 'blocked' ? 'bg-red-500/20 text-red-400' :
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
                  Due: {new Date(task.due_date * 1000).toLocaleDateString()}
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
        console.error('Failed to fetch activities:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchActivities()
  }, [agent.name])

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <PixelLoader size={32} speed={150} />
          <span className="ml-2 text-muted-foreground">Loading activity...</span>
        </div>
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
      <h4 className="text-lg font-medium text-foreground">Recent Activity</h4>
      
      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M2 8h8M2 12h10" />
            </svg>
          </div>
          <p className="text-sm">No recent activity</p>
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

// Files Tab Component
interface WorkspaceFile {
  filename: string
  size: number
  modified: number
}

export function FilesTab({ agent }: { agent: Agent }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileReadonly, setFileReadonly] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/files`)
        if (response.ok) {
          const data = await response.json()
          setFiles(data.files || [])
          setWorkspace(data.workspace || null)
        }
      } catch (error) {
        console.error('Failed to fetch files:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchFiles()
  }, [agent.name])

  const handleOpenFile = async (filename: string) => {
    setLoadingFile(true)
    setSelectedFile(filename)
    setEditing(false)
    try {
      const response = await fetch(`/api/agents/${agent.name}/files/${encodeURIComponent(filename)}`)
      if (response.ok) {
        const data = await response.json()
        setFileContent(data.content)
        setFileReadonly(data.readonly || false)
        setEditContent(data.content)
      }
    } catch (error) {
      console.error('Failed to load file:', error)
    } finally {
      setLoadingFile(false)
    }
  }

  const handleSaveFile = async () => {
    if (!selectedFile) return
    setSaving(true)
    try {
      const response = await fetch(`/api/agents/${agent.name}/files/${encodeURIComponent(selectedFile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent })
      })
      if (response.ok) {
        setFileContent(editContent)
        setEditing(false)
      }
    } catch (error) {
      console.error('Failed to save file:', error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <PixelLoader size={32} speed={150} />
          <span className="ml-2 text-muted-foreground">Loading files...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-foreground">Workspace Files</h4>
        {selectedFile && (
          <button
            onClick={() => { setSelectedFile(null); setEditing(false) }}
            className="px-3 py-1 text-sm bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth"
          >
            Back to list
          </button>
        )}
      </div>

      {workspace && (
        <div className="text-xs text-muted-foreground font-mono bg-surface-1/30 px-3 py-1.5 rounded">
          {workspace}
        </div>
      )}

      {!workspace && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <p className="text-sm">No workspace configured for this agent</p>
        </div>
      )}

      {/* File List */}
      {!selectedFile && workspace && (
        <div className="space-y-1.5">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No .md files found in workspace</p>
          ) : (
            files.map(file => (
              <button
                key={file.filename}
                onClick={() => handleOpenFile(file.filename)}
                className="w-full flex items-center justify-between px-4 py-3 bg-surface-1/30 rounded-lg hover:bg-surface-1/60 transition-smooth text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-sm">#</span>
                  <div>
                    <span className="text-sm font-medium text-foreground">{file.filename}</span>
                    {file.filename === 'USER.md' && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 rounded">read-only</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{file.size >= 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`}</span>
                  <span>{new Date(file.modified * 1000).toLocaleDateString()}</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* File Viewer/Editor */}
      {selectedFile && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{selectedFile}</span>
              {fileReadonly && (
                <span className="px-1.5 py-0.5 text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 rounded">read-only</span>
              )}
            </div>
            {!fileReadonly && !editing && !loadingFile && (
              <button
                onClick={() => { setEditing(true); setEditContent(fileContent) }}
                className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
              >
                Edit
              </button>
            )}
          </div>

          {loadingFile ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <PixelLoader size={20} speed={150} />
              Loading...
            </div>
          ) : (
            <>
              <BlockEditor
                initialMarkdown={fileContent}
                onChange={(md) => setEditContent(md)}
                onBlur={(md) => setEditContent(md)}
                placeholder="File content..."
                editable={editing}
                compact={true}
              />
              {editing && (
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={handleSaveFile}
                    disabled={saving}
                    className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setEditContent(fileContent) }}
                    className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
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

// Enhanced Create Agent Modal with Template Wizard
export function CreateAgentModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    id: '',
    role: '',
    emoji: '',
    model: 'sonnet',
    workspaceAccess: 'rw' as 'rw' | 'ro' | 'none',
    sandboxMode: 'all' as 'all' | 'non-main',
    dockerNetwork: 'none' as 'none' | 'bridge',
    session_key: '',
    write_to_gateway: true,
  })
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTemplateData = TEMPLATES.find(t => t.type === selectedTemplate)

  // Auto-generate kebab-case ID from name
  const updateName = (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setFormData(prev => ({ ...prev, name, id }))
  }

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
          model: tmpl.modelTier === 'opus' ? 'opus' : tmpl.modelTier === 'haiku' ? 'haiku' : 'sonnet',
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
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          role: formData.role,
          session_key: formData.session_key || undefined,
          template: selectedTemplate || undefined,
          write_to_gateway: formData.write_to_gateway,
          gateway_config: {
            model: { primary: `anthropic/claude-${formData.model === 'opus' ? 'opus-4-5' : formData.model === 'haiku' ? 'haiku-4-5' : 'sonnet-4-20250514'}` },
            identity: { name: formData.name, theme: formData.role, emoji: formData.emoji },
            sandbox: {
              mode: formData.sandboxMode,
              workspaceAccess: formData.workspaceAccess,
              scope: 'agent',
              ...(formData.dockerNetwork === 'bridge' ? { docker: { network: 'bridge' } } : {}),
            },
          },
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create agent')
      }
      onCreated()
      onClose()
    } catch (err: any) {
      setError(err.message)
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
              <h3 className="text-xl font-bold text-foreground">Create New Agent</h3>
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
                      {s === 1 ? 'Template' : s === 2 ? 'Configure' : 'Review'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl">x</button>
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
                <button
                  key={tmpl.type}
                  onClick={() => { selectTemplate(tmpl.type); setStep(2) }}
                  className={`p-4 rounded-lg border text-left transition-smooth hover:bg-surface-1 ${
                    selectedTemplate === tmpl.type ? 'border-primary bg-primary/5' : 'border-border'
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
                      {tmpl.toolCount} tools
                    </span>
                  </div>
                </button>
              ))}
              {/* Custom option */}
              <button
                onClick={() => { selectTemplate(null); setStep(2) }}
                className={`p-4 rounded-lg border text-left transition-smooth hover:bg-surface-1 border-dashed ${
                  selectedTemplate === null ? 'border-primary' : 'border-border'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">+</span>
                  <span className="font-semibold text-foreground">Custom</span>
                </div>
                <p className="text-xs text-muted-foreground">Start from scratch with blank config</p>
              </button>
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Display Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateName(e.target.value)}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="e.g., Frontend Dev"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Agent ID</label>
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
                  <label className="block text-sm text-muted-foreground mb-1">Role / Theme</label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="builder engineer"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Emoji</label>
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
                <label className="block text-sm text-muted-foreground mb-1">Model</label>
                <div className="flex gap-2">
                  {(['opus', 'sonnet', 'haiku'] as const).map(tier => (
                    <button
                      key={tier}
                      onClick={() => setFormData(prev => ({ ...prev, model: tier }))}
                      className={`flex-1 px-3 py-2 text-sm rounded-md border transition-smooth ${
                        formData.model === tier ? MODEL_TIER_COLORS[tier] + ' border' : 'bg-surface-1 text-muted-foreground border-border'
                      }`}
                    >
                      {MODEL_TIER_LABELS[tier]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Workspace</label>
                  <select
                    value={formData.workspaceAccess}
                    onChange={(e) => setFormData(prev => ({ ...prev, workspaceAccess: e.target.value as any }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="rw">Read/Write</option>
                    <option value="ro">Read Only</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Sandbox</label>
                  <select
                    value={formData.sandboxMode}
                    onChange={(e) => setFormData(prev => ({ ...prev, sandboxMode: e.target.value as any }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="all">All (Docker)</option>
                    <option value="non-main">Non-main</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Network</label>
                  <select
                    value={formData.dockerNetwork}
                    onChange={(e) => setFormData(prev => ({ ...prev, dockerNetwork: e.target.value as any }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="none">None (isolated)</option>
                    <option value="bridge">Bridge (internet)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">Session Key (optional)</label>
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder="OpenClaw session identifier"
                />
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-surface-1/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{formData.emoji || (selectedTemplateData?.emoji || '?')}</span>
                  <div>
                    <h4 className="text-lg font-bold text-foreground">{formData.name || 'Unnamed'}</h4>
                    <p className="text-muted-foreground text-sm">{formData.role}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{formData.id}</span></div>
                  <div><span className="text-muted-foreground">Template:</span> <span className="text-foreground">{selectedTemplateData?.label || 'Custom'}</span></div>
                  <div><span className="text-muted-foreground">Model:</span> <span className={`px-2 py-0.5 rounded text-xs ${MODEL_TIER_COLORS[formData.model]}`}>{MODEL_TIER_LABELS[formData.model]}</span></div>
                  <div><span className="text-muted-foreground">Tools:</span> <span className="text-foreground">{selectedTemplateData?.toolCount || 'Custom'}</span></div>
                  <div><span className="text-muted-foreground">Workspace:</span> <span className="text-foreground">{formData.workspaceAccess}</span></div>
                  <div><span className="text-muted-foreground">Sandbox:</span> <span className="text-foreground">{formData.sandboxMode}</span></div>
                  <div><span className="text-muted-foreground">Network:</span> <span className="text-foreground">{formData.dockerNetwork}</span></div>
                  {formData.session_key && (
                    <div><span className="text-muted-foreground">Session:</span> <span className="text-foreground font-mono">{formData.session_key}</span></div>
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
                <span className="text-sm text-foreground">Add to gateway config (openclaw.json)</span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex gap-3 flex-shrink-0">
          {step > 1 && (
            <button
              onClick={() => setStep((step - 1) as 1 | 2)}
              className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth"
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as 2 | 3)}
              disabled={step === 2 && !formData.name.trim()}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={isCreating || !formData.name.trim()}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
            >
              {isCreating ? 'Creating...' : 'Create Agent'}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// Config Tab Component for Agent Detail Modal
interface ModelInfo {
  id: string
  name: string
  provider: string
}

export function ConfigTab({
  agent,
  onSave
}: {
  agent: Agent & { config?: any }
  onSave: () => void
}) {
  const [config, setConfig] = useState<any>(agent.config || {})
  const [editing, setEditing] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState('')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelSaving, setModelSaving] = useState(false)
  const [modelSuccess, setModelSuccess] = useState<string | null>(null)

  useEffect(() => {
    setConfig(agent.config || {})
    setJsonInput(JSON.stringify(agent.config || {}, null, 2))
  }, [agent.config])

  // Fetch available models
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.models) setAvailableModels(data.models) })
      .catch(() => {})
  }, [])

  // Change model via gateway config
  const handleModelChange = async (newModelId: string) => {
    setModelSaving(true)
    setError(null)
    setModelSuccess(null)
    try {
      // Find agent index in gateway config
      const gwRes = await fetch('/api/gateway-config')
      if (!gwRes.ok) throw new Error('Failed to read gateway config')
      const gwData = await gwRes.json()
      const agentList = gwData.config?.agents?.list
      if (!Array.isArray(agentList)) throw new Error('No agents.list in gateway config')

      const agentName = agent.config?.identity?.name || agent.name
      const idx = agentList.findIndex((a: any) =>
        a.identity?.name === agentName ||
        a.openclawId === agent.config?.openclawId
      )
      if (idx === -1) throw new Error(`Agent "${agentName}" not found in gateway config`)

      // Save via dot-notation: agents.list.{idx}.model
      const res = await fetch('/api/gateway-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: { [`agents.list.${idx}.model`]: newModelId }
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update model')
      }

      // Update local config state to reflect the change
      setConfig((prev: any) => ({
        ...prev,
        model: newModelId,
      }))
      setModelSuccess('Model updated. Restart gateway to apply.')
      setTimeout(() => setModelSuccess(null), 5000)
      onSave()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setModelSaving(false)
    }
  }

  const handleSave = async (writeToGateway: boolean = false) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_config: showJson ? JSON.parse(jsonInput) : config,
          write_to_gateway: writeToGateway,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save')
      if (data.warning) setError(data.warning)
      setEditing(false)
      onSave()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const rawModel = config.model
  const model = typeof rawModel === 'string'
    ? { primary: rawModel }
    : (rawModel || {})
  const identity = config.identity || {}
  const sandbox = config.sandbox || {}
  const tools = config.tools || {}
  const subagents = config.subagents || {}
  const memorySearch = config.memorySearch || {}

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-foreground">OpenClaw Config</h4>
        <div className="flex gap-2">
          <button
            onClick={() => setShowJson(!showJson)}
            className="px-3 py-1 text-xs bg-surface-2 text-muted-foreground rounded-md hover:bg-surface-1 transition-smooth"
          >
            {showJson ? 'Structured' : 'JSON'}
          </button>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {config.workspace && (
        <div className="bg-surface-1/50 rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">Workspace</div>
          <div className="text-sm text-foreground font-mono">{config.workspace}</div>
        </div>
      )}

      {config.openclawId && (
        <div className="text-xs text-muted-foreground">
          OpenClaw ID: <span className="font-mono text-foreground">{config.openclawId}</span>
          {config.isDefault && <span className="ml-2 px-1.5 py-0.5 bg-primary/20 text-primary rounded text-xs">Default</span>}
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
            <h5 className="text-sm font-medium text-foreground mb-2">Model</h5>
            <div className="text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Primary:</span>
                {availableModels.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <PropertyChip
                      value={model.primary || ''}
                      options={availableModels.map(m => ({
                        value: m.id,
                        label: m.name,
                        group: m.provider,
                      }))}
                      onSelect={handleModelChange}
                      searchable
                      readOnly={modelSaving}
                    />
                    {modelSaving && (
                      <PixelLoader size={12} speed={120} />
                    )}
                  </div>
                ) : (
                  <span className="text-foreground font-mono">{model.primary || 'N/A'}</span>
                )}
              </div>
              {modelSuccess && (
                <div className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1">
                  {modelSuccess}
                </div>
              )}
              {model.fallbacks && model.fallbacks.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Fallbacks:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {model.fallbacks.map((fb: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 text-xs bg-surface-2 rounded text-muted-foreground font-mono">{fb.split('/').pop()}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Identity */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">Identity</h5>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-2xl">{identity.emoji || '?'}</span>
              <div>
                <div className="text-foreground font-medium">{identity.name || 'N/A'}</div>
                <div className="text-muted-foreground">{identity.theme || 'N/A'}</div>
              </div>
            </div>
          </div>

          {/* Sandbox */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">Sandbox</h5>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div><span className="text-muted-foreground">Mode:</span> <span className="text-foreground">{sandbox.mode || 'N/A'}</span></div>
              <div><span className="text-muted-foreground">Workspace:</span> <span className="text-foreground">{sandbox.workspaceAccess || 'N/A'}</span></div>
              <div><span className="text-muted-foreground">Network:</span> <span className="text-foreground">{sandbox.docker?.network || 'none'}</span></div>
            </div>
          </div>

          {/* Tools */}
          <div className="bg-surface-1/50 rounded-lg p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">Tools</h5>
            {tools.allow && tools.allow.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-green-400 font-medium">Allow ({tools.allow.length}):</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {tools.allow.map((tool: string) => (
                    <span key={tool} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded border border-green-500/20">{tool}</span>
                  ))}
                </div>
              </div>
            )}
            {tools.deny && tools.deny.length > 0 && (
              <div>
                <span className="text-xs text-red-400 font-medium">Deny ({tools.deny.length}):</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {tools.deny.map((tool: string) => (
                    <span key={tool} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20">{tool}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Subagents */}
          {subagents.allowAgents && subagents.allowAgents.length > 0 && (
            <div className="bg-surface-1/50 rounded-lg p-4">
              <h5 className="text-sm font-medium text-foreground mb-2">Subagents</h5>
              <div className="flex flex-wrap gap-1">
                {subagents.allowAgents.map((a: string) => (
                  <span key={a} className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">{a}</span>
                ))}
              </div>
              {subagents.model && (
                <div className="text-xs text-muted-foreground mt-1">Model: {subagents.model}</div>
              )}
            </div>
          )}

          {/* Memory Search */}
          {memorySearch.sources && (
            <div className="bg-surface-1/50 rounded-lg p-4">
              <h5 className="text-sm font-medium text-foreground mb-2">Memory Search</h5>
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
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
          >
            {saving ? 'Saving...' : 'Save to MC'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="flex-1 bg-green-600 text-white py-2 rounded-md hover:bg-green-700 disabled:opacity-50 transition-smooth"
          >
            Save to Gateway
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setConfig(agent.config || {})
              setJsonInput(JSON.stringify(agent.config || {}, null, 2))
            }}
            className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

// Skills Tab Component
interface Skill {
  id: string
  name: string
  description: string
  source: 'global' | 'npm' | 'workspace' | 'central' | 'extension'
  enabled: boolean
  skillMdPath: string
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  const fetchSkills = async () => {
    try {
      const response = await fetch(`/api/agents/${agent.name}/skills`)
      if (response.ok) {
        const data = await response.json()
        setSkills(data.skills || [])
      }
    } catch (error) {
      console.error('Failed to fetch skills:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSkills()
  }, [agent.name])

  const handleToggleSkill = async (skillId: string, currentEnabled: boolean) => {
    setToggling(skillId)
    try {
      const response = await fetch(`/api/agents/${agent.name}/skills/${skillId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled })
      })

      if (response.ok) {
        // Update local state
        setSkills(prev => prev.map(s =>
          s.id === skillId ? { ...s, enabled: !currentEnabled } : s
        ))
      } else {
        const data = await response.json()
        alert(`Failed to toggle skill: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to toggle skill:', error)
      alert('Failed to toggle skill')
    } finally {
      setToggling(null)
    }
  }

  const handleOpenSkill = async (skillId: string) => {
    setLoadingContent(true)
    setSelectedSkill(skillId)
    setEditing(false)
    try {
      const response = await fetch(`/api/agents/${agent.name}/skills/${skillId}`)
      if (response.ok) {
        const data = await response.json()
        setSkillContent(data.content)
        setReadOnly(data.readOnly)
        setEditContent(data.content)
      }
    } catch (error) {
      console.error('Failed to load skill content:', error)
    } finally {
      setLoadingContent(false)
    }
  }

  const handleSaveSkill = async () => {
    if (!selectedSkill) return

    setSaving(true)
    try {
      const response = await fetch(`/api/agents/${agent.name}/skills/${selectedSkill}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent })
      })

      if (response.ok) {
        setSkillContent(editContent)
        setEditing(false)
      } else {
        const data = await response.json()
        alert(`Failed to save skill: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to save skill:', error)
      alert('Failed to save skill')
    } finally {
      setSaving(false)
    }
  }

  const handleBack = () => {
    setSelectedSkill(null)
    setEditing(false)
  }

  const getSourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      global: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
      npm: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
      workspace: 'bg-green-500/15 text-green-400 border-green-500/25',
      central: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
      extension: 'bg-orange-500/15 text-orange-400 border-orange-500/25'
    }
    return colors[source as keyof typeof colors] || colors.global
  }

  // Sort: enabled first, then alphabetically
  const sortedSkills = [...skills].sort((a, b) => {
    if (a.enabled === b.enabled) {
      return a.name.localeCompare(b.name)
    }
    return a.enabled ? -1 : 1
  })

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading skills...</p>
      </div>
    )
  }

  // Skill detail/edit view
  if (selectedSkill) {
    const skill = skills.find(s => s.id === selectedSkill)

    return (
      <div className="p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="text-muted-foreground hover:text-foreground transition-smooth"
              title="Back to list"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M10 12L6 8l4-4" />
              </svg>
            </button>
            <h4 className="text-lg font-medium text-foreground">{skill?.name || selectedSkill}</h4>
            {skill && (
              <span className={`px-2 py-0.5 text-xs rounded-md font-medium border ${getSourceBadge(skill.source)}`}>
                {skill.source}
              </span>
            )}
            {readOnly && (
              <span className="px-2 py-0.5 text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 rounded">
                read-only
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {!editing && !readOnly && (
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {loadingContent ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Loading content...</p>
          </div>
        ) : (
          <>
            <BlockEditor
              initialMarkdown={skillContent}
              onChange={(md) => setEditContent(md)}
              onBlur={(md) => setEditContent(md)}
              placeholder="Skill markdown content..."
              editable={editing}
              compact={true}
            />
            {editing && (
              <div className="flex gap-3 mt-3">
                <button
                  onClick={handleSaveSkill}
                  disabled={saving}
                  className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
                >
                  {saving ? 'Saving...' : 'Save Skill'}
                </button>
                <button
                  onClick={() => {
                    setEditing(false)
                    setEditContent(skillContent)
                  }}
                  className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // List view
  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-foreground">Skills ({skills.length})</h4>
        <button
          onClick={fetchSkills}
          className="text-muted-foreground hover:text-foreground transition-smooth"
          title="Refresh"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M14 8c0-3.314-2.686-6-6-6S2 4.686 2 8s2.686 6 6 6" />
            <path d="M14 12v-4h-4" />
          </svg>
        </button>
      </div>

      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <p className="text-sm">No skills found</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sortedSkills.map(skill => (
            <div
              key={skill.id}
              className="flex items-center justify-between px-4 py-3 bg-surface-1/30 rounded-lg hover:bg-surface-1/60 transition-smooth"
            >
              <button
                onClick={() => handleOpenSkill(skill.id)}
                className="flex-1 flex items-start gap-3 text-left min-w-0"
              >
                <span className="text-muted-foreground text-sm shrink-0">⚡</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">{skill.name}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded font-medium border ${getSourceBadge(skill.source)}`}>
                      {skill.source}
                    </span>
                  </div>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                  )}
                </div>
              </button>
              <button
                onClick={() => handleToggleSkill(skill.id, skill.enabled)}
                disabled={toggling === skill.id}
                className="ml-4 shrink-0"
                title={skill.enabled ? 'Disable skill' : 'Enable skill'}
              >
                <div className={`w-10 h-5 rounded-full transition-colors relative ${
                  skill.enabled ? 'bg-green-500' : 'bg-zinc-600'
                } ${toggling === skill.id ? 'opacity-50' : ''}`}>
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    skill.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
