'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Integration } from './integrations-panel-types'
import { EyeIcon, EyeOffIcon, EditIcon, XIcon, DownloadIcon, TestIcon } from './integration-icons'

interface IntegrationCardProps {
  integration: Integration
  edits: Record<string, string>
  revealed: Set<string>
  opAvailable: boolean
  testing: boolean
  pulling: boolean
  onEdit: (key: string, value: string) => void
  onCancelEdit: (key: string) => void
  onToggleReveal: (key: string) => void
  onTest: () => void
  onPull: () => void
  onRemove: () => void
}

const STATUS_COLORS: Record<Integration['status'], string> = {
  connected: 'bg-green-500',
  partial: 'bg-amber-500',
  not_configured: 'bg-muted-foreground/30',
}

const STATUS_LABELS: Record<Integration['status'], string> = {
  connected: 'Connected',
  partial: 'Partial',
  not_configured: 'Not configured',
}

export function IntegrationCard({
  integration,
  edits,
  revealed,
  opAvailable,
  testing,
  pulling,
  onEdit,
  onCancelEdit,
  onToggleReveal,
  onTest,
  onPull,
  onRemove,
}: IntegrationCardProps) {
  const t = useTranslations('integrations')
  const hasEdits = Object.keys(integration.envVars).some(k => edits[k] !== undefined)
  const hasSetVars = Object.values(integration.envVars).some(v => v.set)

  return (
    <div className={`bg-card border rounded-lg p-4 transition-colors ${
      hasEdits ? 'border-primary/50' : 'border-border'
    }`}>
      <IntegrationCardHeader
        integration={integration}
        opAvailable={opAvailable}
        testing={testing}
        pulling={pulling}
        hasSetVars={hasSetVars}
        onTest={onTest}
        onPull={onPull}
        onRemove={onRemove}
        removeLabel={t('remove')}
      />

      <EnvVarList
        envVars={integration.envVars}
        edits={edits}
        revealed={revealed}
        onEdit={onEdit}
        onCancelEdit={onCancelEdit}
        onToggleReveal={onToggleReveal}
        notSetLabel={t('notSet')}
      />

      {integration.recommendation && (
        <RecommendationBox
          integrationId={integration.id}
          recommendation={integration.recommendation}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface IntegrationCardHeaderProps {
  integration: Integration
  opAvailable: boolean
  testing: boolean
  pulling: boolean
  hasSetVars: boolean
  onTest: () => void
  onPull: () => void
  onRemove: () => void
  removeLabel: string
}

function IntegrationCardHeader({
  integration,
  opAvailable,
  testing,
  pulling,
  hasSetVars,
  onTest,
  onPull,
  onRemove,
  removeLabel,
}: IntegrationCardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[integration.status]}`} />
        <span className="text-sm font-medium text-foreground">{integration.name}</span>
        <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {STATUS_LABELS[integration.status]}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {integration.vaultItem && opAvailable && (
          <Button
            onClick={onPull}
            disabled={pulling}
            title="Pull from 1Password"
            variant="outline"
            size="xs"
            className="text-2xs flex items-center gap-1"
          >
            {pulling
              ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : <DownloadIcon />
            }
            1P
          </Button>
        )}

        {integration.testable && hasSetVars && (
          <Button
            onClick={onTest}
            disabled={testing}
            title="Test connection"
            variant="outline"
            size="xs"
            className="text-2xs flex items-center gap-1"
          >
            {testing
              ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : <TestIcon />
            }
            Test
          </Button>
        )}

        {hasSetVars && (
          <Button
            onClick={onRemove}
            title="Remove from .env"
            variant="outline"
            size="xs"
            className="text-2xs hover:text-destructive hover:border-destructive/50"
          >
            {removeLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface EnvVarListProps {
  envVars: Integration['envVars']
  edits: Record<string, string>
  revealed: Set<string>
  onEdit: (key: string, value: string) => void
  onCancelEdit: (key: string) => void
  onToggleReveal: (key: string) => void
  notSetLabel: string
}

function EnvVarList({
  envVars,
  edits,
  revealed,
  onEdit,
  onCancelEdit,
  onToggleReveal,
  notSetLabel,
}: EnvVarListProps) {
  return (
    <div className="space-y-2">
      {Object.entries(envVars).map(([envKey, info]) => {
        const isEditing = edits[envKey] !== undefined
        const isRevealed = revealed.has(envKey)

        return (
          <div key={envKey} className="flex items-center gap-2">
            <span className="text-2xs font-mono text-muted-foreground/70 w-48 truncate shrink-0" title={envKey}>
              {envKey}
            </span>

            <div className="flex-1 flex items-center gap-1.5">
              {isEditing ? (
                <input
                  type={isRevealed ? 'text' : 'password'}
                  value={edits[envKey]}
                  onChange={e => onEdit(envKey, e.target.value)}
                  placeholder="Enter value..."
                  className="flex-1 px-2 py-1 text-xs bg-background border border-primary/50 rounded focus:border-primary focus:outline-none font-mono"
                  autoComplete="off"
                  data-1p-ignore
                />
              ) : info.set ? (
                <span className="text-xs font-mono text-muted-foreground">{info.redacted}</span>
              ) : (
                <span className="text-xs text-muted-foreground/50 italic">{notSetLabel}</span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {isEditing && (
                <Button
                  onClick={() => onToggleReveal(envKey)}
                  title={isRevealed ? 'Hide value' : 'Show value'}
                  variant="ghost"
                  size="icon-xs"
                  className="w-6 h-6"
                >
                  {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              )}

              {!isEditing && (
                <Button
                  onClick={() => onEdit(envKey, '')}
                  title="Edit value"
                  variant="ghost"
                  size="icon-xs"
                  className="w-6 h-6"
                >
                  <EditIcon />
                </Button>
              )}

              {isEditing && (
                <Button
                  onClick={() => onCancelEdit(envKey)}
                  title="Cancel edit"
                  variant="ghost"
                  size="icon-xs"
                  className="w-6 h-6 hover:text-destructive"
                >
                  <XIcon />
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface RecommendationBoxProps {
  integrationId: string
  recommendation: string
}

function RecommendationBox({ integrationId, recommendation }: RecommendationBoxProps) {
  return (
    <div className="mt-3 rounded-md border border-border/60 bg-secondary/30 px-2.5 py-2">
      <p className="text-2xs text-muted-foreground">{recommendation}</p>
      {integrationId === 'x_twitter' && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs">
          <a
            href="https://github.com/0xNyk/xint"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            github.com/0xNyk/xint
          </a>
          <a
            href="https://github.com/0xNyk/xint-rs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            github.com/0xNyk/xint-rs
          </a>
        </div>
      )}
    </div>
  )
}
