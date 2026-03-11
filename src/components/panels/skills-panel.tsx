'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

interface SkillSummary {
  id: string
  name: string
  source: string
  path: string
  description?: string
  registry_slug?: string | null
  security_status?: string | null
}

interface SkillGroup {
  source: string
  path: string
  skills: SkillSummary[]
}

interface SkillsResponse {
  skills: SkillSummary[]
  groups: SkillGroup[]
  total: number
}

interface SkillContentResponse {
  source: string
  name: string
  skillPath: string
  skillDocPath: string
  content: string
  security?: { status: string; issues: Array<{ severity: string; rule: string; description: string; line?: number }> }
}

interface RegistrySkill {
  slug: string
  name: string
  description: string
  author: string
  version: string
  source: string
  installCount?: number
  tags?: string[]
}

type PanelTab = 'installed' | 'registry'

const SOURCE_LABELS: Record<string, string> = {
  'user-agents': '~/.agents/skills (global)',
  'user-codex': '~/.codex/skills (global)',
  'project-agents': '.agents/skills (project)',
  'project-codex': '.codex/skills (project)',
  'openclaw': '~/.openclaw/skills (gateway)',
}

export function SkillsPanel() {
  const { dashboardMode, skillsList, skillGroups, skillsTotal, setSkillsData } = useMissionControl()
  const [loading, setLoading] = useState(skillsList === null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
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
  const [registrySource, setRegistrySource] = useState<'clawhub' | 'skills-sh' | 'awesome-openclaw'>('awesome-openclaw')
  const [registryQuery, setRegistryQuery] = useState('')
  const [registryResults, setRegistryResults] = useState<RegistrySkill[]>([])
  const [registryLoading, setRegistryLoading] = useState(false)
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [registrySearched, setRegistrySearched] = useState(false)
  const [installTarget, setInstallTarget] = useState(dashboardMode === 'full' ? 'openclaw' : 'user-agents')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [scanAll, setScanAll] = useState<{
    running: boolean
    total: number
    done: number
    current: string | null
    results: { clean: number; warning: number; rejected: number; error: number }
  } | null>(null)
  const [installModal, setInstallModal] = useState<{
    slug: string
    name: string
    step: 'fetching' | 'scanning' | 'writing' | 'done' | 'error'
    message?: string
    securityStatus?: string
  } | null>(null)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const loadSkills = useCallback(async (opts?: { initial?: boolean }) => {
    if (opts?.initial) setLoading(true)
    setError(null)
    const res = await fetch('/api/skills', { cache: 'no-store' })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error || 'Failed to load skills')
    const resp = body as SkillsResponse
    setSkillsData(resp.skills, resp.groups, resp.total)
    if (opts?.initial) setLoading(false)
  }, [setSkillsData])

  useEffect(() => {
    // Skip initial fetch if we already have cached data from a previous mount
    if (skillsList !== null) return
    let cancelled = false
    async function run() {
      try {
        await loadSkills({ initial: true })
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load skills')
          setLoading(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [loadSkills, skillsList])

  // Two-way disk sync: poll for external on-disk changes.
  useEffect(() => {
    const id = window.setInterval(() => {
      loadSkills().catch(() => {})
    }, 10000)
    return () => window.clearInterval(id)
  }, [loadSkills])

  const filtered = useMemo(() => {
    const list = skillsList || []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((skill) => {
      const haystack = `${skill.name} ${skill.source} ${skill.description || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [skillsList, query])

  useEffect(() => {
    if (!selectedSkill) return
    const skill = selectedSkill
    let cancelled = false
    async function run() {
      setDrawerLoading(true)
      setDrawerError(null)
      setSelectedContent(null)
      try {
        const params = new URLSearchParams({
          mode: 'content',
          source: skill.source,
          name: skill.name,
        })
        const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Failed to load SKILL.md')
        if (!cancelled) setSelectedContent(body as SkillContentResponse)
      } catch (err: any) {
        if (!cancelled) setDrawerError(err?.message || 'Failed to load SKILL.md')
      } finally {
        if (!cancelled) setDrawerLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedSkill])

  useEffect(() => {
    setDraftContent(selectedContent?.content || '')
  }, [selectedContent?.content])

  useEffect(() => {
    if (!selectedSkill) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedSkill(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedSkill])

  const refresh = async () => {
    setLoading(true)
    try {
      await loadSkills()
    } catch (err: any) {
      setError(err?.message || 'Failed to refresh skills')
    } finally {
      setLoading(false)
    }
  }

  const createSkill = async () => {
    setCreateError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: createSource,
          name: createName.trim(),
          content: createContent,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to create skill')
      setCreateName('')
      await loadSkills()
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }

  const saveSkill = async () => {
    if (!selectedSkill) return
    setSaving(true)
    setDrawerError(null)
    try {
      const res = await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: selectedSkill.source,
          name: selectedSkill.name,
          content: draftContent,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to save skill')
      await loadSkills()
      setSelectedContent((prev) => prev ? { ...prev, content: draftContent } : prev)
    } catch (err: any) {
      setDrawerError(err?.message || 'Failed to save skill')
    } finally {
      setSaving(false)
    }
  }

  const deleteSkill = async () => {
    if (!selectedSkill) return
    const ok = window.confirm(`Delete skill "${selectedSkill.name}"? This removes it from disk.`)
    if (!ok) return
    setSaving(true)
    setDrawerError(null)
    try {
      const params = new URLSearchParams({ source: selectedSkill.source, name: selectedSkill.name })
      const res = await fetch(`/api/skills?${params.toString()}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to delete skill')
      setSelectedSkill(null)
      setSelectedContent(null)
      await loadSkills()
    } catch (err: any) {
      setDrawerError(err?.message || 'Failed to delete skill')
    } finally {
      setSaving(false)
    }
  }

  const searchRegistry = async () => {
    if (!registryQuery.trim()) return
    setRegistryLoading(true)
    setRegistryError(null)
    try {
      const params = new URLSearchParams({ source: registrySource, q: registryQuery.trim() })
      const res = await fetch(`/api/skills/registry?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Search failed')
      setRegistryResults(body?.skills || [])
      setRegistrySearched(true)
    } catch (err: any) {
      setRegistryError(err?.message || 'Search failed')
    } finally {
      setRegistryLoading(false)
    }
  }

  const installSkill = async (slug: string, skillName?: string) => {
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
    } catch (err: any) {
      setInstallModal({ slug, name: displayName, step: 'error', message: err?.message || 'Network error' })
    } finally {
      setInstalling(null)
    }
  }

  const checkSecurity = async (skill: SkillSummary) => {
    try {
      const params = new URLSearchParams({ mode: 'check', source: skill.source, name: skill.name })
      const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (res.ok && body?.security) {
        await loadSkills() // refresh to pick up updated security_status
      }
    } catch { /* best-effort */ }
  }

  const scanAllSkills = async () => {
    const skills = skillsList || []
    if (skills.length === 0) return
    const state = {
      running: true,
      total: skills.length,
      done: 0,
      current: null as string | null,
      results: { clean: 0, warning: 0, rejected: 0, error: 0 },
    }
    setScanAll({ ...state })

    for (const skill of skills) {
      state.current = skill.name
      setScanAll({ ...state })
      try {
        const params = new URLSearchParams({ mode: 'check', source: skill.source, name: skill.name })
        const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store' })
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

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Skills Hub</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage skills locally and browse external registries. {dashboardMode === 'local' ? 'Local mode' : 'Gateway mode'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('installed')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTab === 'installed' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            Installed
          </button>
          <button
            onClick={() => setActiveTab('registry')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTab === 'registry' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            Registry
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
        <>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick find installed skills..."
              className="h-9 w-full rounded-md border border-border bg-secondary/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground text-xs"
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>
          {query && (
            <div className="text-2xs text-muted-foreground">
              Showing {filtered.length} of {skillsTotal} skills matching &quot;{query}&quot;
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">Bidirectional disk sync active (scheduler every 60s)</div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={scanAllSkills}
                  disabled={loading || saving || !!scanAll?.running}
                >
                  {scanAll?.running ? `Scanning ${scanAll.done}/${scanAll.total}...` : 'Scan All'}
                </Button>
                <Button variant="outline" size="xs" onClick={refresh} disabled={loading || saving}>Refresh Now</Button>
              </div>
            </div>

            {/* Scan All progress / results */}
            {scanAll && (
              <div className="space-y-2">
                {scanAll.running && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-2xs text-muted-foreground">
                      <span>Scanning: <span className="text-foreground font-medium">{scanAll.current}</span></span>
                      <span>{scanAll.done}/{scanAll.total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${(scanAll.done / scanAll.total) * 100}%` }}
                      />
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
                      <span className="text-muted-foreground">— {scanAll.total} skills scanned</span>
                    </div>
                    <button onClick={() => setScanAll(null)} className="text-2xs text-muted-foreground/50 hover:text-foreground">dismiss</button>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr_auto] gap-2">
              <select
                value={createSource}
                onChange={(e) => setCreateSource(e.target.value)}
                className="h-9 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground"
              >
                <option value="user-agents">{SOURCE_LABELS['user-agents']}</option>
                <option value="user-codex">{SOURCE_LABELS['user-codex']}</option>
                <option value="project-agents">{SOURCE_LABELS['project-agents']}</option>
                <option value="project-codex">{SOURCE_LABELS['project-codex']}</option>
                {dashboardMode === 'full' && (
                  <option value="openclaw">{SOURCE_LABELS['openclaw']}</option>
                )}
              </select>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="new-skill-name"
                className="h-9 rounded-md border border-border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <Button variant="default" size="sm" onClick={createSkill} disabled={saving || !createName.trim()}>
                Add Skill
              </Button>
            </div>
            <textarea
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              className="w-full h-24 rounded-md border border-border bg-secondary/30 p-2 text-xs text-foreground font-mono focus:outline-none"
              placeholder="Initial SKILL.md content"
            />
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </div>

          {loading ? (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">Loading skills...</div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-destructive">{error}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {(skillGroups || []).filter(g => g.skills.length > 0 || ['user-agents', 'user-codex', 'openclaw'].includes(g.source)).map((group) => (
                  <div key={group.source} className={`rounded-lg border bg-card p-3 ${
                    group.source === 'openclaw' ? 'border-cyan-500/30' : 'border-border'
                  }`}>
                    <div className="text-xs font-medium text-muted-foreground">{SOURCE_LABELS[group.source] || group.source}</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">{group.skills.length}</div>
                    <div className="mt-1 text-2xs text-muted-foreground truncate">{group.path}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
                  {filtered.length} of {skillsTotal} skills
                </div>
                {filtered.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">No skills matched this filter.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {filtered.map((skill) => (
                      <div key={skill.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-sm text-foreground">{skill.name}</div>
                            {skill.registry_slug && (
                              <span className="text-2xs rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 px-1.5 py-0.5">
                                registry
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {securityBadge(skill.security_status)}
                            <span className={`text-2xs rounded-full border px-2 py-0.5 ${
                              skill.source === 'openclaw'
                                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                                : skill.source.startsWith('project-')
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                  : 'border-border text-muted-foreground'
                            }`}>
                              {SOURCE_LABELS[skill.source] || skill.source}
                            </span>
                            <Button variant="outline" size="xs" onClick={() => checkSecurity(skill)}>
                              Scan
                            </Button>
                            <Button variant="outline" size="xs" onClick={() => setSelectedSkill(skill)}>
                              View
                            </Button>
                          </div>
                        </div>
                        {skill.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                        )}
                        <p className="mt-1 text-2xs text-muted-foreground/70 break-all">{skill.path}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'registry' && (
        <>
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="flex items-center gap-2">
              <select
                value={registrySource}
                onChange={(e) => { setRegistrySource(e.target.value as 'clawhub' | 'skills-sh' | 'awesome-openclaw'); setRegistryResults([]); setRegistrySearched(false) }}
                className="h-9 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground"
              >
                <option value="clawhub">ClawdHub</option>
                <option value="skills-sh">skills.sh</option>
                <option value="awesome-openclaw">Awesome OpenClaw</option>
              </select>
              <input
                value={registryQuery}
                onChange={(e) => setRegistryQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchRegistry()}
                placeholder="Search skills..."
                className="h-9 flex-1 rounded-md border border-border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <Button variant="default" size="sm" onClick={searchRegistry} disabled={registryLoading || !registryQuery.trim()}>
                {registryLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Install to:</span>
              <select
                value={installTarget}
                onChange={(e) => setInstallTarget(e.target.value)}
                className="h-7 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground"
              >
                <option value="user-agents">{SOURCE_LABELS['user-agents']}</option>
                <option value="user-codex">{SOURCE_LABELS['user-codex']}</option>
                <option value="project-agents">{SOURCE_LABELS['project-agents']}</option>
                <option value="project-codex">{SOURCE_LABELS['project-codex']}</option>
                {dashboardMode === 'full' && (
                  <option value="openclaw">{SOURCE_LABELS['openclaw']}</option>
                )}
              </select>
            </div>
          </div>

          {registryError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {registryError}
            </div>
          )}

          {registryResults.length > 0 ? (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
                {registryResults.length} results from {{ clawhub: 'ClawdHub', 'skills-sh': 'skills.sh', 'awesome-openclaw': 'Awesome OpenClaw' }[registrySource]}
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
                      <Button
                        variant="default"
                        size="xs"
                        onClick={() => installSkill(skill.slug, skill.name)}
                        disabled={installing === skill.slug}
                      >
                        {installing === skill.slug ? 'Installing...' : 'Install'}
                      </Button>
                    </div>
                    {skill.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                    )}
                    {skill.tags && skill.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {skill.tags.slice(0, 5).map((tag) => (
                          <span key={tag} className="text-2xs rounded-full bg-secondary/50 border border-border px-1.5 py-0.5 text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : registryLoading ? (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">Searching...</div>
          ) : registrySearched ? (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              No results found for &quot;{registryQuery}&quot; on {{ clawhub: 'ClawdHub', 'skills-sh': 'skills.sh', 'awesome-openclaw': 'Awesome OpenClaw' }[registrySource]}. Try a different query or switch registries.
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              Search ClawdHub, skills.sh, or Awesome OpenClaw to discover and install agent skills.
            </div>
          )}
        </>
      )}

      {isMounted && installModal && createPortal(
        <div className="fixed inset-0 z-[130]">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
              <div className="px-5 pt-5 pb-4">
                <h3 className="text-sm font-semibold text-foreground">
                  {installModal.step === 'done' ? 'Skill Installed' : installModal.step === 'error' ? 'Install Failed' : 'Installing Skill'}
                </h3>
                <p className="text-xs text-muted-foreground mt-1 truncate">{installModal.name}</p>
              </div>

              <div className="px-5 pb-5 space-y-3">
                {/* Progress steps */}
                <div className="space-y-2">
                  <InstallStep
                    label="Fetching SKILL.md from registry"
                    status={installModal.step === 'fetching' ? 'active' : installModal.step === 'error' && !installModal.securityStatus ? 'error' : 'done'}
                  />
                  <InstallStep
                    label="Running security scan"
                    status={
                      installModal.step === 'fetching' ? 'pending'
                        : installModal.step === 'scanning' ? 'active'
                        : installModal.step === 'error' && installModal.securityStatus === 'rejected' ? 'error'
                        : installModal.step === 'error' && !installModal.securityStatus ? 'error'
                        : 'done'
                    }
                  />
                  <InstallStep
                    label="Writing to disk & registering"
                    status={
                      ['fetching', 'scanning'].includes(installModal.step) ? 'pending'
                        : installModal.step === 'writing' ? 'active'
                        : installModal.step === 'error' ? 'error'
                        : 'done'
                    }
                  />
                </div>

                {/* Result message */}
                {installModal.message && (installModal.step === 'done' || installModal.step === 'error') && (
                  <div className={`rounded-md border px-3 py-2 text-xs ${
                    installModal.step === 'error'
                      ? 'bg-destructive/10 border-destructive/30 text-destructive'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  }`}>
                    {installModal.message}
                  </div>
                )}

                {/* Security badge */}
                {installModal.securityStatus && installModal.step === 'done' && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Security:</span>
                    <span className={
                      installModal.securityStatus === 'clean' ? 'text-emerald-400'
                        : installModal.securityStatus === 'warning' ? 'text-amber-400'
                        : 'text-rose-400'
                    }>{installModal.securityStatus}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              {(installModal.step === 'done' || installModal.step === 'error') && (
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  {installModal.step === 'done' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setInstallModal(null); setActiveTab('installed') }}
                    >
                      View Installed
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setInstallModal(null)}
                  >
                    {installModal.step === 'done' ? 'Done' : 'Close'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {isMounted && selectedSkill && createPortal(
        <div className="fixed inset-0 z-[120]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedSkill(null)} />
          <aside className="absolute right-0 top-0 h-full w-[min(52rem,100vw)] bg-card border-l border-border shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">{selectedSkill.name}</h3>
                <p className="text-2xs text-muted-foreground truncate">
                  {selectedSkill.source} • {selectedSkill.path}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" onClick={deleteSkill} disabled={saving || drawerLoading}>
                  Delete
                </Button>
                <Button variant="outline" size="sm" onClick={saveSkill} disabled={saving || drawerLoading}>
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedSkill(null)}>Close</Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {drawerLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading SKILL.md...</div>
              ) : drawerError ? (
                <div className="p-4 text-sm text-destructive">{drawerError}</div>
              ) : selectedContent ? (
                <>
                  {selectedContent.security && selectedContent.security.issues.length > 0 && (
                    <div className={`mx-4 mt-3 rounded-lg border p-3 text-xs ${
                      selectedContent.security.status === 'rejected'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        : selectedContent.security.status === 'warning'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                          : 'bg-slate-500/10 border-slate-500/30 text-slate-300'
                    }`}>
                      <div className="font-medium mb-1">Security: {selectedContent.security.status}</div>
                      {selectedContent.security.issues.map((issue, i) => (
                        <div key={i} className="flex items-start gap-1.5 mt-1">
                          <span className={`mt-0.5 text-2xs font-mono ${
                            issue.severity === 'critical' ? 'text-rose-400' : issue.severity === 'warning' ? 'text-amber-400' : 'text-slate-400'
                          }`}>[{issue.severity}]</span>
                          <span>{issue.description}{issue.line ? ` (line ${issue.line})` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    className="w-full h-full min-h-[70vh] bg-card p-4 text-xs text-muted-foreground leading-5 font-mono whitespace-pre rounded-none border-0 focus:outline-none"
                  />
                </>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">No content.</div>
              )}
            </div>
          </aside>
        </div>,
        document.body
      )}
    </div>
  )
}

function InstallStep({ label, status }: { label: string; status: 'pending' | 'active' | 'done' | 'error' }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-5 h-5 flex items-center justify-center shrink-0">
        {status === 'pending' && (
          <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
        )}
        {status === 'active' && (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        )}
        {status === 'done' && (
          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        )}
        {status === 'error' && (
          <svg className="w-4 h-4 text-destructive" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" />
          </svg>
        )}
      </div>
      <span className={`text-xs ${
        status === 'active' ? 'text-foreground font-medium'
          : status === 'done' ? 'text-muted-foreground'
          : status === 'error' ? 'text-destructive'
          : 'text-muted-foreground/50'
      }`}>
        {label}
      </span>
    </div>
  )
}
