'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface SubagentsConfig {
  allowAgents?: string[]
  model?: string
  [key: string]: unknown
}

interface ConfigSubagentsSectionProps {
  editing: boolean
  subagents: SubagentsConfig
  availableModels: string[]
  onAddAgent: (agent: string) => void
  onRemoveAgent: (index: number) => void
  onModelChange: (model: string) => void
}

export function ConfigSubagentsSection({
  editing,
  subagents,
  availableModels,
  onAddAgent,
  onRemoveAgent,
  onModelChange,
}: ConfigSubagentsSectionProps) {
  const t = useTranslations('agentDetail')

  const handleAddFromInput = (input: HTMLInputElement | null) => {
    if (!input) return
    const val = input.value.trim()
    if (!val) return
    onAddAgent(val)
    input.value = ''
  }

  return (
    <div className="bg-surface-1/50 rounded-lg p-4">
      <h5 className="text-sm font-medium text-foreground mb-2">{t('subAgents')}</h5>
      {editing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {(subagents.allowAgents || []).map((a: string, idx: number) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-violet-500/10 text-violet-400 rounded border border-violet-500/20"
              >
                {a}
                <button
                  onClick={() => onRemoveAgent(idx)}
                  className="text-violet-400/60 hover:text-violet-400 ml-0.5"
                  title={`Remove sub-agent ${a}`}
                >
                  x
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('addSubAgentPlaceholder')}
              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim()
                  if (!val) return
                  onAddAgent(val);
                  (e.target as HTMLInputElement).value = ''
                }
              }}
            />
            <Button
              size="xs"
              variant="secondary"
              onClick={(e) => {
                const input = (e.target as HTMLElement).parentElement?.querySelector('input') as HTMLInputElement | null
                handleAddFromInput(input)
              }}
            >
              {t('add')}
            </Button>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('subAgentModelOverride')}</label>
            <select
              value={subagents.model || ''}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full mt-1 px-2 py-1 text-xs border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">{t('defaultInheritFromAgent')}</option>
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <>
          {subagents.allowAgents && subagents.allowAgents.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1">
                {subagents.allowAgents.map((a: string) => (
                  <span key={a} className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-400 rounded border border-violet-500/20">
                    {a}
                  </span>
                ))}
              </div>
              {subagents.model && (
                <div className="text-xs text-muted-foreground mt-1">{t('modelLabel')}: {subagents.model}</div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">{t('noSubAgentsConfigured')}</div>
          )}
        </>
      )}
    </div>
  )
}
