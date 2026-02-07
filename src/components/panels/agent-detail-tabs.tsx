'use client'

import { useState, useEffect } from 'react'

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
  offline: '⚫',
  idle: '🟢',
  busy: '🟡',
  error: '🔴',
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
      <div className="p-4 bg-gray-700/50 rounded-lg">
        <h4 className="text-sm font-medium text-white mb-3">Status Control</h4>
        <div className="flex gap-2 mb-3">
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

        {/* Wake Agent Button */}
        {agent.session_key && (
          <button
            onClick={() => onWakeAgent(agent.name, agent.session_key!)}
            className="w-full bg-cyan-600 text-white py-2 rounded hover:bg-cyan-700 transition-colors"
          >
            🚨 Wake Agent via Session
          </button>
        )}
      </div>

      {/* Direct Message */}
      <div className="p-4 bg-gray-700/50 rounded-lg">
        <h4 className="text-sm font-medium text-white mb-3">Direct Message</h4>
        {messageStatus && (
          <div className="text-xs text-gray-300 mb-2">{messageStatus}</div>
        )}
        <form onSubmit={handleSendMessage} className="space-y-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input
              type="text"
              value={messageFrom}
              onChange={(e) => setMessageFrom(e.target.value)}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Message</label>
            <textarea
              value={directMessage}
              onChange={(e) => setDirectMessage(e.target.value)}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs"
            >
              Send Message
            </button>
          </div>
        </form>
      </div>

      {/* Heartbeat Check */}
      <div className="p-4 bg-gray-700/50 rounded-lg">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-medium text-white">Heartbeat Check</h4>
          <button
            onClick={onPerformHeartbeat}
            disabled={loadingHeartbeat}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loadingHeartbeat ? 'Checking...' : '💓 Check Now'}
          </button>
        </div>
        
        {heartbeatData && (
          <div className="space-y-2">
            <div className="text-sm text-gray-300">
              <strong>Status:</strong> {heartbeatData.status}
            </div>
            <div className="text-sm text-gray-300">
              <strong>Checked:</strong> {new Date(heartbeatData.checked_at * 1000).toLocaleString()}
            </div>
            
            {heartbeatData.work_items && heartbeatData.work_items.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-medium text-yellow-400 mb-2">
                  Work Items Found: {heartbeatData.total_items}
                </div>
                {heartbeatData.work_items.map((item, idx) => (
                  <div key={idx} className="text-sm text-gray-300 ml-2">
                    • {item.type}: {item.count} items
                  </div>
                ))}
              </div>
            )}
            
            {heartbeatData.message && (
              <div className="text-sm text-gray-300">
                <strong>Message:</strong> {heartbeatData.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Agent Details */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Role</label>
          {editing ? (
            <input
              type="text"
              value={formData.role}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, role: e.target.value }))}
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
              onChange={(e) => setFormData((prev: any) => ({ ...prev, session_key: e.target.value }))}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="OpenClaw session identifier"
            />
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-white font-mono">{agent.session_key || 'Not set'}</p>
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
          {agent.last_seen && (
            <div className="col-span-2">
              <span className="text-gray-400">Last Seen:</span>
              <span className="text-white ml-2">{new Date(agent.last_seen * 1000).toLocaleString()}</span>
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
              className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Save Changes
            </button>
            <button
              onClick={onCancel}
              className="flex-1 bg-gray-600 text-white py-2 rounded hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onEdit}
            className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
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
  templates,
  onSave
}: {
  agent: Agent
  soulContent: string
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
        <h4 className="text-lg font-medium text-white">SOUL Configuration</h4>
        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Edit SOUL
            </button>
          )}
        </div>
      </div>

      {/* Template Selector */}
      {editing && templates.length > 0 && (
        <div className="p-4 bg-gray-700/50 rounded-lg">
          <h5 className="text-sm font-medium text-white mb-2">Load Template</h5>
          <div className="flex gap-2">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="flex-1 bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Load
            </button>
          </div>
        </div>
      )}

      {/* SOUL Editor */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">
          SOUL Content ({content.length} characters)
        </label>
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            placeholder="Define the agent's personality, instructions, and behavior patterns..."
          />
        ) : (
          <div className="bg-gray-700/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-white whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-gray-400 italic">No SOUL content defined</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
          >
            Save SOUL
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setContent(soulContent)
            }}
            className="flex-1 bg-gray-600 text-white py-2 rounded hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
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
    if (confirm('Are you sure you want to clear all working memory?')) {
      await onSave('')
      setContent('')
      setEditing(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-white">Working Memory</h4>
        <div className="flex gap-2">
          {!editing && (
            <>
              <button
                onClick={() => {
                  setAppendMode(true)
                  setEditing(true)
                }}
                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                Add Entry
              </button>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Edit Memory
              </button>
            </>
          )}
        </div>
      </div>

      {/* Memory Content */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">
          Memory Content ({content.length} characters)
        </label>
        
        {editing && appendMode ? (
          <div className="space-y-2">
            <div className="bg-gray-700/30 rounded p-4 max-h-40 overflow-y-auto">
              <pre className="text-white whitespace-pre-wrap text-sm">{content}</pre>
            </div>
            <textarea
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              rows={5}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add new memory entry..."
            />
          </div>
        ) : editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={15}
            className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            placeholder="Working memory for temporary notes, current tasks, and session data..."
          />
        ) : (
          <div className="bg-gray-700/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-white whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-gray-400 italic">No working memory content</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
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
            className="flex-1 bg-gray-600 text-white py-2 rounded hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          {!appendMode && (
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Clear All
            </button>
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-400">Loading tasks...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-medium text-white">Assigned Tasks</h4>
      
      {tasks.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <div className="text-4xl mb-2">📋</div>
          <p>No tasks assigned</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="bg-gray-700/50 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h5 className="font-medium text-white">{task.title}</h5>
                  {task.description && (
                    <p className="text-gray-300 text-sm mt-1">{task.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded ${
                    task.status === 'in_progress' ? 'bg-yellow-600' :
                    task.status === 'done' ? 'bg-green-600' :
                    task.status === 'review' ? 'bg-blue-600' :
                    task.status === 'quality_review' ? 'bg-indigo-600' :
                    'bg-gray-600'
                  }`}>
                    {task.status}
                  </span>
                  <span className={`px-2 py-1 text-xs rounded ${
                    task.priority === 'urgent' ? 'bg-red-600' :
                    task.priority === 'high' ? 'bg-orange-600' :
                    task.priority === 'medium' ? 'bg-yellow-600' :
                    'bg-gray-600'
                  }`}>
                    {task.priority}
                  </span>
                </div>
              </div>
              
              {task.due_date && (
                <div className="text-xs text-gray-400 mt-2">
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-400">Loading activity...</span>
        </div>
      </div>
    )
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'agent_status_change': return '🔄'
      case 'task_created': return '📝'
      case 'task_updated': return '✏️'
      case 'comment_added': return '💬'
      case 'agent_heartbeat': return '💓'
      case 'agent_soul_updated': return '🧠'
      case 'agent_memory_updated': return '📝'
      default: return '📊'
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-medium text-white">Recent Activity</h4>
      
      {activities.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <div className="text-4xl mb-2">📊</div>
          <p>No recent activity</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(activity => (
            <div key={activity.id} className="bg-gray-700/50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl">{getActivityIcon(activity.type)}</div>
                <div className="flex-1">
                  <p className="text-white">{activity.description}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
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

// Create Agent Modal (reused from original)
export function CreateAgentModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    session_key: '',
    soul_content: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (!response.ok) throw new Error('Failed to create agent')
      
      onCreated()
      onClose()
    } catch (error) {
      console.error('Error creating agent:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-xl font-bold text-white mb-4">Create New Agent</h3>
          
          <div className="space-y-4">
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
            
            <div>
              <label className="block text-sm text-gray-400 mb-1">Session Key (Optional)</label>
              <input
                type="text"
                value={formData.session_key}
                onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="OpenClaw session identifier"
              />
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
