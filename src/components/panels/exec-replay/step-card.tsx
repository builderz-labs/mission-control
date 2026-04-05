'use client'

import { tryParseJson } from './helpers'
import type { ExecutionTrace, ReplayBookmark } from './types'

interface StepCardProps {
  step: ExecutionTrace
  stepIndex: number
  bookmark: ReplayBookmark | undefined
  onBookmarkClick: () => void
}

export function StepCard({ step, stepIndex, bookmark, onBookmarkClick }: StepCardProps): React.JSX.Element {
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
        {/* Bookmark star — clicking toggles the form or deletes an existing bookmark */}
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
