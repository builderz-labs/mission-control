'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { SOURCE_LABELS, getSourceLabel } from './constants'
import type { SkillSummary, SkillGroup, ScanAllState } from './types'

export interface InstalledTabProps {
  t: ReturnType<typeof useTranslations>
  loading: boolean
  error: string | null
  saving: boolean
  query: string
  setQuery: (v: string) => void
  activeRoot: string | null
  setActiveRoot: (v: string | null) => void
  filtered: SkillSummary[]
  skillGroups: SkillGroup[] | null
  skillsTotal: number
  dashboardMode: string
  createSource: string
  setCreateSource: (v: string) => void
  createName: string
  setCreateName: (v: string) => void
  createContent: string
  setCreateContent: (v: string) => void
  createError: string | null
  scanAll: ScanAllState | null
  setScanAll: (v: ScanAllState | null) => void
  onRefresh: () => void
  onCreateSkill: () => void
  onCheckSecurity: (skill: SkillSummary) => void
  onSelectSkill: (skill: SkillSummary) => void
  onScanAll: () => void
  securityBadge: (status?: string | null) => React.ReactNode
}

export function InstalledTab({
  t, loading, error, saving, query, setQuery, activeRoot, setActiveRoot,
  filtered, skillGroups, skillsTotal, dashboardMode,
  createSource, setCreateSource, createName, setCreateName,
  createContent, setCreateContent, createError, scanAll, setScanAll,
  onRefresh, onCreateSkill, onCheckSecurity, onSelectSkill, onScanAll, securityBadge,
}: InstalledTabProps): React.ReactElement {
  return (
    <>
      <SearchBar query={query} setQuery={setQuery} filtered={filtered} skillsTotal={skillsTotal} t={t} />

      <CreateSkillBar
        t={t}
        saving={saving}
        loading={loading}
        scanAll={scanAll}
        setScanAll={setScanAll}
        dashboardMode={dashboardMode}
        createSource={createSource}
        setCreateSource={setCreateSource}
        createName={createName}
        setCreateName={setCreateName}
        createContent={createContent}
        setCreateContent={setCreateContent}
        createError={createError}
        onRefresh={onRefresh}
        onCreateSkill={onCreateSkill}
        onScanAll={onScanAll}
      />

      {loading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t('loadingSkills')}</div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-destructive">{error}</div>
      ) : (
        <>
          <SourceGroupGrid skillGroups={skillGroups} activeRoot={activeRoot} setActiveRoot={setActiveRoot} t={t} />
          <SkillList
            filtered={filtered}
            skillsTotal={skillsTotal}
            securityBadge={securityBadge}
            onCheckSecurity={onCheckSecurity}
            onSelectSkill={onSelectSkill}
            t={t}
          />
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// SearchBar
// ---------------------------------------------------------------------------

interface SearchBarProps {
  query: string
  setQuery: (v: string) => void
  filtered: SkillSummary[]
  skillsTotal: number
  t: ReturnType<typeof useTranslations>
}

function SearchBar({ query, setQuery, filtered, skillsTotal, t }: SearchBarProps): React.ReactElement {
  return (
    <>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-9 w-full rounded-md border border-border bg-secondary/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground text-xs" title="Clear">
            ✕
          </button>
        )}
      </div>
      {query && (
        <div className="text-2xs text-muted-foreground">
          {t('searchResults', { count: filtered.length, total: skillsTotal, query })}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// CreateSkillBar — scan-all progress + create form
// ---------------------------------------------------------------------------

interface CreateSkillBarProps {
  t: ReturnType<typeof useTranslations>
  saving: boolean
  loading: boolean
  scanAll: ScanAllState | null
  setScanAll: (v: ScanAllState | null) => void
  dashboardMode: string
  createSource: string
  setCreateSource: (v: string) => void
  createName: string
  setCreateName: (v: string) => void
  createContent: string
  setCreateContent: (v: string) => void
  createError: string | null
  onRefresh: () => void
  onCreateSkill: () => void
  onScanAll: () => void
}

function CreateSkillBar({
  t, saving, loading, scanAll, setScanAll, dashboardMode,
  createSource, setCreateSource, createName, setCreateName,
  createContent, setCreateContent, createError, onRefresh, onCreateSkill, onScanAll,
}: CreateSkillBarProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{t('diskSyncActive')}</div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="xs" onClick={onScanAll} disabled={loading || saving || !!scanAll?.running}>
            {scanAll?.running ? t('scanningProgress', { done: scanAll.done, total: scanAll.total }) : t('scanAll')}
          </Button>
          <Button variant="outline" size="xs" onClick={onRefresh} disabled={loading || saving}>{t('refreshNow')}</Button>
        </div>
      </div>

      {scanAll && <ScanProgress scanAll={scanAll} setScanAll={setScanAll} t={t} />}

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr_auto] gap-2">
        <select value={createSource} onChange={(e) => setCreateSource(e.target.value)} className="h-9 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground">
          <option value="user-agents">{SOURCE_LABELS['user-agents']}</option>
          <option value="user-codex">{SOURCE_LABELS['user-codex']}</option>
          <option value="project-agents">{SOURCE_LABELS['project-agents']}</option>
          <option value="project-codex">{SOURCE_LABELS['project-codex']}</option>
          {dashboardMode === 'full' && <option value="openclaw">{SOURCE_LABELS['openclaw']}</option>}
          <option value="workspace">{SOURCE_LABELS['workspace']}</option>
        </select>
        <input
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          placeholder="new-skill-name"
          className="h-9 rounded-md border border-border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <Button variant="default" size="sm" onClick={onCreateSkill} disabled={saving || !createName.trim()}>{t('addSkill')}</Button>
      </div>
      <textarea
        value={createContent}
        onChange={(e) => setCreateContent(e.target.value)}
        className="w-full h-24 rounded-md border border-border bg-secondary/30 p-2 text-xs text-foreground font-mono focus:outline-none"
        placeholder={t('initialContent')}
      />
      {createError && <p className="text-xs text-destructive">{createError}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ScanProgress
// ---------------------------------------------------------------------------

interface ScanProgressProps {
  scanAll: ScanAllState
  setScanAll: (v: ScanAllState | null) => void
  t: ReturnType<typeof useTranslations>
}

function ScanProgress({ scanAll, setScanAll, t }: ScanProgressProps): React.ReactElement {
  return (
    <div className="space-y-2">
      {scanAll.running && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-2xs text-muted-foreground">
            <span>{t('scanning')} <span className="text-foreground font-medium">{scanAll.current}</span></span>
            <span>{scanAll.done}/{scanAll.total}</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(scanAll.done / scanAll.total) * 100}%` }} />
          </div>
        </div>
      )}
      {!scanAll.running && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-2xs">
            <span className="text-emerald-400">{scanAll.results.clean} clean</span>
            {scanAll.results.warning > 0 && <span className="text-amber-400">{scanAll.results.warning} warning</span>}
            {scanAll.results.rejected > 0 && <span className="text-rose-400">{scanAll.results.rejected} rejected</span>}
            {scanAll.results.error > 0 && <span className="text-destructive">{scanAll.results.error} errors</span>}
            <span className="text-muted-foreground">— {t('skillsScanned', { count: scanAll.total })}</span>
          </div>
          <button onClick={() => setScanAll(null)} className="text-2xs text-muted-foreground/50 hover:text-foreground">{t('dismiss')}</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SourceGroupGrid
// ---------------------------------------------------------------------------

interface SourceGroupGridProps {
  skillGroups: SkillGroup[] | null
  activeRoot: string | null
  setActiveRoot: (v: string | null) => void
  t: ReturnType<typeof useTranslations>
}

function SourceGroupGrid({ skillGroups, activeRoot, setActiveRoot, t }: SourceGroupGridProps): React.ReactElement {
  const visibleGroups = (skillGroups || []).filter(
    g => g.skills.length > 0 || ['user-agents', 'user-codex', 'openclaw', 'workspace'].includes(g.source) || g.source.startsWith('workspace-')
  )
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {activeRoot && (
        <button onClick={() => setActiveRoot(null)} className="col-span-full text-left text-2xs text-primary hover:underline">
          {t('showAllRoots')}
        </button>
      )}
      {visibleGroups.map((group) => (
        <button
          key={group.source}
          onClick={() => setActiveRoot(activeRoot === group.source ? null : group.source)}
          className={`rounded-lg border bg-card p-3 text-left transition-colors ${
            activeRoot === group.source ? 'border-primary ring-1 ring-primary/30'
              : group.source === 'openclaw' ? 'border-cyan-500/30 hover:border-cyan-500/50'
              : group.source.startsWith('workspace-') ? 'border-violet-500/30 hover:border-violet-500/50'
              : 'border-border hover:border-border/80'
          }`}
        >
          <div className="text-xs font-medium text-muted-foreground">{getSourceLabel(group.source)}</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{group.skills.length}</div>
          <div className="mt-1 text-2xs text-muted-foreground truncate">{group.path}</div>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkillList
// ---------------------------------------------------------------------------

interface SkillListProps {
  filtered: SkillSummary[]
  skillsTotal: number
  securityBadge: (status?: string | null) => React.ReactNode
  onCheckSecurity: (skill: SkillSummary) => void
  onSelectSkill: (skill: SkillSummary) => void
  t: ReturnType<typeof useTranslations>
}

function SkillList({ filtered, skillsTotal, securityBadge, onCheckSecurity, onSelectSkill, t }: SkillListProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
        {t('skillCount', { count: filtered.length, total: skillsTotal })}
      </div>
      {filtered.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">{t('noMatch')}</div>
      ) : (
        <div className="divide-y divide-border">
          {filtered.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              securityBadge={securityBadge}
              onCheckSecurity={onCheckSecurity}
              onSelectSkill={onSelectSkill}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkillRow
// ---------------------------------------------------------------------------

interface SkillRowProps {
  skill: SkillSummary
  securityBadge: (status?: string | null) => React.ReactNode
  onCheckSecurity: (skill: SkillSummary) => void
  onSelectSkill: (skill: SkillSummary) => void
  t: ReturnType<typeof useTranslations>
}

function SkillRow({ skill, securityBadge, onCheckSecurity, onSelectSkill, t }: SkillRowProps): React.ReactElement {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm text-foreground">{skill.name}</div>
          {skill.registry_slug && (
            <span className="text-2xs rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 px-1.5 py-0.5">registry</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {securityBadge(skill.security_status)}
          <span className={`text-2xs rounded-full border px-2 py-0.5 ${
            skill.source === 'openclaw' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
              : skill.source.startsWith('workspace-') ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
              : skill.source.startsWith('project-') ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              : 'border-border text-muted-foreground'
          }`}>
            {getSourceLabel(skill.source)}
          </span>
          <Button variant="outline" size="xs" onClick={() => onCheckSecurity(skill)}>{t('scan')}</Button>
          <Button variant="outline" size="xs" onClick={() => onSelectSkill(skill)}>{t('view')}</Button>
        </div>
      </div>
      {skill.description && <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>}
      <p className="mt-1 text-2xs text-muted-foreground/70 break-all">{skill.path}</p>
    </div>
  )
}
