'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import type { SessionTranscriptMessage } from '../session-message'
import { IconClock, IconClose } from '../desktop/chat-icons'
import { HandoffPicker } from './handoff-picker'
import { handoffKindFromAgent } from '@/lib/adaptive-context-agent'
import type { FleetAgentName } from '@/lib/fleet-agents'

function dismissKey(id: string): string {
  return `mc.chat-handoff-dismissed.${id}`
}

function looksReal(value: unknown): value is string {
  return typeof value === 'string' && /^[\w:.-]{6,}$/.test(value)
}

export function transcriptExcerpt(messages: SessionTranscriptMessage[], cap = 8000): string {
  const chunks: string[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    for (const part of messages[index].parts) {
      if (part.type === 'text' && part.text.trim()) chunks.push(part.text.trim())
      else if (part.type === 'tool_use') chunks.push(`${part.label || part.name}: ${part.input}`.trim())
      else if (part.type === 'artifact') chunks.push(`Artifact: ${part.title}${part.url ? ` ${part.url}` : ''}`)
      else if (part.type === 'pr_link') chunks.push(`PR #${part.number} ${part.url}`)
    }
  }
  const joined = chunks.reverse().join('\n')
  return joined.length <= cap ? joined : joined.slice(joined.length - cap)
}

export function HandoffBanner({
  sessionId,
  sourceKind,
  sourceAgent,
  sourceId,
  title,
  project,
  excerpt,
  percent,
  onComplete,
}: {
  sessionId: string
  sourceKind: string
  sourceAgent?: string
  sourceId: string
  title: string
  project: string
  excerpt: string
  percent: number | null
  onComplete: (nextId: string | null, kind?: string) => void
}) {
  const t = useTranslations('chatDesktop')
  const rootRef = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const limited = (percent ?? 0) >= 85

  useEffect(() => {
    setHidden(typeof window !== 'undefined' && window.sessionStorage.getItem(dismissKey(sessionId)) === '1')
    setOpen(false)
    setError(null)
  }, [sessionId])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (hidden) return null

  const dismiss = () => {
    window.sessionStorage.setItem(dismissKey(sessionId), '1')
    setHidden(true)
  }

  const confirm = async (agent: FleetAgentName, model: string) => {
    setBusy(true)
    const targetKind = handoffKindFromAgent(agent)
    try {
      const data = await apiFetch<Record<string, unknown>>('/api/sessions/handoff', {
        method: 'POST',
        body: JSON.stringify({
          sourceKind,
          sourceAgent,
          sourceId,
          targetKind,
          targetAgent: agent,
          targetModel: model,
          title,
          project,
          excerpt,
        }),
      })
      const nextId = [data.sessionId, data.id, data.conversationId].find(looksReal) ?? null
      const nextKind = typeof data.kind === 'string' ? data.kind : targetKind
      setOpen(false)
      setError(null)
      onComplete(nextId, nextKind)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Handoff failed')
      onComplete(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative mb-2">
      <div className="flex items-start gap-3 rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] px-3 py-2.5">
        <IconClock className="mt-0.5 h-4 w-4 text-[var(--chat-muted)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-[var(--chat-text)]">{limited ? t('sessionLimitReached') : t('handoffSession')}</p>
          {percent != null ? <p className="text-[12px] text-[var(--chat-muted)]">{Math.round(percent)}%</p> : null}
          {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="cursor-pointer rounded-md bg-white/10 px-2.5 py-1 text-[12px] text-[var(--chat-text)] duration-200 hover:bg-white/15 disabled:opacity-40"
          aria-expanded={open}
          aria-label={t('handoff')}
          disabled={busy}
        >
          {t('handoff')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="cursor-pointer rounded p-1 text-[var(--chat-muted)] duration-200 hover:text-[var(--chat-text)]"
          aria-label={t('dismissBanner')}
        >
          <IconClose />
        </button>
      </div>
      {open && <HandoffPicker onConfirm={(agent, model) => { void confirm(agent, model) }} busy={busy} />}
    </div>
  )
}
