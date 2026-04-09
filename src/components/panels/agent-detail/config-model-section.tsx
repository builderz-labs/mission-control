'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface ConfigModelSectionProps {
  editing: boolean
  modelPrimary: string
  modelFallbacks: string[]
  newFallbackModel: string
  availableModels: string[]
  onPrimaryChange: (value: string) => void
  onFallbackChange: (index: number, value: string) => void
  onFallbackRemove: (index: number) => void
  onNewFallbackChange: (value: string) => void
  onAddFallback: () => void
}

export function ConfigModelSection({
  editing,
  modelPrimary,
  modelFallbacks,
  newFallbackModel,
  availableModels,
  onPrimaryChange,
  onFallbackChange,
  onFallbackRemove,
  onNewFallbackChange,
  onAddFallback,
}: ConfigModelSectionProps): React.ReactElement {
  const t = useTranslations('agentDetail')

  return (
    <div className="bg-surface-1/50 rounded-lg p-4">
      <h5 className="text-sm font-medium text-foreground mb-2">{t('model')}</h5>
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('primaryModel')}</label>
            <input
              value={modelPrimary}
              onChange={(e) => onPrimaryChange(e.target.value)}
              list="agent-model-suggestions"
              placeholder="anthropic/claude-sonnet-4-20250514"
              className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <datalist id="agent-model-suggestions">
              {availableModels.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('fallbackModels')}</label>
            <div className="space-y-2">
              {modelFallbacks.map((fallback: string, index: number) => (
                <div key={`${fallback}-${index}`} className="flex gap-2">
                  <input
                    value={fallback}
                    onChange={(e) => onFallbackChange(index, e.target.value)}
                    list="agent-model-suggestions"
                    className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <Button onClick={() => onFallbackRemove(index)} variant="destructive" size="xs">
                    Remove
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newFallbackModel}
                  onChange={(e) => onNewFallbackChange(e.target.value)}
                  list="agent-model-suggestions"
                  placeholder={t('addFallbackModel')}
                  className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <Button onClick={onAddFallback} variant="secondary" size="xs">Add</Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm">
          <div>
            <span className="text-muted-foreground">{t('primary')}:</span>{' '}
            <span className="text-foreground font-mono">{modelPrimary || t('notConfigured')}</span>
          </div>
          {modelFallbacks.length > 0 && (
            <div className="mt-1">
              <span className="text-muted-foreground">{t('fallbacks')}:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {modelFallbacks.map((fb: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 text-xs bg-surface-2 rounded text-muted-foreground font-mono">
                    {fb.split('/').pop()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
