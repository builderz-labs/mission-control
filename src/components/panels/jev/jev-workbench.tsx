'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  policies, selectedId, visibleQuestionIds, canRun, disabledReason, onSelect, onRun, onLoadContext,
}: {
  policies: JevPolicy[]
  selectedId: number | null
  visibleQuestionIds?: Set<string>
  canRun: boolean
  disabledReason?: string
  onSelect: (id: number | null) => void
  onRun: (policyId: number, state: JevState, retain: boolean) => Promise<JevRunResult>
  onLoadContext: (policyId: number) => Promise<JevRepositoryContext>
}) {
  const [stateText, setStateText] = useState('')
  const [format, setFormat] = useState<'text' | 'json'>('text')
  const [retain, setRetain] = useState(false)
  const [running, setRunning] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<JevRunResult | null>(null)
  const [contextInfo, setContextInfo] = useState<JevRepositoryContext | null>(null)
  const requestRef = useRef(0)
  const enabled = useMemo(() => policies.filter((policy) => policy.enabled), [policies])
  const selected = enabled.find((policy) => policy.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId && enabled[0]) onSelect(enabled[0].id)
  }, [enabled, onSelect, selectedId])

  useEffect(() => {
    requestRef.current += 1
    setResult(null); setError(null); setContextInfo(null); setRunning(false); setLoadingContext(false)
  }, [selectedId])

  useEffect(() => {
    setRetain(selected?.configuration?.retainPreview ?? false)
  }, [selected])

  const loadContext = async () => {
    if (!selected || !canRun || running || loadingContext) return
    if (stateText.trim() && !window.confirm('Replace the context you typed with a safe repository snapshot?')) return
    const requestId = ++requestRef.current
    setLoadingContext(true)
    try {
      const context = await onLoadContext(selected.id)
      if (requestId !== requestRef.current) return
      setFormat('json')
      setStateText(JSON.stringify(context.state, null, 2))
      setContextInfo(context)
      setResult(null)
      setError(null)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      setError(cause instanceof Error ? cause.message : 'Unable to load repository context')
    } finally {
      if (requestId === requestRef.current) setLoadingContext(false)
    }
  }

  const run = async () => {
    if (!selected || !canRun || running || loadingContext || !stateText.trim()) return
    const requestId = ++requestRef.current
    setRunning(true)
    try {
      const state: JevState = format === 'json' ? JSON.parse(stateText) as JevState : stateText
      const nextResult = await onRun(selected.id, state, retain)
      if (requestId !== requestRef.current) return
      setResult(nextResult)
      setError(null)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      setError(cause instanceof Error ? cause.message : 'Evaluation failed')
    } finally {
      if (requestId === requestRef.current) setRunning(false)
    }
  }

  if (policies.length === 0) {
    return <div className="m-auto rounded-lg border border-dashed border-border bg-card/40 p-8 text-center"><p className="text-sm font-medium text-foreground">Create an evaluation setup first</p><p className="mt-1 text-xs text-muted-foreground">A policy is simply the set of questions Jev will answer.</p></div>
  }
  if (enabled.length === 0) return <div role="status" className="m-auto p-8 text-center text-sm text-muted-foreground">All evaluation setups are paused. Open Policies and enable a setup before running Jev.</div>

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="jev-workbench-title">
      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-[var(--chat-border)] bg-[var(--chat-elevated)] px-3 py-2 md:px-5">
        <h2 id="jev-workbench-title" className="sr-only">Evaluate this repository</h2>
        <label className="min-w-44 flex-1 text-[11px] text-muted-foreground">Evaluation goal<select className={`${field} mt-0.5 h-8 py-1`} value={selectedId ?? ''} onChange={(event) => onSelect(Number(event.target.value))}>{enabled.map((policy) => <option value={policy.id} key={policy.id}>{policy.name}</option>)}</select></label>
        <label className="w-36 text-[11px] text-muted-foreground">Context format<select disabled={running || loadingContext} className={`${field} mt-0.5 h-8 py-1`} value={format} onChange={(event) => { setFormat(event.target.value as 'text' | 'json'); setResult(null) }}><option value="text">Plain text</option><option value="json">Structured JSON</option></select></label>
        {selected?.configuration?.contextMode !== 'pasted' && <Button variant="outline" size="sm" onClick={() => void loadContext()} disabled={!canRun || loadingContext || running}>{loadingContext ? 'Collecting…' : selected?.configuration?.contextMode === 'metadata_only' ? 'Load repository metadata' : 'Load repository context'}</Button>}
        <Button size="sm" onClick={() => void run()} disabled={!canRun || running || loadingContext || !stateText.trim() || !selected}>{running ? 'Evaluating…' : canRun ? 'Evaluate with Jev' : disabledReason ?? 'Unavailable'}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
        <div className="mx-auto max-w-7xl space-y-4">
          <div><h3 className="text-sm font-semibold text-foreground">Evaluate this repository</h3><p className="mt-1 text-xs text-muted-foreground">Load a safe snapshot or paste only the evidence needed for your question.</p></div>
          {selected?.description && <p className="rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"><strong className="text-foreground">What this asks:</strong> {selected.description}</p>}
          {contextInfo && (
            <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-muted-foreground">
              <strong className="text-emerald-300">Context ready.</strong> {contextInfo.localAvailable ? `${contextInfo.trackedFileCount} representative paths and ${contextInfo.includedFiles.length} safe reference files were included.` : 'Project metadata was included; no safe local checkout was available.'}
              <p className="mt-1">Raw source, credential files, and environment files are excluded. Review and edit everything below before sending it.</p>
              {contextInfo.warnings.map((warning) => <p key={warning} className="mt-1 text-amber-300">{warning}</p>)}
            </div>
          )}
          <label className="block text-xs text-muted-foreground">Context Jev will evaluate<textarea disabled={running || loadingContext} maxLength={200000} className={`${field} mt-1 min-h-52 resize-y font-mono text-xs`} value={stateText} onChange={(event) => { setStateText(event.target.value); setContextInfo(null); setResult(null) }} placeholder={format === 'json' ? '{"goal":"What should this change accomplish?","evidence":{"tests":"…"}}' : 'Describe the goal, implementation, tests, risks, and any missing evidence…'} /></label>
          {selected?.configuration ? <p className="text-xs text-muted-foreground">History preview: <strong className="text-foreground">{retain ? 'up to 500 redacted characters' : 'off'}</strong>, as approved in this policy.</p> : <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" disabled={running || loadingContext} className="mt-0.5" checked={retain} onChange={(event) => setRetain(event.target.checked)} /><span>Keep a maximum 500-character redacted preview in history. Off by default.</span></label>}
          {!canRun && disabledReason && <p className="text-xs text-amber-300">{disabledReason}</p>}
          {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          {result && <JevAnswerCards result={result} configuration={selected?.configuration} visibleQuestionIds={visibleQuestionIds} />}
        </div>
      </div>
    </section>
  )
}
