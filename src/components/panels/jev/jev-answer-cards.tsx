import type { JevRunResult } from './jev-ui-types'

function ProbabilityBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="text-foreground">{label}</span><span className="font-mono text-muted-foreground">{percent}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${label} probability`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-void-cyan" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function Answer({ id, answer }: { id: string; answer: unknown }) {
  if (!answer || typeof answer !== 'object') return null
  const value = answer as Record<string, unknown>
  if (value.type === 'noul' && typeof value.noul === 'number') {
    return <div className="space-y-2"><p className="text-sm font-medium text-foreground">{id}: {value.noul >= 0.5 ? 'Yes is more likely' : 'No is more likely'}</p><ProbabilityBar label="Yes" value={value.noul} /><ProbabilityBar label="No" value={1 - value.noul} /></div>
  }
  if (value.type === 'choice' && value.probabilities && typeof value.probabilities === 'object') {
    const probabilities = Object.entries(value.probabilities as Record<string, number>).sort((a, b) => b[1] - a[1])
    return <div className="space-y-2"><p className="text-sm font-medium text-foreground">{id}: {String(value.choice)}</p>{probabilities.map(([label, probability]) => <ProbabilityBar key={label} label={label} value={probability} />)}</div>
  }
  if (value.type === 'score' && value.probabilities && typeof value.probabilities === 'object') {
    const legend = (value.legend ?? {}) as Record<string, string>
    const probabilities = Object.entries(value.probabilities as Record<string, number>).sort((a, b) => Number(a[0]) - Number(b[0]))
    return <div className="space-y-2"><p className="text-sm font-medium text-foreground">{id}: {Number(value.score).toFixed(2)}</p>{probabilities.map(([level, probability]) => <ProbabilityBar key={level} label={`${level} — ${legend[level] ?? 'Level'}`} value={probability} />)}</div>
  }
  return <pre className="overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(value, null, 2)}</pre>
}

export function JevAnswerCards({ result }: { result: JevRunResult }) {
  return (
    <section aria-label="Jev evaluation result" className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Evaluation complete</h3>
        <span className="font-mono text-xs text-muted-foreground">{result.model} · {result.latencyMs} ms</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{Object.entries(result.answers).map(([id, answer]) => <div key={id} className="rounded-md border border-border bg-card p-3"><Answer id={id} answer={answer} /></div>)}</div>
      <div className="space-y-1 text-xs text-muted-foreground"><p>Probabilities express model uncertainty. Review the supplied evidence before acting.</p><p>Usage: {result.usage.input_tokens} input + {result.usage.output_tokens} output tokens{result.requestId ? ` · Request ${result.requestId}` : ''}</p></div>
    </section>
  )
}
