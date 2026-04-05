'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type AlertRule, OPERATORS, ENTITY_COLORS } from './types'

interface RuleCardProps {
  rule: AlertRule
  onToggle: () => void
  onDelete: () => void
}

export function RuleCard({ rule, onToggle, onDelete }: RuleCardProps): React.JSX.Element {
  const t = useTranslations('alertRules')
  const operator = OPERATORS.find(o => o.value === rule.condition_operator)
  const lastTriggered = rule.last_triggered_at
    ? new Date(rule.last_triggered_at * 1000).toLocaleString()
    : t('never')

  return (
    <div className={`bg-card border rounded-lg p-4 transition-smooth ${
      rule.enabled ? 'border-border' : 'border-border/50 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-2xs px-1.5 py-0.5 rounded border ${ENTITY_COLORS[rule.entity_type] || 'bg-muted text-muted-foreground border-border'}`}>
              {rule.entity_type}
            </span>
            <h3 className="text-sm font-semibold text-foreground truncate">{rule.name}</h3>
          </div>
          {rule.description && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{rule.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-2xs text-muted-foreground flex-wrap">
            <span className="font-mono bg-secondary/50 px-1.5 py-0.5 rounded">
              {rule.condition_field} {operator?.label || rule.condition_operator} {rule.condition_value}
            </span>
            <span>{t('cooldown', { minutes: rule.cooldown_minutes })}</span>
            <span>{t('triggerCount', { count: rule.trigger_count })}</span>
            <span>{t('lastTriggered', { time: lastTriggered })}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ToggleSwitch enabled={!!rule.enabled} onToggle={onToggle} />
          <Button
            onClick={onDelete}
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            title={t('deleteRule')}
          >
            <DeleteIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className={`w-10 h-5 rounded-full transition-smooth relative ${enabled ? 'bg-green-500' : 'bg-muted'}`}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
        style={{ left: enabled ? '22px' : '2px' }}
      />
    </button>
  )
}

function DeleteIcon(): React.JSX.Element {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10M6 4V3h4v1M5 4v8.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" />
    </svg>
  )
}
