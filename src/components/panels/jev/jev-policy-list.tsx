'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { JevPolicy } from './jev-ui-types'

export function JevPolicyList({
  policies, canManage, onEdit, onToggle, onDelete,
}: {
  policies: JevPolicy[]
  canManage: boolean
  onEdit: (policy: JevPolicy) => void
  onToggle: (policy: JevPolicy) => Promise<void>
  onDelete: (policy: JevPolicy) => Promise<void>
}) {
  const [pending, setPending] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (policy: JevPolicy, action: (value: JevPolicy) => Promise<void>) => {
    setPending(policy.id); setError(null)
    try { await action(policy) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Policy update failed') }
    finally { setPending(null) }
  }
  if (policies.length === 0) return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No Jev policies exist for this repository.</div>
  return (
    <div className="space-y-3">
      {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      <div className="grid gap-3 md:grid-cols-2">
      {policies.map((policy) => (
        <article key={policy.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-foreground">{policy.name}</h3><p className="mt-1 text-xs text-muted-foreground">{policy.description || 'No description'}</p></div>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${policy.enabled ? 'border-emerald-500/30 text-emerald-400' : 'border-border text-muted-foreground'}`}>{policy.enabled ? policy.mode : 'disabled'}</span>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-muted-foreground">Model</dt><dd className="font-mono text-foreground">{policy.model}</dd></div><div><dt className="text-muted-foreground">Questions</dt><dd className="text-foreground">{Object.keys(policy.questions).length}</dd></div></dl>
          {policy.configuration && <p className="text-xs capitalize text-muted-foreground">{policy.configuration.scope} scope · {policy.configuration.trigger.replaceAll('_', ' ')} · {policy.configuration.enforcement}</p>}
          {canManage && <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" size="sm" disabled={pending === policy.id} onClick={() => onEdit(policy)}>Edit</Button><Button variant="outline" size="sm" disabled={pending === policy.id} onClick={() => void run(policy, onToggle)}>{pending === policy.id ? 'Saving…' : policy.enabled ? 'Disable' : 'Enable'}</Button><Button variant="ghost" size="sm" disabled={pending === policy.id} className="text-red-400" onClick={() => void run(policy, onDelete)}>Delete</Button></div>}
        </article>
      ))}
      </div>
    </div>
  )
}
