'use client'

export type JevFlowStep = 'describe' | 'clarify' | 'review' | 'evaluate' | 'results'

const STEPS: Array<{ id: JevFlowStep; label: string }> = [
  { id: 'describe', label: 'Describe' },
  { id: 'clarify', label: 'Questions' },
  { id: 'review', label: 'Review' },
  { id: 'evaluate', label: 'Evaluate' },
  { id: 'results', label: 'Results' },
]

/**
 * Session-wide progress indicator for a Jev setup. Every stage renders the same
 * five steps so the position never has to be inferred, and each owner supplies
 * the Back behaviour that is correct for its own stage.
 *
 * Colours are derived from `currentColor` rather than theme tokens: the setup
 * assistant renders on the dark chat surface while the sorter forces its own
 * light palette, so any fixed token inverts in one of the two.
 */
export function JevFlowSteps({
  current,
  onBack,
  backLabel = 'Back',
  backDisabled = false,
}: {
  current: JevFlowStep
  onBack?: () => void
  backLabel?: string
  backDisabled?: boolean
}) {
  const index = STEPS.findIndex((step) => step.id === current)
  const position = index < 0 ? 0 : index

  return (
    <nav
      aria-label="Jev session steps"
      className="jev-flow-steps mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-current/15 pb-3 text-current"
    >
      {onBack ? (
        <button
          type="button"
          disabled={backDisabled}
          onClick={onBack}
          className="rounded-md border border-current/30 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          ← {backLabel}
        </button>
      ) : (
        <span className="text-xs opacity-70">{`Step ${position + 1} of ${STEPS.length}`}</span>
      )}
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {STEPS.map((step, order) => {
          const done = order < position
          const active = order === position
          return (
            <li key={step.id} className="flex items-center gap-2">
              {order > 0 && <span aria-hidden="true" className="opacity-40">›</span>}
              <span
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap text-xs ${
                  active ? 'font-semibold' : done ? 'opacity-85' : 'opacity-60'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                    active ? 'border-2 border-current font-semibold' : 'border border-current/40'
                  }`}
                >
                  {done ? '✓' : order + 1}
                </span>
                {step.label}
                <span className="sr-only">
                  {active ? ' — current step' : done ? ' — completed' : ' — not started'}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
