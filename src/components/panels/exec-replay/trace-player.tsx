'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getErrorMessage } from '@/lib/types/sql'
import { Button } from '@/components/ui/button'
import { StepCard } from './step-card'
import { BookmarkForm } from './bookmark-form'
import type { TraceData, ReplayBookmark } from './types'

interface TracePlayerProps {
  taskId: number
}

export function TracePlayer({ taskId }: TracePlayerProps): React.JSX.Element {
  const [traceData, setTraceData] = useState<TraceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [showBookmarkForm, setShowBookmarkForm] = useState(false)
  const [bookmarkSubmitting, setBookmarkSubmitting] = useState(false)

  // Ref lets the keyboard handler read fresh values without re-binding every render
  const totalStepsRef = useRef(0)

  // ─── Fetch trace ────────────────────────────────────────────────────────────

  const fetchTrace = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setTraceData(null)
    setCurrentStep(0)
    setShowBookmarkForm(false)
    try {
      const res = await fetch(`/api/exec-replay/trace/${taskId}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setTraceData(json.data ?? { steps: [], bookmarks: [] })
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { fetchTrace() }, [fetchTrace])

  // ─── Keyboard navigation ────────────────────────────────────────────────────

  useEffect(() => {
    totalStepsRef.current = traceData?.steps.length ?? 0
  }, [traceData])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') {
        setCurrentStep(s => Math.max(0, s - 1))
        setShowBookmarkForm(false)
      } else if (e.key === 'ArrowRight') {
        setCurrentStep(s => Math.min(totalStepsRef.current - 1, s + 1))
        setShowBookmarkForm(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // ─── Bookmark actions ───────────────────────────────────────────────────────

  const handleBookmarkSubmit = async (label: string, note: string): Promise<void> => {
    if (!traceData) return
    const step = traceData.steps[currentStep]
    if (!step) return

    setBookmarkSubmitting(true)
    try {
      const res = await fetch('/api/exec-replay/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          trace_id: step.id,
          step_index: currentStep,
          label: label || undefined,
          note: note || undefined,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      // Optimistic immutable update
      setTraceData(prev => prev
        ? { ...prev, bookmarks: [...prev.bookmarks, json.data as ReplayBookmark] }
        : prev
      )
      setShowBookmarkForm(false)
    } catch {
      // Leave form open so the user can retry
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
      // Silent — bookmark stays visible until next load
    }
  }

  // ─── Derived values ─────────────────────────────────────────────────────────

  const steps = traceData?.steps ?? []
  const bookmarks = traceData?.bookmarks ?? []
  const totalSteps = steps.length
  const currentStepData = steps[currentStep]
  const currentBookmark = bookmarks.find(b => b.step_index === currentStep)
  const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0

  // ─── Render states ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        <div className="h-6 w-48 rounded-md shimmer" />
        <div className="h-2 rounded-full shimmer" />
        <div className="h-48 rounded-xl shimmer" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-4 rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
        {error}
      </div>
    )
  }

  if (totalSteps === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No trace steps found for this task.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Navigation header */}
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
        <p className="ml-auto text-2xs text-muted-foreground">Task #{taskId}</p>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Current step */}
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
  )
}
