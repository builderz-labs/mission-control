'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '@/lib/types/sql'
import { useMissionControl } from '@/store'
import type {
  SkillSummary,
  SkillsResponse,
  SkillContentResponse,
  RegistrySkill,
  PanelTab,
  RegistrySource,
  ScanAllState,
  InstallModalState,
  SkillsPanelState,
  SkillsPanelActions,
} from './types'

export type { SkillsPanelState, SkillsPanelActions }

export function useSkillsPanel(): SkillsPanelState & SkillsPanelActions {
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
    async function run(): Promise<void> {
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

  // Load skill content when a skill is selected
  useEffect(() => {
    if (!selectedSkill) return
    const skill = selectedSkill
    let cancelled = false
    async function run(): Promise<void> {
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

  // Close drawer on Escape key
  useEffect(() => {
    if (!selectedSkill) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSelectedSkill(null) }
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

  const handleSetRegistrySource = (src: RegistrySource): void => {
    setRegistrySource(src)
    setRegistryResults([])
    setRegistrySearched(false)
  }

  return {
    // state
    loading,
    saving,
    error,
    query,
    activeRoot,
    selectedSkill,
    selectedContent,
    draftContent,
    drawerLoading,
    drawerError,
    createSource,
    createName,
    createContent,
    createError,
    isMounted,
    activeTab,
    registrySource,
    registryQuery,
    registryResults,
    registryLoading,
    registryError,
    registrySearched,
    installTarget,
    installing,
    installMessage,
    scanAll,
    installModal,
    filtered,
    // actions
    setQuery,
    setActiveRoot,
    setDraftContent,
    setCreateSource,
    setCreateName,
    setCreateContent,
    setScanAll,
    setActiveTab,
    setRegistrySource: handleSetRegistrySource,
    setRegistryQuery,
    setInstallTarget,
    setInstallModal,
    setSelectedSkill,
    refresh,
    createSkill,
    saveSkill,
    deleteSkill,
    searchRegistry,
    installSkill,
    checkSecurity,
    scanAllSkills,
  }
}
