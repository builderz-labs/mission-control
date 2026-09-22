'use client'

import { useState } from 'react'
import type { JevEvaluation, JevPolicy, JevRepositoryContext, JevRunResult, JevState } from './jev-ui-types'
import { answerBucket, humanize, RUN_SCOPES } from './jev-sorter-data'
import { JevSorterCards, type SorterFilter } from './jev-sorter-cards'
import { JevSorterEvidence } from './jev-sorter-evidence'
import { JevFlowSteps } from './jev-flow-steps'
import { useJevSorter } from './use-jev-sorter'
import './jev-sorter.css'

interface Props {
  policies: JevPolicy[]; selectedId: number | null; evaluations: JevEvaluation[]
  visibleQuestionIds: Set<string>; canRun: boolean; canManage: boolean; disabledReason?: string
  onSelect: (id: number | null) => void; onRefresh: () => Promise<boolean>; onAssistant: () => void
  onToggleQuestion: (id: string) => void; onEditQuestion: (policy: JevPolicy, id: string) => void
  onAddQuestion: (policy: JevPolicy) => void
  onRun: (id: number, state: JevState, retain: boolean) => Promise<JevRunResult>
  onLoadContext: (id: number) => Promise<JevRepositoryContext>
}

export function JevSorterWorkspace(props: Props) {
  const selected = props.policies.find((policy) => policy.id === props.selectedId)
  if (!selected) return <div className="jev-sorter jev-sorter-empty"><h2>Create an evaluation setup first</h2>
    <p>Tell the assistant what you want to sort. Review its questions, then your dashboard will appear here.</p>
    <button type="button" onClick={props.onAssistant}>Open setup assistant</button></div>
  return <Workspace key={JSON.stringify([selected.id, selected.project_id, selected.questions, selected.model])} {...props} policy={selected} />
}

function Workspace({ policy, ...props }: Props & { policy: JevPolicy }) {
  const data = useJevSorter(policy, props.evaluations, props.onRun, props.onLoadContext)
  const [filter, setFilter] = useState<SorterFilter | null>(null)
  const [search, setSearch] = useState('')
  const [threshold, setThreshold] = useState(50)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const canRun = props.canRun && policy.enabled
  const busy = data.running || data.busy
  const filtered = data.rows.filter((row) => (!filter || answerBucket(row.evaluation.answers?.[filter.question], policy.questions[filter.question], threshold / 100) === filter.bucket)
    && (!search.trim() || JSON.stringify(row.evaluation.answers).toLowerCase().includes(search.trim().toLowerCase())))
  const latest = Math.max(0, ...data.rows.map((row) => row.evaluation.completed_at ?? 0))
  const refresh = async () => {
    setRefreshing(true); setRefreshError(false)
    try { if (await props.onRefresh() !== true) setRefreshError(true); else data.reconciled() }
    catch { setRefreshError(true) } finally { setRefreshing(false) }
  }
  const exportResults = () => {
    const blob = new Blob([JSON.stringify({ policy: { name: policy.name, questions: policy.questions },
      yesThreshold: threshold / 100, exportedAt: new Date().toISOString(),
      results: filtered.map(({ evaluation }) => ({ id: evaluation.id, model: evaluation.model_resolved,
        answers: evaluation.answers, inputTokens: evaluation.usage_input_tokens, outputTokens: evaluation.usage_output_tokens,
        latencyMs: evaluation.latency_ms, completedAt: evaluation.completed_at })),
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `jev-results-${policy.id}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="jev-sorter" aria-label="Jev sorter workspace">
    <nav className="jev-sorter-tabs" aria-label="Evaluation setups">
      {props.policies.map((item) => <button key={item.id} type="button" disabled={busy} aria-current={item.id === policy.id ? 'page' : undefined}
        onClick={() => props.onSelect(item.id)}>{item.name}{!item.enabled ? ' · Paused' : ''}</button>)}
    </nav>
    <div className="jev-sorter-body">
      <aside className="jev-sorter-questions" aria-label="Questions">
        <header><h2>Questions</h2>{props.canManage && <button type="button" disabled={busy} onClick={() => props.onAddQuestion(policy)}>＋ New</button>}</header>
        {Object.entries(policy.questions).map(([id, question]) => <div className="jev-sorter-question" key={id}>
          <label><input type="checkbox" checked={props.visibleQuestionIds.has(id)} onChange={() => props.onToggleQuestion(id)} aria-label={`Show ${humanize(id)} result card`} />
            <span>{humanize(id)}<small>{question.type === 'noul' ? 'Yes / No' : question.type === 'choice' ? 'Category' : 'Score'}</small></span></label>
          {props.canManage && <button type="button" aria-label={`Edit ${humanize(id)}`} disabled={busy} onClick={() => props.onEditQuestion(policy, id)}>✎</button>}
        </div>)}
        <p className="jev-sorter-muted">Checkboxes show or hide cards. Every run answers all saved questions.</p>
        {Object.values(policy.questions).some((question) => question.type === 'noul') && <label className="jev-sorter-threshold">Call it Yes at
          <input aria-label="Yes probability threshold" type="number" min={1} max={100} value={threshold} onChange={(event) => {
            const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 100) setThreshold(value)
          }} />% probability
          <small>Recounts these cards instantly, without another API call. View-only; resets to 50% when reopened.</small>
        </label>}
      </aside>
      <div className="jev-sorter-main">
        <JevFlowSteps current={data.rows.length ? 'results' : 'evaluate'} onBack={props.onAssistant} backLabel="Back to setup" backDisabled={busy} />
        <header className="jev-sorter-heading"><div><h2>{policy.name}</h2><p>{policy.description || 'Sort evidence using the questions from this chat.'}</p></div>
          <div className="jev-sorter-actions"><div className="jev-sorter-updated"><span>{data.items.length || data.rows.length} unique items</span><small>{latest ? `Latest result ${new Date(latest * 1000).toLocaleString()}` : 'No completed results yet'}</small></div>
            <button type="button" disabled={busy || refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button></div>
        </header>
        <div className="jev-sorter-toolbar">
          <div role="status" aria-live="polite">{data.running ? `Sorting ${data.progress.done} of ${data.progress.total}… Keep this tab open.`
            : data.notice || (data.rows.length ? 'All caught up. Select any result below to filter items.' : 'Add evidence below to see your first results.')}<small>Saved results from the latest 200 project evaluations; current questions and model only.</small></div>
          <div className="jev-sorter-actions">
            <select aria-label="Evaluation model" value={policy.model} disabled><option value={policy.model}>Jev · {policy.model}</option></select>
            <select aria-label="Run scope" value={data.scope} disabled={busy} onChange={(event) => data.setScope(event.target.value as typeof data.scope)}>{RUN_SCOPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {data.running ? <button type="button" onClick={data.stop}>Stop after current item</button>
              : <button type="button" className="jev-sorter-run" disabled={!canRun || busy || data.needsRefresh || !data.pending.length} onClick={() => void data.run()}>▷ Run{data.pending.length ? ` ${data.pending.length}` : ''}</button>}
          </div>
        </div>
        {data.error ? <p role="alert" className="jev-sorter-error">{data.error}</p>
          : refreshError ? <p role="alert" className="jev-sorter-error">Unable to refresh results. Try again.</p>
            : !canRun ? <p role="status">{!policy.enabled ? 'This setup is paused. Open Policies to enable it.' : props.disabledReason}</p>
              : data.pending.length > 0 ? <p className="jev-sorter-muted">Run sends {data.pending.length} reviewed item(s) to TypeSafe. Usage may be billed; requests are paced to at most 10/minute. {data.scope !== 'unsorted' ? 'This scope can re-evaluate previously sorted items.' : ''}</p> : null}
        <JevSorterCards policy={policy} rows={data.rows} visible={props.visibleQuestionIds} threshold={threshold / 100} filter={filter} onFilter={setFilter} />
        <div className="jev-sorter-result-tools"><input type="search" aria-label="Search results" placeholder="Search results" value={search} onChange={(event) => setSearch(event.target.value)} />
          {filter && <button type="button" onClick={() => setFilter(null)}>Clear {humanize(filter.question)} filter</button>}
          <span>{filtered.length} results</span><button type="button" disabled={!filtered.length} onClick={exportResults}>↓ Export JSON</button></div>
        <details className="jev-sorter-records"><summary>View {filtered.length} result records</summary>
          <p className="jev-sorter-muted">Score bars use the nearest level; averages preserve fractional scores. Probabilities are model judgments, not guarantees.</p>
          {filtered.slice(0, 100).map(({ evaluation }) => <details key={evaluation.id}><summary>{evaluation.id.slice(0, 8)} · {evaluation.model_resolved} · {evaluation.latency_ms} ms</summary><pre>{JSON.stringify(evaluation.answers, null, 2)}</pre></details>)}
          {filtered.length > 100 && <p>Showing the first 100. Export includes all filtered results.</p>}
          {!filtered.length && <p>No results match.</p>}
        </details>
        <JevSorterEvidence policy={policy} data={data} canRun={canRun} />
      </div>
    </div>
  </section>
}
