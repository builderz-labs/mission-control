'use client'

import { useTranslations } from 'next-intl'
import { MODEL_TIER_COLORS, MODEL_TIER_LABELS, DEFAULT_MODEL_BY_TIER } from './agent-detail-utils'

type ProgressStep = { label: string; status: 'pending' | 'active' | 'done' | 'error'; error?: string }

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

interface StepReviewProps {
  formData: FormData
  selectedTemplateLabel: string | undefined
  selectedTemplateEmoji: string | undefined
  selectedTemplateToolCount: number | string | undefined
  progressSteps: ProgressStep[] | null
  onWriteToGatewayChange: (checked: boolean) => void
  onProvisionWorkspaceChange: (checked: boolean) => void
}

export function StepReview({
  formData,
  selectedTemplateLabel,
  selectedTemplateEmoji,
  selectedTemplateToolCount,
  progressSteps,
  onWriteToGatewayChange,
  onProvisionWorkspaceChange,
}: StepReviewProps): React.ReactElement {
  const t = useTranslations('agentDetail')

  if (progressSteps) {
    return (
      <div className="space-y-3 py-4">
        <h4 className="text-sm font-medium text-muted-foreground mb-4">{t('settingUpAgent')}</h4>
        {progressSteps.map((ps, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
              {ps.status === 'active' && (
                <span className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}
              {ps.status === 'done' && <span className="text-green-400 text-sm font-bold">✓</span>}
              {ps.status === 'error' && <span className="text-red-400 text-sm font-bold">✕</span>}
              {ps.status === 'pending' && (
                <span className="inline-block w-3 h-3 rounded-full border border-muted-foreground/40" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-sm ${
                ps.status === 'error' ? 'text-red-400' :
                ps.status === 'done' ? 'text-green-400' :
                ps.status === 'active' ? 'text-foreground' :
                'text-muted-foreground'
              }`}>{ps.label}</span>
              {ps.error && <p className="text-xs text-red-400/80 mt-1">{ps.error}</p>}
            </div>
          </div>
        ))}
        {progressSteps.every(s => s.status === 'done') && (
          <p className="text-sm text-green-400 mt-4">{t('agentCreatedSuccess')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-1/50 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{formData.emoji || selectedTemplateEmoji || '?'}</span>
          <div>
            <h4 className="text-lg font-bold text-foreground">{formData.name || 'Unnamed'}</h4>
            <p className="text-muted-foreground text-sm">{formData.role}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">{t('idLabel')}:</span> <span className="text-foreground font-mono">{formData.id}</span></div>
          <div><span className="text-muted-foreground">{t('templateLabel')}:</span> <span className="text-foreground">{selectedTemplateLabel || t('custom')}</span></div>
          <div>
            <span className="text-muted-foreground">{t('model')}:</span>{' '}
            <span className={`px-2 py-0.5 rounded text-xs ${MODEL_TIER_COLORS[formData.modelTier]}`}>
              {MODEL_TIER_LABELS[formData.modelTier]}
            </span>
          </div>
          <div><span className="text-muted-foreground">{t('toolsLabel')}:</span> <span className="text-foreground">{selectedTemplateToolCount || t('custom')}</span></div>
          <div className="col-span-2">
            <span className="text-muted-foreground">{t('primaryModel')}:</span>{' '}
            <span className="text-foreground font-mono">{formData.modelPrimary || DEFAULT_MODEL_BY_TIER[formData.modelTier]}</span>
          </div>
          <div><span className="text-muted-foreground">{t('workspace')}:</span> <span className="text-foreground">{formData.workspaceAccess}</span></div>
          <div><span className="text-muted-foreground">{t('sandbox')}:</span> <span className="text-foreground">{formData.sandboxMode}</span></div>
          <div><span className="text-muted-foreground">{t('network')}:</span> <span className="text-foreground">{formData.dockerNetwork}</span></div>
          {formData.session_key && (
            <div><span className="text-muted-foreground">{t('session')}:</span> <span className="text-foreground font-mono">{formData.session_key}</span></div>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={formData.write_to_gateway}
          onChange={(e) => onWriteToGatewayChange(e.target.checked)}
          className="w-4 h-4 rounded border-border"
        />
        <span className="text-sm text-foreground">{t('addToGateway')}</span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={formData.provision_openclaw_workspace}
          onChange={(e) => onProvisionWorkspaceChange(e.target.checked)}
          className="w-4 h-4 rounded border-border"
        />
        <span className="text-sm text-foreground">{t('provisionWorkspace')}</span>
      </label>
    </div>
  )
}
