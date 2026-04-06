'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { RuleCard } from './alert-rules/rule-card'
import { CreateRuleForm } from './alert-rules/create-rule-form'
import { AlertRulesStats } from './alert-rules/alert-rules-stats'
import { EvalResultsPanel } from './alert-rules/eval-results-panel'
import { type AlertRule, type EvalResult } from './alert-rules/types'

export function AlertRulesPanel(): React.JSX.Element {
  const t = useTranslations('alertRules')
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [evalResults, setEvalResults] = useState<EvalResult[] | null>(null)
  const [evaluating, setEvaluating] = useState(false)

  const fetchRules = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/alerts', { signal: AbortSignal.timeout(8000) })
      const data = await res.json() as { rules?: AlertRule[] }
      setRules(data.rules ?? [])
    } catch {
      setError('Failed to load alert rules. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchRules() }, [fetchRules])

  const toggleRule = async (rule: AlertRule): Promise<void> => {
    try {
      await fetch('/api/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id, enabled: rule.enabled ? 0 : 1 }),
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      setError('Failed to update rule. Please try again.')
    }
    void fetchRules()
  }

  const deleteRule = async (id: number): Promise<void> => {
    try {
      await fetch('/api/alerts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      setError('Failed to delete rule. Please try again.')
    }
    void fetchRules()
  }

  const evaluateAll = async (): Promise<void> => {
    setEvaluating(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'evaluate' }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json() as { results?: EvalResult[] }
      setEvalResults(data.results ?? [])
    } catch {
      setError('Failed to evaluate alert rules. Please try again.')
    } finally {
      setEvaluating(false)
      void fetchRules()
    }
  }

  const enabledCount = rules.filter(r => r.enabled).length
  const totalTriggers = rules.reduce((sum, r) => sum + r.trigger_count, 0)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => void fetchRules()}
            className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={evaluateAll}
            disabled={evaluating || rules.length === 0}
            variant="secondary"
            size="sm"
            className="flex items-center gap-1.5"
          >
            {evaluating ? (
              <>
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                {t('evaluating')}
              </>
            ) : (
              <>
                <PlayIcon />
                {t('evaluateNow')}
              </>
            )}
          </Button>
          <Button onClick={() => setShowCreate(!showCreate)} size="sm">
            {t('newRule')}
          </Button>
        </div>
      </div>

      <AlertRulesStats
        totalRules={rules.length}
        enabledCount={enabledCount}
        totalTriggers={totalTriggers}
      />

      {evalResults && (
        <EvalResultsPanel results={evalResults} onDismiss={() => setEvalResults(null)} />
      )}

      {showCreate && (
        <CreateRuleForm
          onCreated={() => { void fetchRules(); setShowCreate(false) }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <AlertRulesBody
        loading={loading}
        rules={rules}
        loadingLabel={t('loadingRules')}
        noRulesMessage={t('noRulesConfigured')}
        noRulesHint={t('createRuleHint')}
        onRetry={() => void fetchRules()}
        onToggle={toggleRule}
        onDelete={deleteRule}
      />
    </div>
  )
}

interface AlertRulesBodyProps {
  loading: boolean
  rules: AlertRule[]
  loadingLabel: string
  noRulesMessage: string
  noRulesHint: string
  onRetry: () => void
  onToggle: (rule: AlertRule) => void
  onDelete: (id: number) => void
}

function AlertRulesBody({
  loading, rules, loadingLabel, noRulesMessage, noRulesHint, onRetry, onToggle, onDelete,
}: AlertRulesBodyProps): React.JSX.Element {
  if (loading) {
    return <Loader variant="panel" label={loadingLabel} />
  }

  if (rules.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg">
        <div className="text-3xl mb-2 opacity-30">&#9888;</div>
        <p className="text-sm text-muted-foreground">{noRulesMessage}</p>
        <p className="text-xs text-muted-foreground mt-1">{noRulesHint}</p>
        <Button onClick={onRetry} className="mt-4" variant="secondary" size="sm">
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rules.map(rule => (
        <RuleCard
          key={rule.id}
          rule={rule}
          onToggle={() => onToggle(rule)}
          onDelete={() => onDelete(rule.id)}
        />
      ))}
    </div>
  )
}

function PlayIcon(): React.JSX.Element {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2l10 6-10 6V2z" />
    </svg>
  )
}
