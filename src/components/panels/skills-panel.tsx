'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { useSkillsPanel } from './skills/useSkillsPanel'
import { InstalledTab } from './skills/InstalledTab'
import { RegistryTab } from './skills/RegistryTab'
import { SkillDrawer } from './skills/SkillDrawer'
import { InstallModal } from './skills/InstallModal'
import type { SkillSummary } from './skills/types'

const REGISTRY_NAMES: Record<string, string> = {
  clawhub: 'ClawdHub',
  'skills-sh': 'skills.sh',
  'awesome-openclaw': 'Awesome OpenClaw',
}

function securityBadge(status?: string | null): React.ReactNode {
  if (!status || status === 'unchecked') return <span className="text-2xs text-muted-foreground/50">unchecked</span>
  if (status === 'clean') return <span className="text-2xs text-emerald-400">clean</span>
  if (status === 'warning') return <span className="text-2xs text-amber-400">warning</span>
  if (status === 'rejected') return <span className="text-2xs text-rose-400">rejected</span>
  return null
}

export function SkillsPanel(): React.JSX.Element {
  const t = useTranslations('skills')
  const { dashboardMode, skillGroups, skillsTotal } = useMissionControl()
  const panel = useSkillsPanel()

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('subtitle')} {dashboardMode === 'local' ? t('localMode') : t('gatewayMode')}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => panel.setActiveTab('installed')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${panel.activeTab === 'installed' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            {t('tabInstalled')}
          </button>
          <button
            onClick={() => panel.setActiveTab('registry')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${panel.activeTab === 'registry' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            {t('tabRegistry')}
          </button>
        </div>
      </div>

      {panel.installMessage && (
        <div className={`rounded-lg border px-4 py-2 text-xs ${
          panel.installMessage.startsWith('Failed') || panel.installMessage.startsWith('Install error')
            ? 'bg-destructive/10 border-destructive/30 text-destructive'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        }`}>
          {panel.installMessage}
        </div>
      )}

      {panel.activeTab === 'installed' && (
        <InstalledTab
          t={t}
          loading={panel.loading}
          error={panel.error}
          saving={panel.saving}
          query={panel.query}
          setQuery={panel.setQuery}
          activeRoot={panel.activeRoot}
          setActiveRoot={panel.setActiveRoot}
          filtered={panel.filtered as SkillSummary[]}
          skillGroups={skillGroups}
          skillsTotal={skillsTotal}
          dashboardMode={dashboardMode}
          createSource={panel.createSource}
          setCreateSource={panel.setCreateSource}
          createName={panel.createName}
          setCreateName={panel.setCreateName}
          createContent={panel.createContent}
          setCreateContent={panel.setCreateContent}
          createError={panel.createError}
          scanAll={panel.scanAll}
          setScanAll={panel.setScanAll}
          onRefresh={panel.refresh}
          onCreateSkill={panel.createSkill}
          onCheckSecurity={panel.checkSecurity}
          onSelectSkill={panel.setSelectedSkill}
          onScanAll={panel.scanAllSkills}
          securityBadge={securityBadge}
        />
      )}

      {panel.activeTab === 'registry' && (
        <RegistryTab
          t={t}
          dashboardMode={dashboardMode}
          registrySource={panel.registrySource}
          setRegistrySource={panel.setRegistrySource}
          registryQuery={panel.registryQuery}
          setRegistryQuery={panel.setRegistryQuery}
          registryLoading={panel.registryLoading}
          registryError={panel.registryError}
          registryResults={panel.registryResults as import('./skills/types').RegistrySkill[]}
          registrySearched={panel.registrySearched}
          installTarget={panel.installTarget}
          setInstallTarget={panel.setInstallTarget}
          installing={panel.installing}
          registryNames={REGISTRY_NAMES}
          onSearch={panel.searchRegistry}
          onInstall={panel.installSkill}
        />
      )}

      {panel.isMounted && panel.installModal && createPortal(
        <InstallModal
          modal={panel.installModal}
          onClose={() => panel.setInstallModal(null)}
          onViewInstalled={() => { panel.setInstallModal(null); panel.setActiveTab('installed') }}
        />,
        document.body
      )}

      {panel.isMounted && panel.selectedSkill && createPortal(
        <SkillDrawer
          skill={panel.selectedSkill}
          content={panel.selectedContent}
          draftContent={panel.draftContent}
          loading={panel.drawerLoading}
          error={panel.drawerError}
          saving={panel.saving}
          onClose={() => panel.setSelectedSkill(null)}
          onSave={panel.saveSkill}
          onDelete={() => panel.deleteSkill(panel.selectedSkill!)}
          onDraftChange={panel.setDraftContent}
        />,
        document.body
      )}
    </div>
  )
}
