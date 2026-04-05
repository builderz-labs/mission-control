'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getErrorMessage } from '@/lib/types/sql'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskSummary {
  task_id: number
  session_id: string | null
  step_count: number
  started_at: number
  ended_at: number
}

interface ExecutionTrace {
  id: number
  task_id: number | null
  session_id: string | null
  step_type: string
  step_data: string
  tokens_used: number | null
  duration_ms: number | null
  success: number
  workspace_id: number
  created_at: number
}

interface ReplayBookmark {
  id: number
  task_id: number
  trace_id: number
  step_index: number
  label: string | null
  note: string | null
  created_by: string
  workspace_id: number
  created_at: number
}

interface TraceData {
  steps: ExecutionTrace[]
  bookmarks: ReplayBookmark[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts * 1000) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function tryParseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return raw }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface BookmarkFormProps {
  onSubmit: (label: string, note: string) => void
  onCancel: () => void
  submitting: boolean
}

function BookmarkForm({ onSubmit, onCancel, submitting }: BookmarkFormProps): React.JSX.Element {
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')

  return (
    <div className="mt-3 p-3 rounded-lg bg-secondary/60 border border-border space-y-2">
      <p className="text-xs font-medium text-foreground">Add bookmark</p>
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Label (optional)"
        maxLength={200}
        className="w-full h-7 px-2 text-xs rounded-md bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Note (optional)"
        maxLength={2000}
        rows={2}
        className="w-full px-2 py-1.5 text-xs rounded-md bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
      />
      <div className="flex gap-2">
        <Button size="xs" onClick={() => onSubmit(label, note)} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

interface StepCardProps {
  step: ExecutionTrace
  stepIndex: number
  bookmark: ReplayBookmark | undefined
  onBookmarkClick: () => void
}

function StepCard({ step, stepIndex, bookmark, onBookmarkClick }: StepCardProps): React.JSX.Element {
  const parsed = tryParseJson(step.step_data)
  const successBadge = step.success
    ? 'bg-green-500/20 text-green-400'
    : 'bg-red-500/20 text-red-400'

  return (
    <div className="space-y-3">
      {/* Step metadata row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-mono font-semibold">
          {step.step_type}
        </span>
        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${successBadge}`}>
          {step.success ? 'success' : 'failed'}
        </span>
        {step.tokens_used != null && (
          <span className="text-xs text-muted-foreground font-mono">{step.tokens_used} tok</span>
        )}
        {step.duration_ms != null && (
          <span className="text-xs text-muted-foreground font-mono">{step.duration_ms}ms</span>
        )}
        {/* Bookmark star */}
        <button
          title={bookmark ? (bookmark.label ?? 'Bookmarked') : 'Bookmark this step'}
          onClick={onBookmarkClick}
          className={`ml-auto text-base leading-none transition-colors ${bookmark ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}
        >
          ★
        </button>
      </div>

      {/* Step data */}
      <div className="rounded-lg bg-secondary/50 border border-border overflow-auto max-h-64">
        <pre className="p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words">
          {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
        </pre>
      </div>

      {/* Bookmark note if present */}
      {bookmark?.note && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-300">
          <span className="font-medium">Note:</span> {bookmark.note}
        </div>
      )}

      <p className="text-2xs text-muted-foreground font-mono">
        Step {stepIndex + 1} · trace id {step.id} · {new Date(step.created_at * 1000).toLocaleString()}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ExecReplayPanel(): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState<string | null>(null)

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [traceData, setTraceData] = useState<TraceData | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState<string | null>(null)

  const [currentStep, setCurrentStep] = useState(0)
  const [showBookmarkForm, setShowBookmarkForm] = useState(false)
  const [bookmarkSubmitting, setBookmarkSubmitting] = useState(false)

  // Keep ref for keyboard handler to read latest values without re-binding
  const stateRef = useRef({ currentStep, totalSteps: 0 })

  // ---------------------------------------------------------------------------
  // Fetch task list
  // ---------------------------------------------------------------------------

  const fetchTasks = useCallback(async (): Promise<void> => {
    setTasksLoading(true)
    setTasksError(null)
    try {
      const res = await fetch('/api/exec-replay/tasks', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setTasks(json.data ?? [])
    } catch (err: unknown) {
      setTasksError(getErrorMessage(err))
    } finally {
      setTasksLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // ---------------------------------------------------------------------------
  // Fetch trace for selected task
  // ---------------------------------------------------------------------------

  const fetchTrace = useCallback(async (taskId: number): Promise<void> => {
    setTraceLoading(true)
    setTraceError(null)
    setTraceData(null)
    setCurrentStep(0)
    setShowBookmarkForm(false)
    try {
      const res = await fetch(`/api/exec-replay/trace/${taskId}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setTraceData(json.data ?? { steps: [], bookmarks: [] })
    } catch (err: unknown) {
      setTraceError(getErrorMessage(err))
    } finally {
      setTraceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedTaskId !== null) fetchTrace(selectedTaskId)
  }, [selectedTaskId, fetchTrace])

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const total = traceData?.steps.length ?? 0
    stateRef.current = { currentStep, totalSteps: total }
  }, [currentStep, traceData])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') {
        setCurrentStep(s => Math.max(0, s - 1))
        setShowBookmarkForm(false)
      } else if (e.key === 'ArrowRight') {
        setCurrentStep(s => Math.min(stateRef.current.totalSteps - 1, s + 1))
        setShowBookmarkForm(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // ---------------------------------------------------------------------------
  // Bookmark actions
  // ---------------------------------------------------------------------------

  const handleBookmarkSubmit = async (label: string, note: string): Promise<void> => {
    if (!selectedTaskId || !traceData) return
    const step = traceData.steps[currentStep]
    if (!step) return

    setBookmarkSubmitting(true)
    try {
      const res = await fetch('/api/exec-replay/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: selectedTaskId,
          trace_id: step.id,
          step_index: currentStep,
          label: label || undefined,
          note: note || undefined,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      // Optimistically add the new bookmark to local state (immutable update)
      setTraceData(prev => prev
        ? { ...prev, bookmarks: [...prev.bookmarks, json.data] }
        : prev
      )
      setShowBookmarkForm(false)
    } catch {
      // Leave form open so user can retry
    } finally {
      setBookmarkSubmitting(false)
    }
  }

  const handleDeleteBookmark = async (bookmarkId: number): Promise<void> => {
    try {
      await fetch(`/api/exec-replay/bookmarks/${bookmarkId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(8000),
      })
      setTraceData(prev => prev
        ? { ...prev, bookmarks: prev.bookmarks.filter(b => b.id !== bookmarkId) }
        : prev
      )
    } catch {
      // Silent — bookmark stays visible
    }
  }

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const steps = traceData?.steps ?? []
  const bookmarks = traceData?.bookmarks ?? []
  const totalSteps = steps.length
  const currentStepData = steps[currentStep]
  const currentBookmark = bookmarks.find(b => b.step_index === currentStep)
  const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left pane — Task selector */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Tasks</h2>
          <Button size="xs" variant="ghost" onClick={fetchTasks} disabled={tasksLoading}>
            {tasksLoading ? '…' : '↺'}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tasksLoading && (
            <div className="p-3 space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-14 rounded-lg shimmer" />
              ))}
            </div>
          )}

          {!tasksLoading && tasksError && (
            <div className="m-3 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
              {tasksError}
            </div>
          )}

          {!tasksLoading && !tasksError && tasks.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">No tasks with traces found.</div>
          )}

          {!tasksLoading && tasks.map(task => (
            <button
              key={task.task_id}
              onClick={() => setSelectedTaskId(task.task_id)}
              className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors hover:bg-secondary/60 ${selectedTaskId === task.task_id ? 'bg-primary/10 border-l-2 border-l-primary' : ''}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-mono text-foreground truncate flex-1">
                  {`#${task.task_id}`}
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-secondary text-2xs text-muted-foreground font-mono shrink-0">
                  {task.step_count}
                </span>
              </div>
              {task.session_id && (
                <p className="text-2xs text-muted-foreground font-mono truncate">{task.session_id}</p>
              )}
              <p className="text-2xs text-muted-foreground mt-0.5">{timeAgo(task.started_at)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Right pane — Trace timeline */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTaskId === null ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a task from the list to begin replay</p>
          </div>
        ) : traceLoading ? (
          <div className="p-6 space-y-3">
            <div className="h-6 w-48 rounded-md shimmer" />
            <div className="h-2 rounded-full shimmer" />
            <div className="h-48 rounded-xl shimmer" />
          </div>
        ) : traceError ? (
          <div className="m-4 rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
            {traceError}
          </div>
        ) : totalSteps === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No trace steps found for this task.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Header row */}
            <div className="flex items-center gap-3">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => { setCurrentStep(s => Math.max(0, s - 1)); setShowBookmarkForm(false) }}
                disabled={currentStep === 0}
              >
                ←
              </Button>
              <span className="text-xs font-mono text-muted-foreground">
                Step {currentStep + 1} of {totalSteps}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => { setCurrentStep(s => Math.min(totalSteps - 1, s + 1)); setShowBookmarkForm(false) }}
                disabled={currentStep >= totalSteps - 1}
              >
                →
              </Button>
              <p className="ml-auto text-2xs text-muted-foreground">Task #{selectedTaskId}</p>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Current step card */}
            {currentStepData && (
              <div className="rounded-xl border border-border bg-card p-4">
                <StepCard
                  step={currentStepData}
                  stepIndex={currentStep}
                  bookmark={currentBookmark}
                  onBookmarkClick={() => {
                    if (currentBookmark) {
                      handleDeleteBookmark(currentBookmark.id)
                    } else {
                      setShowBookmarkForm(v => !v)
                    }
                  }}
                />

                {showBookmarkForm && !currentBookmark && (
                  <BookmarkForm
                    onSubmit={handleBookmarkSubmit}
                    onCancel={() => setShowBookmarkForm(false)}
                    submitting={bookmarkSubmitting}
                  />
                )}
              </div>
            )}

            {/* Bookmark timeline dots */}
            {bookmarks.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {bookmarks.map(bm => (
                  <button
                    key={bm.id}
                    title={bm.label ?? `Step ${bm.step_index + 1}`}
                    onClick={() => { setCurrentStep(bm.step_index); setShowBookmarkForm(false) }}
                    className={`px-2 py-0.5 rounded-full text-2xs font-mono transition-colors ${
                      currentStep === bm.step_index
                        ? 'bg-amber-500/30 text-amber-300'
                        : 'bg-secondary text-muted-foreground hover:text-amber-400'
                    }`}
                  >
                    ★ {bm.step_index + 1}
                  </button>
                ))}
              </div>
            )}

            <p className="text-2xs text-muted-foreground text-center pt-1">
              Use ← → arrow keys to navigate steps
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
