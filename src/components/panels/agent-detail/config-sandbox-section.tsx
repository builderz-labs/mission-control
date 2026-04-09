'use client'

import { useTranslations } from 'next-intl'

interface SandboxState {
  mode?: string
  sandboxMode?: string
  sandbox_mode?: string
  workspaceAccess?: string
  workspace_access?: string
  workspace?: string
  docker?: { network?: string }
  network?: string
  dockerNetwork?: string
  docker_network?: string
  [key: string]: unknown
}

interface ConfigSandboxSectionProps {
  editing: boolean
  sandbox: SandboxState
  sandboxMode: string
  sandboxWorkspace: string
  sandboxNetwork: string
  onFieldChange: (field: string, value: string) => void
}

export function ConfigSandboxSection({
  editing,
  sandbox,
  sandboxMode,
  sandboxWorkspace,
  sandboxNetwork,
  onFieldChange,
}: ConfigSandboxSectionProps): React.ReactElement {
  const t = useTranslations('agentDetail')

  return (
    <div className="bg-surface-1/50 rounded-lg p-4">
      <h5 className="text-sm font-medium text-foreground mb-2">{t('sandbox')}</h5>
      {editing ? (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('mode')}</label>
            <select
              value={sandbox.mode || ''}
              onChange={(e) => onFieldChange('mode', e.target.value)}
              className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">{t('notConfigured')}</option>
              <option value="all">{t('all')}</option>
              <option value="non-main">{t('nonMain')}</option>
              <option value="none">{t('none')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('workspaceAccess')}</label>
            <select
              value={sandbox.workspaceAccess || ''}
              onChange={(e) => onFieldChange('workspaceAccess', e.target.value)}
              className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">{t('notConfigured')}</option>
              <option value="rw">{t('readWrite')}</option>
              <option value="ro">{t('readOnly')}</option>
              <option value="none">{t('none')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('network')}</label>
            <input
              value={sandbox.network || ''}
              onChange={(e) => onFieldChange('network', e.target.value)}
              className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder={t('none')}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">{t('mode')}:</span>{' '}
            <span className="text-foreground">{sandboxMode}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('workspace')}:</span>{' '}
            <span className="text-foreground">{sandboxWorkspace}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('network')}:</span>{' '}
            <span className="text-foreground">{sandboxNetwork}</span>
          </div>
        </div>
      )}
    </div>
  )
}
