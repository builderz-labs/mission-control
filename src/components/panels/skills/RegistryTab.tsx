'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { SOURCE_LABELS } from './constants'
import type { RegistrySkill, RegistrySource } from './types'

export interface RegistryTabProps {
  t: ReturnType<typeof useTranslations>
  dashboardMode: string
  registrySource: RegistrySource
  setRegistrySource: (src: RegistrySource) => void
  registryQuery: string
  setRegistryQuery: (v: string) => void
  registryLoading: boolean
  registryError: string | null
  registryResults: RegistrySkill[]
  registrySearched: boolean
  installTarget: string
  setInstallTarget: (v: string) => void
  installing: string | null
  registryNames: Record<string, string>
  onSearch: () => void
  onInstall: (slug: string, name?: string) => void
}

export function RegistryTab({
  t, dashboardMode, registrySource, setRegistrySource, registryQuery, setRegistryQuery,
  registryLoading, registryError, registryResults, registrySearched,
  installTarget, setInstallTarget, installing, registryNames, onSearch, onInstall,
}: RegistryTabProps): React.ReactElement {
  return (
    <>
      <RegistrySearchBar
        t={t}
        dashboardMode={dashboardMode}
        registrySource={registrySource}
        setRegistrySource={setRegistrySource}
        registryQuery={registryQuery}
        setRegistryQuery={setRegistryQuery}
        registryLoading={registryLoading}
        installTarget={installTarget}
        setInstallTarget={setInstallTarget}
        onSearch={onSearch}
      />

      {registryError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{registryError}</div>
      )}

      <RegistryResults
        t={t}
        registryResults={registryResults}
        registryLoading={registryLoading}
        registrySearched={registrySearched}
        registryQuery={registryQuery}
        registrySource={registrySource}
        registryNames={registryNames}
        installing={installing}
        onInstall={onInstall}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// RegistrySearchBar
// ---------------------------------------------------------------------------

interface RegistrySearchBarProps {
  t: ReturnType<typeof useTranslations>
  dashboardMode: string
  registrySource: RegistrySource
  setRegistrySource: (src: RegistrySource) => void
  registryQuery: string
  setRegistryQuery: (v: string) => void
  registryLoading: boolean
  installTarget: string
  setInstallTarget: (v: string) => void
  onSearch: () => void
}

function RegistrySearchBar({
  t, dashboardMode, registrySource, setRegistrySource, registryQuery, setRegistryQuery,
  registryLoading, installTarget, setInstallTarget, onSearch,
}: RegistrySearchBarProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={registrySource}
          onChange={(e) => setRegistrySource(e.target.value as RegistrySource)}
          className="h-9 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground"
        >
          <option value="clawhub">ClawdHub</option>
          <option value="skills-sh">skills.sh</option>
          <option value="awesome-openclaw">Awesome OpenClaw</option>
        </select>
        <input
          value={registryQuery}
          onChange={(e) => setRegistryQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder={t('registrySearchPlaceholder')}
          className="h-9 flex-1 rounded-md border border-border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <Button variant="default" size="sm" onClick={onSearch} disabled={registryLoading || !registryQuery.trim()}>
          {registryLoading ? t('searching') : t('search')}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('installTo')}</span>
        <select value={installTarget} onChange={(e) => setInstallTarget(e.target.value)} className="h-7 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground">
          <option value="user-agents">{SOURCE_LABELS['user-agents']}</option>
          <option value="user-codex">{SOURCE_LABELS['user-codex']}</option>
          <option value="project-agents">{SOURCE_LABELS['project-agents']}</option>
          <option value="project-codex">{SOURCE_LABELS['project-codex']}</option>
          {dashboardMode === 'full' && <option value="openclaw">{SOURCE_LABELS['openclaw']}</option>}
          <option value="workspace">{SOURCE_LABELS['workspace']}</option>
        </select>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RegistryResults
// ---------------------------------------------------------------------------

interface RegistryResultsProps {
  t: ReturnType<typeof useTranslations>
  registryResults: RegistrySkill[]
  registryLoading: boolean
  registrySearched: boolean
  registryQuery: string
  registrySource: RegistrySource
  registryNames: Record<string, string>
  installing: string | null
  onInstall: (slug: string, name?: string) => void
}

function RegistryResults({
  t, registryResults, registryLoading, registrySearched, registryQuery,
  registrySource, registryNames, installing, onInstall,
}: RegistryResultsProps): React.ReactElement {
  if (registryResults.length > 0) {
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
          {registryResults.length} results from {registryNames[registrySource]}
        </div>
        <div className="divide-y divide-border">
          {registryResults.map((skill) => (
            <RegistrySkillRow key={skill.slug} skill={skill} installing={installing} onInstall={onInstall} t={t} />
          ))}
        </div>
      </div>
    )
  }

  if (registryLoading) {
    return <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t('searching')}</div>
  }

  if (registrySearched) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        {t('noRegistryResults', { query: registryQuery, registry: registryNames[registrySource] })}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
      {t('registryPrompt')}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RegistrySkillRow
// ---------------------------------------------------------------------------

interface RegistrySkillRowProps {
  skill: RegistrySkill
  installing: string | null
  onInstall: (slug: string, name?: string) => void
  t: ReturnType<typeof useTranslations>
}

function RegistrySkillRow({ skill, installing, onInstall, t }: RegistrySkillRowProps): React.ReactElement {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-sm text-foreground">{skill.name}</div>
          <div className="text-2xs text-muted-foreground mt-0.5">
            by {skill.author} • v{skill.version}
            {skill.installCount != null && ` • ${skill.installCount} installs`}
          </div>
        </div>
        <Button variant="default" size="xs" onClick={() => onInstall(skill.slug, skill.name)} disabled={installing === skill.slug}>
          {installing === skill.slug ? t('installing') : t('install')}
        </Button>
      </div>
      {skill.description && <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>}
      {skill.tags && skill.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {skill.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="text-2xs rounded-full bg-secondary/50 border border-border px-1.5 py-0.5 text-muted-foreground">{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}
