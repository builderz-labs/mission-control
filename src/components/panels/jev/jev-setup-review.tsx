'use client'

import { Button } from '@/components/ui/button'
import type { JevAssistantResponse } from './jev-ui-types'

const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-void-cyan'

export function JevSetupReview({
  response, schemaText, saving, revising, error, onDraftChange, onSchemaChange, onRevise, onSave, onBack,
}: {
  response: JevAssistantResponse
  schemaText: string
  saving: boolean
  revising: boolean
  error: string | null
  onDraftChange: (field: 'summary' | 'name' | 'description', value: string) => void
  onSchemaChange: (value: string) => void
  onRevise: (instruction: string) => void
  onSave: () => void
  onBack: () => void
}) {
  const { draft, configuration } = response
  const repositoryCount = configuration.projectIds.length || 1
  const repositoryLabel = repositoryCount === 1
    ? 'Save to 1 repository'
    : `Save to ${repositoryCount} repositories`
  return (
    <section aria-labelledby="jev-review-title" className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div><p className="text-xs font-medium uppercase tracking-wide text-void-cyan">Review</p><h2 id="jev-review-title" className="mt-1 text-lg font-semibold text-foreground">Approve the policy before anything is saved</h2><p className="mt-1 text-sm text-muted-foreground">The assistant drafted this setup. Jev has not evaluated context yet.</p></div>
      {response.warnings.map((warning) => <div key={warning} role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{warning}</div>)}
      <div className="grid gap-3">
        <label className="text-xs text-muted-foreground">Policy name<input className={`${field} mt-1`} value={draft.name} maxLength={120} onChange={(event) => onDraftChange('name', event.target.value)} /></label>
        <label className="text-xs text-muted-foreground">Plain-language summary<textarea className={`${field} mt-1 min-h-20 resize-y`} value={draft.summary} maxLength={2000} onChange={(event) => onDraftChange('summary', event.target.value)} /></label>
        <label className="text-xs text-muted-foreground">Purpose<textarea className={`${field} mt-1 min-h-16 resize-y`} value={draft.description} maxLength={1000} onChange={(event) => onDraftChange('description', event.target.value)} /></label>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <Fact label="Scope" value={`${configuration.scope} · ${configuration.projectIds.length} repo${configuration.projectIds.length === 1 ? '' : 's'}`} />
        <Fact label="Run" value={`${configuration.trigger} · ${configuration.enforcement}`} />
        <Fact label="Privacy" value={`${configuration.contextMode} · ${configuration.retainPreview ? 'short preview retained' : 'no context retained'}`} />
      </div>
      <details className="rounded-lg border border-border bg-background/40 p-3" open>
        <summary className="cursor-pointer text-sm font-medium text-foreground">Editable Jev schema</summary>
        <p className="mt-1 text-xs text-muted-foreground">Only Noul, Choice, and Score questions are sent to Jev. This JSON is validated again when saved.</p>
        <textarea aria-label="Editable Jev schema" className={`${field} mt-3 min-h-64 resize-y font-mono text-xs`} value={schemaText} onChange={(event) => onSchemaChange(event.target.value)} />
      </details>
      <div className="grid gap-3 lg:grid-cols-3">
        <Plan title="Tests" items={draft.tests} /><Plan title="Risks" items={draft.risks} /><Plan title="Observe" items={draft.observability} />
      </div>
      <Revision disabled={revising || saving} onSubmit={onRevise} />
      {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row"><Button variant="ghost" onClick={onBack}>Back</Button><Button onClick={onSave} disabled={saving || revising}>{saving ? 'Saving policy…' : repositoryLabel}</Button></div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-background p-3"><span className="text-muted-foreground">{label}</span><strong className="mt-1 block capitalize text-foreground">{value.replaceAll('_', ' ')}</strong></div>
}

function Plan({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-md border border-border bg-background p-3"><h3 className="text-xs font-semibold text-foreground">{title}</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>
}

function Revision({ disabled, onSubmit }: { disabled: boolean; onSubmit: (value: string) => void }) {
  return <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const value = String(form.get('revision') || '').trim(); if (value) onSubmit(value) }}><input name="revision" aria-label="Revise with assistant" className={`${field} min-w-0 flex-1`} placeholder="Revise with the assistant, e.g. “make this stricter”…" disabled={disabled} /><Button type="submit" variant="outline" disabled={disabled}>{disabled ? 'Revising…' : 'Revise draft'}</Button></form>
}
