'use client'

import type { ClaudeFleetPlanStatus } from '@/lib/claude-fleet-plans'
import { claudeFleetPlanTotalUsd, formatClaudeFleetLabels } from '@/lib/claude-fleet-plans'
import { LlmLabel } from '@/components/brand/engine-logo'

export function CostFleetPlans({ plans }: { plans: ClaudeFleetPlanStatus[] }) {
  const total = plans.length ? plans.reduce((sum, plan) => sum + plan.priceUsd, 0) : claudeFleetPlanTotalUsd()

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground"><LlmLabel text={formatClaudeFleetLabels()} size={20} /></h2>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span>Two isolated seats:</span>
            <LlmLabel text="claude-1" size={13}>claude-1 (personal Max 20x)</LlmLabel>
            <span>and</span>
            <LlmLabel text="claude-2" size={13}>claude-2 (Stillpoint).</LlmLabel>
          </p>
        </div>
        <div className="text-2xl font-bold text-foreground">${total}/mo</div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {plans.map((plan) => (
          <article key={plan.identity} className="rounded-md border border-border/80 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <LlmLabel text={plan.label} size={16} className="font-medium text-foreground" />
              <span className="text-sm text-muted-foreground">${plan.priceUsd}/mo</span>
            </div>
            <LlmLabel text={plan.identity} size={12} className="text-xs text-muted-foreground">
              {plan.identity} · {plan.account}
            </LlmLabel>
            <p className="text-xs">
              {plan.authStatus === 'isolated'
                ? `Isolated home ready: ${plan.isolatedHome}`
                : `Needs one-time CLAUDE_CONFIG_DIR=${plan.isolatedHome} claude auth login. Heal will not create this directory or copy oauthAccount.`}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}
