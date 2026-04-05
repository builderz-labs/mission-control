'use client'

import { Button } from '@/components/ui/button'
import type { BuilderStep } from './types'

interface StepCardProps {
  step: BuilderStep
  index: number
  total: number
  onChange: (index: number, field: keyof BuilderStep, value: string) => void
  onMove: (index: number, dir: -1 | 1) => void
  onRemove: (index: number) => void
}

export function StepCard({ step, index, total, onChange, onMove, onRemove }: StepCardProps): React.JSX.Element {
  return (
    <div className="p-2.5 rounded-lg border border-border bg-secondary/30 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-muted-foreground">Step {index + 1}</span>
        <div className="flex gap-1">
          <Button onClick={() => onMove(index, -1)} disabled={index === 0} variant="ghost" size="icon-xs" title="Move up">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path d="M8 3v10M4 7l4-4 4 4" />
            </svg>
          </Button>
          <Button onClick={() => onMove(index, 1)} disabled={index === total - 1} variant="ghost" size="icon-xs" title="Move down">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path d="M8 13V3M4 9l4 4 4-4" />
            </svg>
          </Button>
          <Button onClick={() => onRemove(index)} variant="ghost" size="icon-xs" className="text-red-400 hover:text-red-300" title="Remove step">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      </div>
      <input
        value={step.label}
        onChange={e => onChange(index, 'label', e.target.value)}
        placeholder="Label (e.g. Step 1)"
        className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/60"
      />
      <input
        value={step.agentName}
        onChange={e => onChange(index, 'agentName', e.target.value)}
        placeholder="Agent name (e.g. CFO)"
        className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/60"
      />
      <textarea
        value={step.promptTemplate}
        onChange={e => onChange(index, 'promptTemplate', e.target.value)}
        placeholder="Prompt template — use {{input}} for the previous step's output"
        rows={2}
        className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/60 resize-none"
      />
    </div>
  )
}
