'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { SetupQuestion } from './jev-setup-options'

export function JevClarificationCard({
  question, value, disabled = false, onAnswer, onBack,
}: {
  question: SetupQuestion
  value?: string
  disabled?: boolean
  onAnswer: (value: string) => void
  onBack: () => void
}) {
  const [custom, setCustom] = useState('')
  return (
    <section aria-labelledby={`jev-question-${question.id}`} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div><p className="text-xs font-medium uppercase tracking-wide text-void-cyan">Clarify</p><h2 id={`jev-question-${question.id}`} className="mt-1 text-lg font-semibold text-foreground">{question.title}</h2><p className="mt-1 text-sm text-muted-foreground">{question.help}</p></div>
      <div className="grid gap-2 sm:grid-cols-2">
        {question.options.map((option) => (
          <button key={option.value} type="button" disabled={disabled} aria-pressed={value === option.value} onClick={() => onAnswer(option.value)} className={`rounded-lg border p-3 text-left transition disabled:opacity-60 ${value === option.value ? 'border-void-cyan bg-void-cyan/10' : 'border-border bg-background hover:border-void-cyan/50'}`}>
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">{option.label}{option.recommended && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase text-emerald-300">Recommended</span>}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{option.consequence}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input aria-label="Custom answer" disabled={disabled} maxLength={1000} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Or write a custom answer…" className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-void-cyan" />
        <Button type="button" variant="outline" disabled={disabled || !custom.trim()} onClick={() => onAnswer(custom.trim())}>Use custom answer</Button>
      </div>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onBack}>Back</Button>
    </section>
  )
}
