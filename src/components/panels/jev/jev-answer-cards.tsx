import type { JevRunResult } from './jev-ui-types'
import type { JevPolicyConfiguration } from '@/lib/jev-policy-configuration'

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

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Answer({ id, answer }: { id: string; answer: unknown }) {
  if (!answer || typeof answer !== 'object') return null
  const value = answer as Record<string, unknown>
  if (value.type === 'noul' && typeof value.noul === 'number') {
    const label = value.noul === 0.5 ? 'Uncertain — evenly split' : value.noul > 0.5 ? 'Yes is more likely' : 'No is more likely'
    return <div className="space-y-3"><p className="text-sm font-medium text-foreground">{humanize(id)}</p><p className="text-xs text-muted-foreground">{label}</p><ProbabilityBar label="Yes" value={value.noul} /><ProbabilityBar label="No" value={1 - value.noul} /></div>
  }
  if (value.type === 'choice' && value.probabilities && typeof value.probabilities === 'object') {
    const probabilities = Object.entries(value.probabilities as Record<string, number>).sort((a, b) => b[1] - a[1])
    return <div className="space-y-3"><p className="text-sm font-medium text-foreground">{humanize(id)}</p><p className="text-xs text-muted-foreground">Selected: {humanize(String(value.choice))}{typeof value.confidence === 'number' ? ` · ${Math.round(value.confidence * 100)}% confidence` : ''}</p>{probabilities.map(([label, probability]) => <ProbabilityBar key={label} label={humanize(label)} value={probability} />)}</div>
  }
  if (value.type === 'score' && value.probabilities && typeof value.probabilities === 'object') {
    const legend = (value.legend ?? {}) as Record<string, string>
    const probabilities = Object.entries(value.probabilities as Record<string, number>).sort((a, b) => Number(a[0]) - Number(b[0]))
    // Jev's score indices start at zero; the editor labels the same levels 1…N.
    // Convert presentation only. Keep the original response unchanged for audit/export.
    const oneBased = probabilities.length > 0 && probabilities.every(([level], index) => Number(level) === index)
    const score = Number(value.score) + (oneBased ? 1 : 0)
    return <div className="space-y-3"><p className="text-sm font-medium text-foreground">{humanize(id)}</p><p className="text-xs text-muted-foreground">Score: {score.toFixed(2)}{oneBased ? ` of ${probabilities.length}` : ''}{typeof value.confidence === 'number' ? ` · ${Math.round(value.confidence * 100)}% confidence` : ''}</p>{probabilities.map(([level, probability]) => <ProbabilityBar key={level} label={`${Number(level) + (oneBased ? 1 : 0)} — ${legend[level] ?? 'Level'}`} value={probability} />)}</div>
  }
  return <pre className="overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(value, null, 2)}</pre>
}

function nextAction(result: JevRunResult, configuration?: JevPolicyConfiguration | null): string {
  const threshold = configuration?.uncertaintyThreshold ?? 0.65
  const uncertain = Object.values(result.answers).some((raw) => {
    const answer = raw as Record<string, unknown>
    if (answer.type === 'noul' && typeof answer.noul === 'number') return Math.max(answer.noul, 1 - answer.noul) < threshold
    return typeof answer.confidence === 'number' && answer.confidence < threshold
  })
  if (uncertain) return 'Next step: review missing or conflicting evidence before acting.'
  if (configuration?.enforcement === 'blocking') return 'Next step: confirm the calibrated threshold with a human before blocking work.'
  if (configuration?.enforcement === 'review') return 'Next step: send this result to the configured human review.'
  return 'Next step: use this as advisory evidence and record the operator decision.'
}

export function JevAnswerCards({
  result, configuration, visibleQuestionIds,
}: {
  result: JevRunResult
  configuration?: JevPolicyConfiguration | null
  visibleQuestionIds?: Set<string>
}) {
  const answers = Object.entries(result.answers).filter(([id]) => !visibleQuestionIds || visibleQuestionIds.has(id))
  return (
    <section aria-label="Jev evaluation result" aria-live="polite" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-foreground">Evaluation complete</h3><p className="text-xs text-muted-foreground">Probabilities express model uncertainty, not a guarantee.</p></div>
        <span className="font-mono text-xs text-muted-foreground">{result.model} · {result.latencyMs} ms</span>
      </div>
      {answers.length > 0 ? (
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {answers.map(([id, answer]) => <article key={id} className="min-w-0 bg-card p-4"><Answer id={id} answer={answer} /></article>)}
        </div>
      ) : <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No result cards are selected in the question rail.</div>}
      <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">{nextAction(result, configuration)}</p><p>Usage: {result.usage.input_tokens} input + {result.usage.output_tokens} output tokens{result.requestId ? ` · Request ${result.requestId}` : ''}</p></div>
    </section>
  )
}
