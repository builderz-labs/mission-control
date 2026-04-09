'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { MODEL_TIER_COLORS, MODEL_TIER_LABELS, DEFAULT_MODEL_BY_TIER } from './agent-detail-utils'

interface FormData {
  name: string
  id: string
  role: string
  emoji: string
  modelTier: 'opus' | 'sonnet' | 'haiku'
  modelPrimary: string
  workspaceAccess: 'rw' | 'ro' | 'none'
  sandboxMode: 'all' | 'non-main'
  dockerNetwork: 'none' | 'bridge'
  session_key: string
  write_to_gateway: boolean
  provision_openclaw_workspace: boolean
}

interface StepConfigProps {
  formData: FormData
  availableModels: string[]
  onNameChange: (name: string) => void
  onFieldChange: <K extends keyof FormData>(field: K, value: FormData[K]) => void
}

export function StepConfig({ formData, availableModels, onNameChange, onFieldChange }: StepConfigProps): React.ReactElement {
  const t = useTranslations('agentDetail')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">{t('displayName')}</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder={t('displayNamePlaceholder')}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">{t('agentId')}</label>
          <input
            type="text"
            value={formData.id}
            onChange={(e) => onFieldChange('id', e.target.value)}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
            placeholder="frontend-dev"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">{t('roleTheme')}</label>
          <input
            type="text"
            value={formData.role}
            onChange={(e) => onFieldChange('role', e.target.value)}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="builder engineer"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">{t('emoji')}</label>
          <input
            type="text"
            value={formData.emoji}
            onChange={(e) => onFieldChange('emoji', e.target.value)}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="e.g. 🛠️"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm text-muted-foreground mb-1">{t('modelTier')}</label>
        <div className="flex gap-2">
          {(['opus', 'sonnet', 'haiku'] as const).map(tier => (
            <Button
              key={tier}
              onClick={() => {
                onFieldChange('modelTier', tier)
                onFieldChange('modelPrimary', DEFAULT_MODEL_BY_TIER[tier])
              }}
              variant={formData.modelTier === tier ? 'outline' : 'secondary'}
              className={`flex-1 ${formData.modelTier === tier ? MODEL_TIER_COLORS[tier] : ''}`}
            >
              {MODEL_TIER_LABELS[tier]}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm text-muted-foreground mb-1">{t('primaryModel')}</label>
        <input
          type="text"
          value={formData.modelPrimary}
          onChange={(e) => onFieldChange('modelPrimary', e.target.value)}
          list="create-agent-model-suggestions"
          className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
          placeholder={DEFAULT_MODEL_BY_TIER[formData.modelTier]}
        />
        <datalist id="create-agent-model-suggestions">
          {availableModels.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">{t('workspace')}</label>
          <select
            value={formData.workspaceAccess}
            onChange={(e) => onFieldChange('workspaceAccess', e.target.value as 'rw' | 'ro' | 'none')}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="rw">{t('readWrite')}</option>
            <option value="ro">{t('readOnly')}</option>
            <option value="none">{t('none')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">{t('sandbox')}</label>
          <select
            value={formData.sandboxMode}
            onChange={(e) => onFieldChange('sandboxMode', e.target.value as 'all' | 'non-main')}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="all">{t('sandboxAll')}</option>
            <option value="non-main">{t('sandboxNonMain')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">{t('network')}</label>
          <select
            value={formData.dockerNetwork}
            onChange={(e) => onFieldChange('dockerNetwork', e.target.value as 'none' | 'bridge')}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="none">{t('networkIsolated')}</option>
            <option value="bridge">{t('networkBridge')}</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm text-muted-foreground mb-1">{t('sessionKeyOptional')}</label>
        <input
          type="text"
          value={formData.session_key}
          onChange={(e) => onFieldChange('session_key', e.target.value)}
          className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder={t('sessionKeyPlaceholder')}
        />
      </div>
    </div>
  )
}
