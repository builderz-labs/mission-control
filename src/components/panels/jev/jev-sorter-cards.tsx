'use client'

import { useState } from 'react'
import type { JevPolicy } from './jev-ui-types'
import { humanize, summarizeQuestion, type SorterRow } from './jev-sorter-data'

export interface SorterFilter { question: string; bucket: string }
export function JevSorterCards({ policy, rows, visible, threshold, filter, onFilter }: {
  policy: JevPolicy; rows: SorterRow[]; visible: Set<string>; threshold: number
  filter: SorterFilter | null; onFilter: (value: SorterFilter | null) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const questions = Object.entries(policy.questions).filter(([id]) => visible.has(id))
  if (!questions.length) return <p className="jev-sorter-empty">Select questions in the left rail to show their result cards.</p>
  return <section aria-label="Jev dataset results" className="jev-sorter-cards">
    {questions.map(([id, question]) => {
      const summary = summarizeQuestion(question, id, rows, threshold)
      const shown = expanded.has(id) ? summary.buckets : summary.buckets.slice(0, 5)
      return <article key={id} className="jev-sorter-card">
        <header><h3>{humanize(id)}</h3>{summary.average !== null && <span>Average {summary.average.toFixed(1)} of {summary.buckets.length}</span>}</header>
        {shown.map((bucket) => <button type="button" key={bucket.key} title={bucket.label}
          aria-label={`${humanize(id)}: ${bucket.label}, ${bucket.count} items`}
          aria-pressed={filter?.question === id && filter.bucket === bucket.key}
          disabled={bucket.count === 0}
          onClick={() => onFilter(filter?.question === id && filter.bucket === bucket.key ? null : { question: id, bucket: bucket.key })}
          className="jev-sorter-bucket">
          <span className="jev-sorter-label">{bucket.label}</span>
          <span aria-hidden="true" className="jev-sorter-track"><span style={{ width: `${summary.total ? bucket.count / summary.total * 100 : 0}%` }} /></span>
          <span className="jev-sorter-count">{bucket.count}</span>
        </button>)}
        {summary.buckets.length > 5 && <button type="button" className="jev-sorter-link" onClick={() => setExpanded((current) => {
          const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next
        })}>{expanded.has(id) ? 'Show fewer' : `Show ${summary.buckets.length - 5} more`}</button>}
        {summary.total === 0 && <p className="jev-sorter-muted">No results for the current questions yet.</p>}
      </article>
    })}
  </section>
}
