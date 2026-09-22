'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { JEV_POLICY_TEMPLATES, type JevPolicyTemplate } from './jev-templates'
import type { JevPolicy, JevPolicyInput } from './jev-ui-types'

export function JevQuickstart({
  canCreate, onCreate, onReady,
}: {
  canCreate: boolean
  onCreate: (input: JevPolicyInput) => Promise<JevPolicy>
  onReady: (policy: JevPolicy) => void
}) {
  const [creating, setCreating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (template: JevPolicyTemplate) => {
    setCreating(template.id)
    try {
      const policy = await onCreate(template.policy)
      setError(null)
      onReady(policy)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the starter policy')
    } finally {
      setCreating(null)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-void-cyan/30 bg-void-cyan/5 p-4" aria-labelledby="jev-start-title">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-void-cyan">Start here</p>
        <h2 id="jev-start-title" className="mt-1 text-base font-semibold text-foreground">Your first evaluation takes three steps</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose a goal, load a privacy-safe repository snapshot, then run it. Jev returns probabilities—not an automatic command or code change.</p>
      </div>
      <ol className="grid gap-2 text-xs sm:grid-cols-3">
        <li className="rounded-lg border border-border bg-card p-3"><strong className="text-foreground">1. Choose a goal</strong><p className="mt-1 text-muted-foreground">Start with a tested policy below.</p></li>
        <li className="rounded-lg border border-border bg-card p-3"><strong className="text-foreground">2. Load context</strong><p className="mt-1 text-muted-foreground">Mission Control gathers safe project facts.</p></li>
        <li className="rounded-lg border border-border bg-card p-3"><strong className="text-foreground">3. Review probabilities</strong><p className="mt-1 text-muted-foreground">You remain responsible for the decision.</p></li>
      </ol>
      <div className="grid gap-3 lg:grid-cols-3">
        {JEV_POLICY_TEMPLATES.map((template) => (
          <article key={template.id} className="flex flex-col rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2"><h3 className="text-sm font-medium text-foreground">{template.title}</h3>{template.recommended && <span className="rounded-full bg-void-cyan/15 px-2 py-0.5 text-[10px] text-void-cyan">Recommended</span>}</div>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{template.summary}</p>
            <Button className="mt-3" size="sm" variant={template.recommended ? 'default' : 'outline'} disabled={!canCreate || creating !== null} onClick={() => void choose(template)}>{creating === template.id ? 'Creating…' : canCreate ? `Use ${template.title}` : 'Operator access required'}</Button>
          </article>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </section>
  )
}
