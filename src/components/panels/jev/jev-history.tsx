import type { JevEvaluation } from './jev-ui-types'

function formatTime(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toLocaleString() : '—'
}

export function JevHistory({ evaluations }: { evaluations: JevEvaluation[] }) {
  if (evaluations.length === 0) return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No evaluations have run for this repository.</div>
  return (
    <>
    <div className="grid gap-3 md:hidden">{evaluations.map((evaluation) => (
      <article key={evaluation.id} className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
        <div className="flex items-center justify-between gap-2"><strong className="text-foreground">{evaluation.policy_name ?? 'Ad hoc'}</strong><span className={evaluation.status === 'succeeded' ? 'text-emerald-400' : evaluation.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>{evaluation.status}</span></div>
        <p className="text-muted-foreground">{formatTime(evaluation.created_at)} · {evaluation.model_resolved ?? evaluation.model_requested}</p>
        <p className="text-muted-foreground">{evaluation.latency_ms === null ? 'No latency' : `${evaluation.latency_ms} ms`} · {evaluation.usage_input_tokens === null ? 'No usage' : `${evaluation.usage_input_tokens + (evaluation.usage_output_tokens ?? 0)} tokens`}</p>
        <details><summary className="cursor-pointer text-void-cyan">Inspect result</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{evaluation.error_code ?? JSON.stringify({ answers: evaluation.answers, retainedPreview: evaluation.state_preview }, null, 2)}</pre></details>
      </article>
    ))}</div>
    <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
      <table className="w-full min-w-[720px] text-left text-xs">
        <caption className="sr-only">Recent Jev evaluations</caption>
        <thead className="border-b border-border bg-secondary/40 text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Policy</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Model</th><th className="px-3 py-2 font-medium">Latency</th><th className="px-3 py-2 font-medium">Tokens</th><th className="px-3 py-2 font-medium">Details</th></tr></thead>
        <tbody>{evaluations.map((evaluation) => (
          <tr key={evaluation.id} className="border-b border-border/60 last:border-0">
            <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatTime(evaluation.created_at)}</td>
            <td className="px-3 py-3 text-foreground">{evaluation.policy_name ?? 'Ad hoc'}</td>
            <td className={`px-3 py-3 font-medium ${evaluation.status === 'succeeded' ? 'text-emerald-400' : evaluation.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>{evaluation.status}</td>
            <td className="px-3 py-3 font-mono text-foreground">{evaluation.model_resolved ?? evaluation.model_requested}</td>
            <td className="px-3 py-3 text-muted-foreground">{evaluation.latency_ms === null ? '—' : `${evaluation.latency_ms} ms`}</td>
            <td className="px-3 py-3 text-muted-foreground">{evaluation.usage_input_tokens === null ? '—' : (evaluation.usage_input_tokens + (evaluation.usage_output_tokens ?? 0)).toLocaleString()}</td>
            <td className="px-3 py-3"><details><summary className="cursor-pointer text-void-cyan">Inspect</summary><pre className="mt-2 max-w-sm overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{evaluation.error_code ?? JSON.stringify({ answers: evaluation.answers, retainedPreview: evaluation.state_preview }, null, 2)}</pre></details></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    </>
  )
}
