'use client'

import { getErrorMessage } from '@/lib/types/sql'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'
import { SOURCE_LABELS, getSourceLabel } from './skills/constants'
import { InstallModal } from './skills/InstallModal'
import { SkillDrawer } from './skills/SkillDrawer'
import type {
  SkillSummary,
  SkillsResponse,
  SkillContentResponse,
  RegistrySkill,
  PanelTab,
  RegistrySource,
  ScanAllState,
  InstallModalState,
} from './skills/types'

export function SkillsPanel() {
  const t = useTranslations('skills')
  const { dashboardMode, skillsList, skillGroups, skillsTotal, setSkillsData } = useMissionControl()
  const [loading, setLoading] = useState(skillsList === null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeRoot, setActiveRoot] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null)
  const [selectedContent, setSelectedContent] = useState<SkillContentResponse | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [createSource, setCreateSource] = useState(dashboardMode === 'full' ? 'openclaw' : 'user-codex')
  const [createName, setCreateName] = useState('')
  const [createContent, setCreateContent] = useState('# new-skill\n\nDescribe this skill.\n')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('installed')
  const [registrySource, setRegistrySource] = useState<RegistrySource>('awesome-openclaw')
  const [registryQuery, setRegistryQuery] = useState('')
  const [registryResults, setRegistryResults] = useState<RegistrySkill[]>([])
  const [registryLoading, setRegistryLoading] = useState(false)
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [registrySearched, setRegistrySearched] = useState(false)
  const [installTarget, setInstallTarget] = useState(dashboardMode === 'full' ? 'openclaw' : 'user-agents')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [scanAll, setScanAll] = useState<ScanAllState | null>(null)
  const [installModal, setInstallModal] = useState<InstallModalState | null>(null)

  useEffect(() => { setIsMounted(true) }, [])

  const loadSkills = useCallback(async (opts?: { initial?: boolean }): Promise<void> => {
    if (opts?.initial) setLoading(true)
    setError(null)
    const res = await fetch('/api/skills', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error || 'Failed to load skills')
    const resp = body as SkillsResponse
    setSkillsData(resp.skills, resp.groups, resp.total)
    if (opts?.initial) setLoading(false)
  }, [setSkillsData])

  // Skip initial fetch if cached data exists from a previous mount
  useEffect(() => {
    if (skillsList !== null) return
    let cancelled = false
    async function run() {
      try {
        await loadSkills({ initial: true })
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(err) || 'Failed to load skills')
          setLoading(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [loadSkills, skillsList])

  // Two-way disk sync: poll for external on-disk changes
  useEffect(() => {
    const id = window.setInterval(() => { loadSkills().catch(() => {}) }, 10000)
    return () => window.clearInterval(id)
  }, [loadSkills])

  const filtered = useMemo(() => {
    let list = skillsList || []
    if (activeRoot) list = list.filter((s) => s.source === activeRoot)
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((skill) => {
      const haystack = `${skill.name} ${skill.source} ${skill.description || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [skillsList, query, activeRoot])

  useEffect(() => {
    if (!selectedSkill) return
    const skill = selectedSkill
    let cancelled = false
    async function run() {
      setDrawerLoading(true)
      setDrawerError(null)
      setSelectedContent(null)
      try {
        const params = new URLSearchParams({ mode: 'content', source: skill.source, name: skill.name })
        const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Failed to load SKILL.md')
        if (!cancelled) setSelectedContent(body as SkillContentResponse)
      } catch (err: unknown) {
        if (!cancelled) setDrawerError(getErrorMessage(err) || 'Failed to load SKILL.md')
      } finally {
        if (!cancelled) setDrawerLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedSkill])

  useEffect(() => { setDraftContent(selectedContent?.content || '') }, [selectedContent?.content])

  useEffect(() => {
    if (!selectedSkill) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedSkill(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedSkill])

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      await loadSkills()
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to refresh skills')
    } finally {
      setLoading(false)
    }
  }

  const createSkill = async (): Promise<void> => {
    setCreateError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: createSource, name: createName.trim(), content: createContent }),
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to create skill')
      setCreateName('')
      await loadSkills()
    } catch (err: unknown) {
      setCreateError(getErrorMessage(err) || 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }

  const saveSkill = async (): Promise<void> => {
    if (!selectedSkill) return
    setSaving(true)
    setDrawerError(null)
    try {
      const res = await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: selectedSkill.source, name: selectedSkill.name, content: draftContent }),
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to save skill')
      await loadSkills()
      setSelectedContent((prev) => prev ? { ...prev, content: draftContent } : prev)
    } catch (err: unknown) {
      setDrawerError(getErrorMessage(err) || 'Failed to save skill')
    } finally {
      setSaving(false)
    }
  }

  const deleteSkill = async (): Promise<void> => {
    if (!selectedSkill) return
    const ok = window.confirm(`Delete skill "${selectedSkill.name}"? This removes it from disk.`)
    if (!ok) return
    setSaving(true)
    setDrawerError(null)
    try {
      const params = new URLSearchParams({ source: selectedSkill.source, name: selectedSkill.name })
      const res = await fetch(`/api/skills?${params.toString()}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to delete skill')
      setSelectedSkill(null)
      setSelectedContent(null)
      await loadSkills()
    } catch (err: unknown) {
      setDrawerError(getErrorMessage(err) || 'Failed to delete skill')
    } finally {
      setSaving(false)
    }
  }

  const searchRegistry = async (): Promise<void> => {
    if (!registryQuery.trim()) return
    setRegistryLoading(true)
    setRegistryError(null)
    try {
      const params = new URLSearchParams({ source: registrySource, q: registryQuery.trim() })
      const res = await fetch(`/api/skills/registry?${params.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Search failed')
      setRegistryResults(body?.skills || [])
      setRegistrySearched(true)
    } catch (err: unknown) {
      setRegistryError(getErrorMessage(err) || 'Search failed')
    } finally {
      setRegistryLoading(false)
    }
  }

  const installSkill = async (slug: string, skillName?: string): Promise<void> => {
    const displayName = skillName || slug.split('/').pop() || slug
    setInstalling(slug)
    setInstallMessage(null)
    setInstallModal({ slug, name: displayName, step: 'fetching' })
    try {
      // Simulate step progression — the API does fetch+scan+write in one call,
      // so we show intermediate steps on a timer for UX feedback
      const stepTimer = setTimeout(() => {
        setInstallModal(prev => prev?.slug === slug ? { ...prev, step: 'scanning' } : prev)
      }, 800)
      const writeTimer = setTimeout(() => {
        setInstallModal(prev => prev?.slug === slug ? { ...prev, step: 'writing' } : prev)
      }, 1600)

      const res = await fetch('/api/skills/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: registrySource, slug, targetRoot: installTarget }),
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json()
      clearTimeout(stepTimer)
      clearTimeout(writeTimer)

      if (!res.ok) {
        const msg = body?.message || body?.error || 'Install failed'
        setInstallModal({ slug, name: displayName, step: 'error', message: msg, securityStatus: body?.securityReport?.status })
      } else {
        setInstallModal({ slug, name: displayName, step: 'done', message: body?.message || 'Installed successfully', securityStatus: body?.securityReport?.status })
        await loadSkills()
      }
    } catch (err: unknown) {
      setInstallModal({ slug, name: displayName, step: 'error', message: getErrorMessage(err) || 'Network error' })
    } finally {
      setInstalling(null)
    }
  }

  const checkSecurity = async (skill: SkillSummary): Promise<void> => {
    try {
      const params = new URLSearchParams({ mode: 'check', source: skill.source, name: skill.name })
      const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      const body = await res.json()
      if (res.ok && body?.security) {
        await loadSkills() // refresh to pick up updated security_status
      }
    } catch { /* best-effort */ }
  }

  const scanAllSkills = async (): Promise<void> => {
    const skills = skillsList || []
    if (skills.length === 0) return
    const state: ScanAllState = {
      running: true,
      total: skills.length,
      done: 0,
      current: null,
      results: { clean: 0, warning: 0, rejected: 0, error: 0 },
    }
    setScanAll({ ...state })

    for (const skill of skills) {
      state.current = skill.name
      setScanAll({ ...state })
      try {
        const params = new URLSearchParams({ mode: 'check', source: skill.source, name: skill.name })
        const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        const body = await res.json()
        if (res.ok && body?.security) {
          const s = body.security.status as string
          if (s === 'clean') state.results.clean++
          else if (s === 'warning') state.results.warning++
          else if (s === 'rejected') state.results.rejected++
          else state.results.clean++
        } else {
          state.results.error++
        }
      } catch {
        state.results.error++
      }
      state.done++
      setScanAll({ ...state })
    }

    state.running = false
    state.current = null
    setScanAll({ ...state })
    await loadSkills()
  }

  const securityBadge = (status?: string | null) => {
    if (!status || status === 'unchecked') return <span className="text-2xs text-muted-foreground/50">unchecked</span>
    if (status === 'clean') return <span className="text-2xs text-emerald-400">clean</span>
    if (status === 'warning') return <span className="text-2xs text-amber-400">warning</span>
    if (status === 'rejected') return <span className="text-2xs text-rose-400">rejected</span>
    return null
  }

  const REGISTRY_NAMES: Record<string, string> = {
    clawhub: 'ClawdHub',
    'skills-sh': 'skills.sh',
    'awesome-openclaw': 'Awesome OpenClaw',
  }

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
            onClick={() => setActiveTab('installed')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTab === 'installed' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            {t('tabInstalled')}
          </button>
          <button
            onClick={() => setActiveTab('registry')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTab === 'registry' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            {t('tabRegistry')}
          </button>
        </div>
      </div>

      {installMessage && (
        <div className={`rounded-lg border px-4 py-2 text-xs ${
          installMessage.startsWith('Failed') || installMessage.startsWith('Install error')
            ? 'bg-destructive/10 border-destructive/30 text-destructive'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        }`}>
          {installMessage}
        </div>
      )}

      {activeTab === 'installed' && (
        <InstalledTab
          t={t}
          loading={loading}
          error={error}
          saving={saving}
          query={query}
          setQuery={setQuery}
          activeRoot={activeRoot}
          setActiveRoot={setActiveRoot}
          filtered={filtered}
          skillGroups={skillGroups}
          skillsTotal={skillsTotal}
          dashboardMode={dashboardMode}
          createSource={createSource}
          setCreateSource={setCreateSource}
          createName={createName}
          setCreateName={setCreateName}
          createContent={createContent}
          setCreateContent={setCreateContent}
          createError={createError}
          scanAll={scanAll}
          setScanAll={setScanAll}
          onRefresh={refresh}
          onCreateSkill={createSkill}
          onCheckSecurity={checkSecurity}
          onSelectSkill={setSelectedSkill}
          onScanAll={scanAllSkills}
          securityBadge={securityBadge}
        />
      )}

      {activeTab === 'registry' && (
        <RegistryTab
          t={t}
          dashboardMode={dashboardMode}
          registrySource={registrySource}
          setRegistrySource={(src) => { setRegistrySource(src); setRegistryResults([]); setRegistrySearched(false) }}
          registryQuery={registryQuery}
          setRegistryQuery={setRegistryQuery}
          registryLoading={registryLoading}
          registryError={registryError}
          registryResults={registryResults}
          registrySearched={registrySearched}
          installTarget={installTarget}
          setInstallTarget={setInstallTarget}
          installing={installing}
          registryNames={REGISTRY_NAMES}
          onSearch={searchRegistry}
          onInstall={installSkill}
        />
      )}

      {isMounted && installModal && createPortal(
        <InstallModal
          modal={installModal}
          onClose={() => setInstallModal(null)}
          onViewInstalled={() => { setInstallModal(null); setActiveTab('installed') }}
        />,
        document.body
      )}

      {isMounted && selectedSkill && createPortal(
        <SkillDrawer
          skill={selectedSkill}
          content={selectedContent}
          draftContent={draftContent}
          loading={drawerLoading}
          error={drawerError}
          saving={saving}
          onClose={() => setSelectedSkill(null)}
          onSave={saveSkill}
          onDelete={deleteSkill}
          onDraftChange={setDraftContent}
        />,
        document.body
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// InstalledTab
// ---------------------------------------------------------------------------

interface InstalledTabProps {
  t: ReturnType<typeof useTranslations>
  loading: boolean
  error: string | null
  saving: boolean
  query: string
  setQuery: (v: string) => void
  activeRoot: string | null
  setActiveRoot: (v: string | null) => void
  filtered: import('./skills/types').SkillSummary[]
  skillGroups: import('./skills/types').SkillGroup[] | null
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
  onCheckSecurity: (skill: import('./skills/types').SkillSummary) => void
  onSelectSkill: (skill: import('./skills/types').SkillSummary) => void
  onScanAll: () => void
  securityBadge: (status?: string | null) => React.ReactNode
}

function InstalledTab({
  t, loading, error, saving, query, setQuery, activeRoot, setActiveRoot,
  filtered, skillGroups, skillsTotal, dashboardMode,
  createSource, setCreateSource, createName, setCreateName,
  createContent, setCreateContent, createError, scanAll, setScanAll,
  onRefresh, onCreateSkill, onCheckSecurity, onSelectSkill, onScanAll, securityBadge,
}: InstalledTabProps) {
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

        {scanAll && (
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
        )}

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

      {loading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t('loadingSkills')}</div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-destructive">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {activeRoot && (
              <button onClick={() => setActiveRoot(null)} className="col-span-full text-left text-2xs text-primary hover:underline">
                {t('showAllRoots')}
              </button>
            )}
            {(skillGroups || [])
              .filter(g => g.skills.length > 0 || ['user-agents', 'user-codex', 'openclaw', 'workspace'].includes(g.source) || g.source.startsWith('workspace-'))
              .map((group) => (
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

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
              {t('skillCount', { count: filtered.length, total: skillsTotal })}
            </div>
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">{t('noMatch')}</div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((skill) => (
                  <div key={skill.id} className="px-4 py-3">
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
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// RegistryTab
// ---------------------------------------------------------------------------

interface RegistryTabProps {
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

function RegistryTab({
  t, dashboardMode, registrySource, setRegistrySource, registryQuery, setRegistryQuery,
  registryLoading, registryError, registryResults, registrySearched,
  installTarget, setInstallTarget, installing, registryNames, onSearch, onInstall,
}: RegistryTabProps) {
  return (
    <>
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

      {registryError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{registryError}</div>
      )}

      {registryResults.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
            {registryResults.length} results from {registryNames[registrySource]}
          </div>
          <div className="divide-y divide-border">
            {registryResults.map((skill) => (
              <div key={skill.slug} className="px-4 py-3">
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
            ))}
          </div>
        </div>
      ) : registryLoading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t('searching')}</div>
      ) : registrySearched ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('noRegistryResults', { query: registryQuery, registry: registryNames[registrySource] })}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('registryPrompt')}
        </div>
      )}
    </>
  )
}
