'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { NavArrowLeft, Plus, Trash, RefreshDouble, Github, Folder } from 'iconoir-react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { PropertyChip, type PropertyOption } from '@/components/ui/property-chip'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { BlockEditor } from '@/components/ui/block-editor'

interface Project {
  id: string
  title: string
  description?: string
  emoji: string
  repo_url?: string
  local_path?: string
  taskCount?: number
  lastActivity?: number
}

interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  project_id?: string
  project_title?: string
}

interface Agent {
  id: number
  name: string
  role: string
  status: 'offline' | 'idle' | 'busy' | 'error'
}

const statusColors = {
  inbox: 'bg-secondary text-foreground',
  assigned: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  review: 'bg-purple-500/20 text-purple-400',
  quality_review: 'bg-indigo-500/20 text-indigo-400',
  done: 'bg-green-500/20 text-green-400',
}

const priorityColors = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
}

export function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')
      const data = await res.json()
      setProjects(data.projects || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Smart polling
  useSmartPoll(fetchProjects, 15000)

  // Keyboard: Escape to go back
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedProjectId) {
        e.preventDefault()
        setSelectedProjectId(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedProjectId])

  if (selectedProjectId) {
    const project = projects.find(p => p.id === selectedProjectId)
    if (!project) {
      // Invalid project ID, return to list
      setSelectedProjectId(null)
      return null
    }
    return (
      <ProjectDetailView
        project={project}
        onBack={() => setSelectedProjectId(null)}
        onUpdate={fetchProjects}
      />
    )
  }

  // List view
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <h2 className="text-xl font-bold text-foreground">Projects</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchProjects} title="Refresh">
            <RefreshDouble className="size-4" />
          </Button>
          <Button variant="outline" size="default" onClick={() => setShowCreateForm(true)}>
            <Plus className="size-4 mr-1.5" />
            New Project
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <div className="text-muted-foreground">Loading projects...</div>}
        {error && <div className="text-red-400">{error}</div>}

        {!loading && !error && projects.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="mb-4">No projects yet</p>
            <Button variant="outline" onClick={() => setShowCreateForm(true)}>
              <Plus className="size-4 mr-1.5" />
              Create your first project
            </Button>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="space-y-3">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-foreground/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="text-2xl shrink-0">{project.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground mb-1">{project.title}</h3>
                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">{project.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>{project.taskCount || 0} tasks</span>
                      {project.lastActivity && (
                        <span>Updated {formatRelativeTime(project.lastActivity)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showCreateForm && (
        <CreateProjectModal
          onClose={() => setShowCreateForm(false)}
          onCreated={() => {
            setShowCreateForm(false)
            fetchProjects()
          }}
        />
      )}
    </div>
  )
}

// Detail view component
function ProjectDetailView({
  project,
  onBack,
  onUpdate
}: {
  project: Project
  onBack: () => void
  onUpdate: () => void
}) {
  const [title, setTitle] = useState(project.title)
  const [emoji, setEmoji] = useState(project.emoji)
  const [description, setDescription] = useState(project.description || '')
  const [repoUrl, setRepoUrl] = useState(project.repo_url || '')
  const [localPath, setLocalPath] = useState(project.local_path || '')
  const [editingEmoji, setEditingEmoji] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showCreateTask, setShowCreateTask] = useState(false)

  const emojiInputRef = useRef<HTMLInputElement>(null)

  // Fetch tasks for this project
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks?project_id=${project.id}`)
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
    } finally {
      setLoadingTasks(false)
    }
  }, [project.id])

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      if (res.ok) {
        const data = await res.json()
        setAgents(data.agents || [])
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
    fetchAgents()
  }, [fetchTasks, fetchAgents])

  // Auto-save field
  const saveField = async (field: string, value: string) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) throw new Error('Failed to update project')
      onUpdate() // Refresh project list
    } catch (err) {
      console.error('Failed to save:', err)
    }
  }

  const handleTitleBlur = () => {
    if (title.trim() && title !== project.title) {
      saveField('title', title.trim())
    } else {
      setTitle(project.title)
    }
  }

  const handleEmojiBlur = () => {
    if (emoji.trim() && emoji !== project.emoji) {
      saveField('emoji', emoji.trim())
    } else {
      setEmoji(project.emoji)
    }
    setEditingEmoji(false)
  }

  const handleDescriptionBlur = (content: string) => {
    if (content !== (project.description || '')) {
      saveField('description', content)
    }
  }

  const handleRepoUrlBlur = () => {
    if (repoUrl !== (project.repo_url || '')) {
      saveField('repo_url', repoUrl)
    }
  }

  const handleLocalPathBlur = () => {
    if (localPath !== (project.local_path || '')) {
      saveField('local_path', localPath)
    }
  }

  // Focus emoji input when editing starts
  useEffect(() => {
    if (editingEmoji) {
      emojiInputRef.current?.focus()
      emojiInputRef.current?.select()
    }
  }, [editingEmoji])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border flex-shrink-0">
        <div className="p-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} title="Back to projects">
            <NavArrowLeft className="size-4" />
          </Button>

          {/* Emoji */}
          {editingEmoji ? (
            <input
              ref={emojiInputRef}
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              onBlur={handleEmojiBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleEmojiBlur()
                }
              }}
              className="text-2xl w-12 bg-transparent border-b border-foreground/30 outline-none"
              maxLength={2}
            />
          ) : (
            <button
              onClick={() => setEditingEmoji(true)}
              className="text-2xl hover:opacity-70 transition-opacity"
              title="Click to edit emoji"
            >
              {emoji}
            </button>
          )}

          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="flex-1 text-2xl font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
            placeholder="Project title"
          />
        </div>

        {/* Metadata + Description */}
        <div className="px-4 pb-4">
          <div className="text-xs text-muted-foreground mb-3">
            {project.taskCount || 0} tasks · Last updated {formatRelativeTime(project.lastActivity || Date.now())}
          </div>
          <BlockEditor
            initialMarkdown={description}
            onChange={(markdown) => setDescription(markdown)}
            onBlur={(markdown) => handleDescriptionBlur(markdown)}
            placeholder="Add project description..."
            compact
          />

          {/* Repository & Local Path */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
              <Github className="size-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onBlur={handleRepoUrlBlur}
                className="flex-1 text-sm bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground hover:bg-surface-1 px-2 py-1 rounded transition-colors"
                placeholder="Repository URL (e.g., https://github.com/user/repo)"
              />
              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Open repository"
                >
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Folder className="size-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                onBlur={handleLocalPathBlur}
                className="flex-1 text-sm font-mono bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground hover:bg-surface-1 px-2 py-1 rounded transition-colors"
                placeholder="Local path (e.g., ~/projects/repo-name)"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">Tasks</h3>
            <Button variant="outline" size="sm" onClick={() => setShowCreateTask(true)}>
              <Plus className="size-3.5 mr-1" />
              New Task
            </Button>
          </div>

          {loadingTasks && <div className="text-muted-foreground text-sm">Loading tasks...</div>}

          {!loadingTasks && tasks.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="mb-3">No tasks in this project yet</p>
              <Button variant="outline" size="sm" onClick={() => setShowCreateTask(true)}>
                <Plus className="size-3.5 mr-1" />
                Create your first task
              </Button>
            </div>
          )}

          {!loadingTasks && tasks.length > 0 && (
            <div className="space-y-2">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className="w-full text-left bg-card border border-border rounded-lg px-4 py-2.5 hover:border-foreground/20 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground mb-2">{task.title}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded ${statusColors[task.status]}`}>
                          {task.status.replace(/_/g, ' ')}
                        </span>
                        <span className={`text-xs ${priorityColors[task.priority]}`}>
                          {task.priority}
                        </span>
                        {task.assigned_to && (
                          <div className="flex items-center gap-1">
                            <AgentAvatar agent={task.assigned_to} size="sm" />
                            <span className="text-xs text-muted-foreground">{task.assigned_to}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {selectedTask && (
        <TaskDetailModalWrapper
          task={selectedTask}
          agents={agents}
          projects={[project]}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => {
            fetchTasks()
            onUpdate()
          }}
        />
      )}

      {showCreateTask && (
        <CreateTaskModalWrapper
          agents={agents}
          projects={[project]}
          prefilledProjectId={project.id}
          onClose={() => setShowCreateTask(false)}
          onCreated={() => {
            setShowCreateTask(false)
            fetchTasks()
            onUpdate()
          }}
        />
      )}
    </div>
  )
}

// Create project modal
function CreateProjectModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('📁')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [creating, setCreating] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          emoji: emoji.trim() || '📁',
          description: description.trim() || undefined,
          repo_url: repoUrl.trim() || undefined,
          local_path: localPath.trim() || undefined,
        }),
      })

      if (!res.ok) throw new Error('Failed to create project')
      onCreated()
    } catch (err) {
      console.error('Failed to create project:', err)
      alert('Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-semibold text-foreground">New Project</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <span className="text-lg">×</span>
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                Emoji
              </label>
              <input
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                className="w-20 px-3 py-2 bg-surface-1 border border-border rounded text-2xl outline-none focus:border-foreground/30 transition-colors"
                maxLength={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                Title *
              </label>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground outline-none focus:border-foreground/30 transition-colors"
                placeholder="Project name"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                Description
              </label>
              <BlockEditor
                initialMarkdown={description}
                onChange={setDescription}
                placeholder="Add project description..."
                compact
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5 flex items-center gap-2">
                <Github className="size-4" />
                Repository URL
              </label>
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground outline-none focus:border-foreground/30 transition-colors"
                placeholder="https://github.com/user/repo"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5 flex items-center gap-2">
                <Folder className="size-4" />
                Local Path
              </label>
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground font-mono outline-none focus:border-foreground/30 transition-colors"
                placeholder="~/projects/repo-name"
              />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border flex-shrink-0">
          <Button variant="outline" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || creating}>
            {creating ? 'Creating...' : 'Create Project'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Wrapper for TaskDetailModal (we'll import from task-board-panel later)
function TaskDetailModalWrapper({ task, agents, projects, onClose, onUpdate }: any) {
  // For now, simple modal - we'll enhance this to use the real TaskDetailModal
  const [title, setTitle] = useState(task.title)

  const saveField = async (field: string, value: any) => {
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      onUpdate()
    } catch (err) {
      console.error('Failed to save:', err)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-card border border-border rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-border">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title !== task.title) {
                saveField('title', title.trim())
              } else {
                setTitle(task.title)
              }
            }}
            className="flex-1 text-xl font-bold bg-transparent border-none outline-none text-foreground"
          />
          <Button variant="ghost" size="icon" onClick={onClose}>
            <span className="text-lg">×</span>
          </Button>
        </div>
        <div className="p-4 text-muted-foreground">
          Task detail view (simplified). Use arrow keys or close to return.
        </div>
      </div>
    </div>
  )
}

// Wrapper for CreateTaskModal
function CreateTaskModalWrapper({
  agents,
  projects,
  prefilledProjectId,
  onClose,
  onCreated
}: any) {
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          project_id: prefilledProjectId,
          status: 'inbox',
          priority: 'medium',
        }),
      })

      if (!res.ok) throw new Error('Failed to create task')
      onCreated()
    } catch (err) {
      console.error('Failed to create task:', err)
      alert('Failed to create task')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full">
        <div className="flex justify-between items-center p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">New Task</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <span className="text-lg">×</span>
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="p-4">
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground outline-none focus:border-foreground/30 transition-colors mb-4"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!title.trim() || creating}>
              {creating ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Helper functions
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}
