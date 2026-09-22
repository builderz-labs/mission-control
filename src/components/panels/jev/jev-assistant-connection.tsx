'use client'

import { useState } from 'react'
import type { JevAssistantOption, JevAssistantProviderKind } from '@/lib/jev-assistant-config'

export function JevAssistantConnection({ options, selected, disabled, onChange, compact = false }: {
  options: JevAssistantOption[]
  selected: JevAssistantProviderKind
  disabled: boolean
  onChange: (kind: JevAssistantProviderKind) => void
  /** Collapse to a small "provider · status" badge that expands to the full picker on click — for stages after the provider was already chosen. */
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const current = options.find((item) => item.kind === selected)

  if (compact && !expanded) {
    return <button type="button" onClick={() => setExpanded(true)} className="mb-3 flex items-center gap-1.5 text-xs text-[var(--chat-muted)] hover:text-[var(--chat-text)]">
      <span aria-hidden>⚙</span>
      <span>{current?.label ?? selected}{current?.configured ? ' · Connected' : ' · Not connected'}</span>
      <span className="underline">Change</span>
    </button>
  }

  return <div className="mb-3 space-y-2 text-xs text-[var(--chat-muted)]">
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="jev-setup-provider">Setup assistant</label>
      <select id="jev-setup-provider" value={selected} disabled={disabled} onChange={(event) => onChange(event.target.value as JevAssistantProviderKind)} className="max-w-full rounded-md border border-[var(--chat-border)] bg-[var(--chat-elevated)] px-2 py-1.5 text-[var(--chat-text)]">
        {options.map((option) => <option key={option.kind} value={option.kind}>{option.label}{option.configured ? '' : ' · Not connected'}</option>)}
      </select>
      <span>{current?.configured ? `${current.model} · ${selected === 'claude-cli' ? 'Signed in' : 'Key configured; verified when used'}` : 'Connection required'}</span>
      {compact && <button type="button" onClick={() => setExpanded(false)} className="text-[var(--chat-muted)] underline">Done</button>}
    </div>
    <p>Your description and setup choices go to this assistant. Repository files are not sent during setup. No tools or repository writes are allowed.</p>
    {!current?.configured && <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer font-medium text-foreground">How to connect this assistant</summary>
      <p className="mt-2">{selected === 'claude-cli'
        ? 'Sign in to Claude Code on the Mission Control host, then refresh this page. Your Jev key does not sign you in to Claude.'
        : `An administrator can add ${selected === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in Doppler → Mission Control → Backend → prd, then restart the backend and refresh. Keep the key out of this chat.`}</p>
      <p className="mt-2">The setup assistant designs your questions. Your separate Jev connection evaluates the evidence you approve.</p>
    </details>}
  </div>
}
