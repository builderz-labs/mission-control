'use client'

import { useTranslations } from 'next-intl'

interface ConfigIdentitySectionProps {
  editing: boolean
  identityEmoji: string
  identityName: string
  identityTheme: string
  identityPreview: string
  identityName_raw: string
  identityTheme_raw: string
  identityContent_raw: string
  onFieldChange: (field: string, value: string) => void
}

export function ConfigIdentitySection({
  editing,
  identityEmoji,
  identityName,
  identityTheme,
  identityPreview,
  identityName_raw,
  identityTheme_raw,
  identityContent_raw,
  onFieldChange,
}: ConfigIdentitySectionProps) {
  const t = useTranslations('agentDetail')

  return (
    <div className="bg-surface-1/50 rounded-lg p-4">
      <h5 className="text-sm font-medium text-foreground mb-2">{t('identity')}</h5>
      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t('emoji')}</label>
              <input
                value={identityEmoji}
                onChange={(e) => onFieldChange('emoji', e.target.value)}
                className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="🤖"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t('name')}</label>
              <input
                value={identityName_raw}
                onChange={(e) => onFieldChange('name', e.target.value)}
                className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="Agent name"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t('themeRole')}</label>
              <input
                value={identityTheme_raw}
                onChange={(e) => onFieldChange('theme', e.target.value)}
                className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="e.g. backend engineer"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('identityContent')}</label>
            <textarea
              value={identityContent_raw}
              onChange={(e) => onFieldChange('content', e.target.value)}
              rows={4}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="Describe the agent's identity and personality..."
            />
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-2xl">{identityEmoji}</span>
            <div>
              <div className="text-foreground font-medium">{identityName}</div>
              <div className="text-muted-foreground">{identityTheme}</div>
            </div>
          </div>
          {identityPreview && (
            <pre className="mt-3 text-xs text-muted-foreground bg-surface-1 rounded p-2 overflow-auto whitespace-pre-wrap">
              {identityPreview}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
