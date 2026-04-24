'use client'

import { useState, useTransition } from 'react'

interface WorkflowStatus {
  month_year: string
  summary: { total: number; pending: number; approved: number; missing: number }
}

interface Props {
  initialStatus: WorkflowStatus | null
}

export function WorkflowTrigger({ initialStatus }: Props) {
  const [status, setStatus] = useState<WorkflowStatus | null>(initialStatus)
  const [result, setResult] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)

  function runWorkflow() {
    startTransition(() => {
      fetch('/api/jk/workflow', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          setResult(`Gate 1 dibuat: ${data.gates_created} brand. Dilewati: ${data.brands_skipped}. Error: ${data.errors?.length ?? 0}.`)
          // Refresh status
          return fetch('/api/jk/workflow').then(r => r.json())
        })
        .then(data => setStatus(data))
        .catch(() => setResult('Gagal menjalankan workflow'))
    })
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1"
      >
        ⚙ Workflow {status?.month_year ?? ''}
        {status?.summary.missing ? (
          <span className="px-1.5 py-0.5 bg-amber-400/20 text-amber-400 rounded">{status.summary.missing} missing</span>
        ) : null}
      </button>
    )
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium text-neutral-200">Monthly Workflow — {status?.month_year}</div>
        <button onClick={() => setExpanded(false)} className="text-neutral-500 hover:text-neutral-300 text-xs">✕</button>
      </div>

      {status && (
        <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
          {[
            { label: 'Total Brands', value: status.summary.total, color: 'text-neutral-300' },
            { label: 'Pending Gate 1', value: status.summary.pending, color: 'text-amber-400' },
            { label: 'Gate 1 Approved', value: status.summary.approved, color: 'text-green-400' },
            { label: 'Missing Gate 1', value: status.summary.missing, color: status.summary.missing > 0 ? 'text-red-400' : 'text-neutral-500' },
          ].map(s => (
            <div key={s.label} className="bg-neutral-800 rounded p-2">
              <div className="text-neutral-500 mb-0.5">{s.label}</div>
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="text-xs text-green-300 bg-green-900/20 border border-green-800 rounded p-2 mb-3">{result}</div>
      )}

      <button
        onClick={runWorkflow}
        disabled={isPending}
        className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white transition-colors"
      >
        {isPending ? 'Menjalankan...' : '▶ Jalankan Monthly Workflow'}
      </button>
      <div className="text-xs text-neutral-600 mt-1.5">
        Membuat Gate 1 untuk brand yang belum punya item bulan ini. Aman dijalankan berulang (idempotent).
      </div>
    </div>
  )
}
