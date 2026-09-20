'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { JevAnswerCards } from './jev-answer-cards'
import type {
  JevPolicy,
  JevRepositoryContext,
  JevRunResult,
  JevState,
} from './jev-ui-types'

const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-void-cyan'

export function JevWorkbench({
  policies, selectedId, canRun, disabledReason, onSelect, onRun, onLoadContext,
}: {
  policies: JevPolicy[]
  selectedId: number | null
  canRun: boolean
  disabledReason?: string
  onSelect: (id: number | null) => void
  onRun: (policyId: number, state: JevState, retain: boolean) => Promise<JevRunResult>
  onLoadContext: () => Promise<JevRepositoryContext>
}) {
  const [stateText, setStateText] = useState('')
  const [format, setFormat] = useState<'text' | 'json'>('text')
  const [retain, setRetain] = useState(false)
  const [running, setRunning] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<JevRunResult | null>(null)
  const [contextInfo, setContextInfo] = useState<JevRepositoryContext | null>(null)
  const enabled = useMemo(() => policies.filter((policy) => policy.enabled), [policies])
  const selected = enabled.find((policy) => policy.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId && enabled[0]) onSelect(enabled[0].id)
  }, [enabled, onSelect, selectedId])

  const loadContext = async () => {
    setLoadingContext(true)
    try {
      const context = await onLoadContext()
      setFormat('json')
      setStateText(JSON.stringify(context.state, null, 2))
      setContextInfo(context)
      setResult(null)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load repository context')
    } finally {
      setLoadingContext(false)
    }
  }

  const run = async () => {
    if (!selectedId) return
    setRunning(true)
    try {
      const state: JevState = format === 'json' ? JSON.parse(stateText) as JevState : stateText
      setResult(await onRun(selectedId, state, retain))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evaluation failed')
    } finally {
      setRunning(false)
    }
  }

  if (policies.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center"><p className="text-sm font-medium text-foreground">Choose a starter policy above</p><p className="mt-1 text-xs text-muted-foreground">A policy is simply the set of questions Jev will answer.</p></div>
  }

  return (
    <section className="space-y-4" aria-labelledby="jev-workbench-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h2 id="jev-workbench-title" className="text-sm font-semibold text-foreground">Evaluate this repository</h2><p className="mt-1 text-xs text-muted-foreground">Load a safe snapshot or paste only the evidence needed for your question.</p></div>
        <Button variant="outline" size="sm" onClick={() => void loadContext()} disabled={!canRun || loadingContext}>{loadingContext ? 'Collecting context…' : 'Load repository context'}</Button>
      </div>
      {contextInfo && (
        <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-muted-foreground">
          <strong className="text-emerald-300">Context ready.</strong> {contextInfo.localAvailable ? `${contextInfo.trackedFileCount} representative paths and ${contextInfo.includedFiles.length} safe reference files were included.` : 'Project metadata was included; no safe local checkout was available.'}
          <p className="mt-1">Raw source, credential files, and environment files are excluded. You can review and edit everything below before sending it.</p>
          {contextInfo.warnings.map((warning) => <p key={warning} className="mt-1 text-amber-300">{warning}</p>)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <label className="text-xs text-muted-foreground">Evaluation goal<select className={`${field} mt-1`} value={selectedId ?? ''} onChange={(event) => onSelect(Number(event.target.value))}>{enabled.map((policy) => <option value={policy.id} key={policy.id}>{policy.name}</option>)}</select></label>
        <label className="text-xs text-muted-foreground">Context format<select className={`${field} mt-1`} value={format} onChange={(event) => setFormat(event.target.value as 'text' | 'json')}><option value="text">Plain text</option><option value="json">Structured JSON</option></select></label>
      </div>
      {selected?.description && <p className="rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"><strong className="text-foreground">What this asks:</strong> {selected.description}</p>}
      <label className="block text-xs text-muted-foreground">Context Jev will evaluate<textarea className={`${field} mt-1 min-h-64 resize-y font-mono text-xs`} value={stateText} onChange={(event) => { setStateText(event.target.value); setContextInfo(null); setResult(null) }} placeholder={format === 'json' ? '{"goal":"What should this change accomplish?","evidence":{"tests":"…"}}' : 'Describe the goal, implementation, tests, risks, and any missing evidence…'} /></label>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={retain} onChange={(event) => setRetain(event.target.checked)} /><span>Keep a maximum 500-character preview in history. Off by default.</span></label>
        <Button onClick={() => void run()} disabled={!canRun || running || !stateText.trim() || !selectedId}>{running ? 'Evaluating…' : canRun ? 'Evaluate with Jev' : disabledReason ?? 'Unavailable'}</Button>
      </div>
      {!canRun && disabledReason && <p className="text-right text-xs text-amber-300">{disabledReason}</p>}
      {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {result && <JevAnswerCards result={result} />}
    </section>
  )
}
