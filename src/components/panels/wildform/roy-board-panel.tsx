'use client'

import { useEffect, useRef, useState } from 'react'
import type { BoardTask } from '@/app/api/wildform/board/route'

// ---- helpers ----

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
  low:      'bg-muted text-muted-foreground border-border',
}

const SOURCE_COLORS: Record<string, string> = {
  roy:  'bg-violet-500/20 text-violet-400 border-violet-500/30',
  dave: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
}

// ---- sub-components ----

interface AddFormProps {
  onAdd: (data: { title: string; description?: string; priority: string }) => void
  onCancel: () => void
}

function AddForm({ onAdd, onCancel }: AddFormProps) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState('medium')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({ title: title.trim(), description: desc.trim() || undefined, priority })
  }

  return (
    <form onSubmit={submit} className="space-y-2 mt-2 p-2 rounded-lg border border-border bg-background/50">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Task title..."
        className="w-full text-sm bg-transparent border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
      />
      <input
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="Description (optional)"
        className="w-full text-sm bg-transparent border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
      />
      <select
        value={priority}
        onChange={e => setPriority(e.target.value)}
        className="w-full text-sm bg-card border border-border rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-primary"
      >
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 text-xs py-1 rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
          Add task
        </button>
        <button type="button" onClick={onCancel} className="flex-1 text-xs py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

interface TaskCardProps {
  task: BoardTask
  onDelete: (id: string) => void
  isDragging: boolean
  onDragStart: (e: React.DragEvent, id: string) => void
}

function TaskCard({ task, onDelete, isDragging, onDragStart }: TaskCardProps) {
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, task.id)}
      className={`group rounded-lg border border-border bg-card p-3 space-y-2 cursor-grab active:cursor-grabbing transition-opacity ${isDragging ? 'opacity-40' : 'opacity-100'} hover:border-primary/40`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-foreground font-medium leading-snug">{task.title}</span>
        <button
          onClick={() => onDelete(task.id)}
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title="Delete task"
        >
          ×
        </button>
      </div>

      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium}`}>
          {task.priority}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${SOURCE_COLORS[task.source] ?? SOURCE_COLORS.dave}`}>
          {task.source}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {task.column === 'done' && task.completedAt
            ? formatDate(task.completedAt)
            : relativeTime(task.createdAt)
          }
        </span>
      </div>
    </div>
  )
}

// ---- column config ----

interface ColumnConfig {
  id: 'backlog' | 'desk' | 'done'
  label: string
  headerClass: string
  dotClass: string
  canAdd: boolean
}

const COLUMNS: ColumnConfig[] = [
  { id: 'backlog', label: 'Backlog',     headerClass: 'text-muted-foreground', dotClass: 'bg-slate-500',  canAdd: true },
  { id: 'desk',    label: "Roy's Desk",  headerClass: 'text-amber-400',        dotClass: 'bg-amber-400',  canAdd: true },
  { id: 'done',    label: 'Done',        headerClass: 'text-green-400',        dotClass: 'bg-green-500',  canAdd: false },
]

// ---- main panel ----

export function RoyBoardPanel() {
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [loading, setLoading] = useState(true)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchTasks() {
    try {
      const res = await fetch('/api/wildform/board')
      if (!res.ok) return
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchTasks()
    intervalRef.current = setInterval(fetchTasks, 30000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  async function handleAdd(column: string, data: { title: string; description?: string; priority: string }) {
    try {
      const res = await fetch('/api/wildform/board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, column, source: 'dave' }),
      })
      if (res.ok) {
        const { task } = await res.json()
        setTasks(prev => [...prev, task])
      }
    } catch {}
    setAddingTo(null)
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/wildform/board?id=${id}`, { method: 'DELETE' })
      if (res.ok) setTasks(prev => prev.filter(t => t.id !== id))
    } catch {}
  }

  async function handleMove(id: string, column: 'backlog' | 'desk' | 'done') {
    try {
      const res = await fetch('/api/wildform/board', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, column }),
      })
      if (res.ok) {
        const { task } = await res.json()
        setTasks(prev => prev.map(t => t.id === task.id ? task : t))
      }
    } catch {}
  }

  function onDragStart(e: React.DragEvent, id: string) {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault()
    setDragOverCol(colId)
  }

  function onDrop(e: React.DragEvent, colId: 'backlog' | 'desk' | 'done') {
    e.preventDefault()
    if (draggedId) {
      const task = tasks.find(t => t.id === draggedId)
      if (task && task.column !== colId) handleMove(draggedId, colId)
    }
    setDraggedId(null)
    setDragOverCol(null)
  }

  function onDragEnd() {
    setDraggedId(null)
    setDragOverCol(null)
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-32 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-3">
              {[0, 1, 2].map(j => <div key={j} className="h-20 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Roy's Board</h2>
        <span className="text-xs text-muted-foreground">Auto-refreshes every 30s</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.column === col.id)
          const isDragTarget = dragOverCol === col.id

          return (
            <div
              key={col.id}
              onDragOver={e => onDragOver(e, col.id)}
              onDrop={e => onDrop(e, col.id as 'backlog' | 'desk' | 'done')}
              onDragLeave={() => setDragOverCol(null)}
              className={`flex flex-col rounded-xl border bg-secondary/20 p-3 min-h-[300px] transition-colors ${isDragTarget ? 'border-primary/50 bg-primary/5' : 'border-border'}`}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${col.dotClass}`} />
                <span className={`text-sm font-semibold ${col.headerClass}`}>{col.label}</span>
                <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                  {colTasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="flex-1 space-y-2">
                {colTasks.length === 0 && !addingTo && (
                  <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
                    Nothing here yet
                  </div>
                )}
                {colTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDelete={handleDelete}
                    isDragging={draggedId === task.id}
                    onDragStart={onDragStart}
                  />
                ))}
                {addingTo === col.id && col.canAdd && (
                  <AddForm
                    onAdd={data => handleAdd(col.id, data)}
                    onCancel={() => setAddingTo(null)}
                  />
                )}
              </div>

              {/* Add button */}
              {col.canAdd && addingTo !== col.id && (
                <button
                  onClick={() => setAddingTo(col.id)}
                  className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/40 rounded-lg py-2 transition-colors"
                >
                  + Add task
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
