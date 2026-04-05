'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { DownloadIcon } from './integration-icons'
import type { Category, Integration } from './integrations-panel-types'

interface IntegrationsPanelHeaderProps {
  integrations: Integration[]
  categories: Category[]
  activeCategory: string
  opAvailable: boolean
  envPath: string | null
  pullingAll: boolean
  hasChanges: boolean
  saving: boolean
  feedback: { ok: boolean; text: string } | null
  onSetActiveCategory: (id: string) => void
  onPullAll: () => void
  onSave: () => void
  onDiscard: () => void
}

export function IntegrationsPanelHeader({
  integrations,
  categories,
  activeCategory,
  opAvailable,
  envPath,
  pullingAll,
  hasChanges,
  saving,
  feedback,
  onSetActiveCategory,
  onPullAll,
  onSave,
  onDiscard,
}: IntegrationsPanelHeaderProps) {
  const t = useTranslations('integrations')
  const connectedCount = integrations.filter(i => i.status === 'connected').length

  return (
    <>
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('connectedCount', { connected: connectedCount, total: integrations.length })}
            {envPath && (
              <span className="ml-2 font-mono text-muted-foreground/50">{envPath}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {opAvailable && (
            <>
              <span className="text-2xs px-2 py-1 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                1P CLI
              </span>
              <Button
                onClick={onPullAll}
                disabled={pullingAll}
                variant="outline"
                size="sm"
                className="flex items-center gap-1.5"
                title="Pull all vault-backed integrations in this category from 1Password"
              >
                {pullingAll
                  ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <DownloadIcon />
                }
                {t('pullAll')}
              </Button>
            </>
          )}

          {hasChanges && (
            <Button onClick={onDiscard} variant="outline" size="sm">
              {t('discard')}
            </Button>
          )}

          <Button
            onClick={onSave}
            disabled={!hasChanges || saving}
            variant={hasChanges ? 'default' : 'secondary'}
            size="sm"
            className={!hasChanges ? 'cursor-not-allowed' : ''}
          >
            {saving ? t('saving') : t('saveChanges')}
          </Button>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${
          feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-border pb-px overflow-x-auto">
        {categories.map(cat => {
          const catConnected = integrations.filter(
            i => i.category === cat.id && i.status === 'connected'
          ).length

          return (
            <Button
              key={cat.id}
              onClick={() => onSetActiveCategory(cat.id)}
              variant="ghost"
              size="sm"
              className={`rounded-t-md rounded-b-none relative whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-card text-foreground border border-border border-b-card -mb-px'
                  : ''
              }`}
            >
              {cat.label}
              {catConnected > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 text-2xs rounded-full bg-green-500/15 text-green-400 px-1">
                  {catConnected}
                </span>
              )}
            </Button>
          )
        })}
      </div>
    </>
  )
}
