'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { JevAssistantConnection } from './jev-assistant-connection'
import { JevFlowSteps } from './jev-flow-steps'
import type { JevAssistantOption, JevAssistantProviderKind } from '@/lib/jev-assistant-config'

const EXAMPLES = [
  'Assess whether this repository is ready to release.',
  'Identify the most likely risk and rate the supporting evidence.',
  'Check whether the implementation satisfies the stated requirements.',
]

export function JevAssistantHome({
  goal,
  busy,
  canOperate,
  assistantAvailable,
  providers, provider, onProvider,
  error,
  onGoal,
  onRecommended,
  onCustomize,
  onCancel,
}: {
  goal: string
  busy: boolean
  canOperate: boolean
  assistantAvailable: boolean
  providers: JevAssistantOption[]
  provider: JevAssistantProviderKind
  onProvider: (kind: JevAssistantProviderKind) => void
  error: string | null
  onGoal: (value: string) => void
  onRecommended: () => void
  onCustomize: () => void
  onCancel: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 176)}px`
  }, [])
  useEffect(() => { resize() }, [goal, resize])
  const ready = canOperate && assistantAvailable && goal.trim().length >= 3 && !busy

  return (
    <section className="flex h-full min-h-0 flex-col" aria-labelledby="jev-assistant-title">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <JevFlowSteps current="describe" />
          <div className="flex items-center gap-2 text-[var(--chat-text)]">
            <span aria-hidden className="text-lg">✦</span>
            <h1 id="jev-assistant-title" className="text-2xl font-medium tracking-tight">What do you want evaluated?</h1>
          </div>
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--chat-muted)]">
            Tell the assistant what you want to do. It will ask only the clarifying questions it needs, then fill in the question types, names, options and rating scales for you.
          </p>
          <p className="mt-3 text-xs text-[var(--chat-muted)]">Describe → Clarify if needed → Review questions → Run with Jev</p>
          <div className="mt-8 grid gap-2 md:grid-cols-3">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => onGoal(example)} className="rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] p-3 text-left text-[13px] leading-5 text-[var(--chat-muted)] hover:border-white/20 hover:text-[var(--chat-text)]">
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-4 pb-5 md:px-6">
        <div className="mx-auto max-w-3xl">
          <JevAssistantConnection options={providers} selected={provider} disabled={busy} onChange={onProvider} />
          <div className="rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] px-3 py-2 shadow-xl shadow-black/10">
            <textarea
              ref={textareaRef}
              aria-label="What do you want Jev to evaluate?"
              value={goal}
              maxLength={10000}
              rows={2}
              disabled={busy}
              onChange={(event) => onGoal(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && ready) {
                  event.preventDefault()
                  onRecommended()
                }
              }}
              placeholder="Describe the goal, evidence, risks, tests, and decision you need…"
              className="max-h-44 min-h-14 w-full resize-none bg-transparent text-[14px] leading-6 text-[var(--chat-text)] placeholder:text-[var(--chat-muted)] focus:outline-hidden"
            />
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={!ready} onClick={onCustomize}>Customize setup</Button>
              <Button size="sm" disabled={!ready} onClick={onRecommended}>{busy ? 'Drafting…' : 'Use recommended setup'}</Button>
            </div>
          </div>
          {busy && <div role="status" className="mt-2 flex items-center justify-between text-[12px] text-[var(--chat-muted)]"><span>Drafting a safe, typed policy…</span><Button variant="ghost" size="xs" onClick={onCancel}>Cancel</Button></div>}
          {!canOperate && <p className="mt-2 text-[12px] text-amber-300">Operator access is required to draft a setup.</p>}
          {canOperate && !assistantAvailable && <p className="mt-2 text-[12px] text-amber-300">Connect the selected assistant or choose another one above. Existing policies can still be evaluated with Jev.</p>}
          {error && <p role="alert" className="mt-2 text-[12px] text-red-300">{error}</p>}
        </div>
      </div>
    </section>
  )
}
