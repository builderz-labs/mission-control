'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { JevEvaluation, JevPolicy, JevRepositoryContext, JevRunResult, JevState } from './jev-ui-types'
import { fingerprintDataset, parseDataset, runItems, savedRows, type DatasetFormat, type RunScope, type SorterItem } from './jev-sorter-data'

export function useJevSorter(policy: JevPolicy, evaluations: JevEvaluation[], onRun: (
  policyId: number, state: JevState, retain: boolean,
) => Promise<JevRunResult>, onLoadContext: (id: number) => Promise<JevRepositoryContext>) {
  const [text, setText] = useState('')
  const [format, setFormat] = useState<DatasetFormat>('text')
  const [items, setItems] = useState<SorterItem[]>([])
  const [localResults, setLocalResults] = useState<JevEvaluation[]>([])
  const [scope, setScope] = useState<RunScope>('unsorted')
  const [retain, setRetain] = useState(policy.configuration?.retainPreview ?? false)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const operation = useRef(0)
  const locked = useRef(false)
  const stopped = useRef(false)
  const signature = JSON.stringify([policy.id, policy.project_id, policy.questions, policy.model])
  useEffect(() => () => { operation.current += 1; stopped.current = true }, [signature])
  const rows = useMemo(() => savedRows([...localResults, ...evaluations], policy), [localResults, evaluations, policy])
  const visibleRows = items.length ? rows.filter((row) => items.some((item) => item.hash === row.hash)) : rows
  const pending = runItems(items, rows, scope)

  const edit = (value: string) => { setText(value); setItems([]); setNotice(''); setError(null) }
  const changeFormat = (value: DatasetFormat) => { setFormat(value); setItems([]); setNotice(''); setError(null) }
  const prepare = async () => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(null)
    const current = ++operation.current
    try {
      const parsed = parseDataset(text, format)
      const next = await fingerprintDataset(parsed)
      if (current !== operation.current) return
      setItems(next)
      setNotice(`${next.length} unique item${next.length === 1 ? '' : 's'} ready. ${parsed.length - next.length} duplicates excluded. Review the text before sending.`)
    } catch (cause) {
      if (current === operation.current) setError(cause instanceof Error ? cause.message : 'Unable to prepare dataset.')
    } finally { if (current === operation.current) { locked.current = false; setBusy(false) } }
  }
  const loadContext = async () => {
    if (locked.current || (text.trim() && !window.confirm('Replace the current evidence with a repository snapshot?'))) return
    locked.current = true; setBusy(true); setError(null)
    const current = ++operation.current
    try {
      const context = await onLoadContext(policy.id)
      if (current !== operation.current) return
      setText(JSON.stringify(context.state, null, 2)); setFormat('json'); setItems([])
      setNotice(`Context ready. Review it, then prepare the dataset. ${context.warnings.join(' ')}`)
    } catch { if (current === operation.current) setError('Could not load repository context. Try again; no data was sent to Jev.') }
    finally { if (current === operation.current) { locked.current = false; setBusy(false) } }
  }
  const run = async () => {
    if (locked.current || needsRefresh || pending.length === 0) return
    locked.current = true; stopped.current = false; setRunning(true); setError(null)
    const current = ++operation.current
    const queue = [...pending]
    setProgress({ done: 0, total: queue.length })
    try {
      for (const [index, item] of queue.entries()) {
        // Keep the shared 10/minute heavy-operation limit; never widen server permissions.
        if (index > 0) await new Promise((resolve) => setTimeout(resolve, 6500))
        if (stopped.current || current !== operation.current) break
        const result = await onRun(policy.id, item.state, policy.configuration?.retainPreview ?? retain)
        if (current !== operation.current) return
        const now = Math.floor(Date.now() / 1000)
        setLocalResults((previous) => [{
          id: result.id, workspace_id: policy.workspace_id, project_id: policy.project_id, policy_id: policy.id,
          model_requested: policy.model, model_resolved: result.model, questions: policy.questions,
          status: 'succeeded', answers: result.answers, usage_input_tokens: result.usage.input_tokens,
          usage_output_tokens: result.usage.output_tokens, latency_ms: result.latencyMs,
          request_id: result.requestId, state_sha256: item.hash,
          state_length: (typeof item.state === 'string' ? item.state : JSON.stringify(item.state)).length,
          state_preview: null, error_code: null, created_by: '', created_at: now, completed_at: now,
        }, ...previous])
        setProgress({ done: index + 1, total: queue.length })
      }
      if (current === operation.current) setNotice(stopped.current ? 'Stopped. Completed results are saved.' : 'Evaluation complete. Select a result below to filter items.')
    } catch {
      if (current === operation.current) {
        setNeedsRefresh(true)
        setError('Run stopped because a request failed or was rate-limited. Completed results are saved. Refresh before retrying “Anything not sorted yet”; check History for the failed request.')
      }
    } finally {
      if (current === operation.current) { locked.current = false; setRunning(false) }
    }
  }
  return { text, format, items, rows: visibleRows, scope, setScope, retain, setRetain, busy, running,
    error, notice, progress, pending, edit, changeFormat, prepare, loadContext, run, needsRefresh,
    reconciled: () => { setNeedsRefresh(false); setError(null) },
    stop: () => { stopped.current = true; setNotice('Stopping after the current request…') } }
}
