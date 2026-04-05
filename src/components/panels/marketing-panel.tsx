'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useMissionControl } from '@/store'
import type { GammaTheme, Generation, PanelTab, CreateFormState } from './marketing/marketing-types'
import { MarketingCreateTab } from './marketing/marketing-create-tab'
import { MarketingGalleryTab } from './marketing/marketing-gallery-tab'
import { MarketingAgentsTab } from './marketing/marketing-agents-tab'
import { MarketingVideoTab } from './marketing/marketing-video-tab'
import { MarketingSidebar } from './marketing/marketing-sidebar'
import {
  IconMegaphone, IconSparkles, IconGallery, IconUsers, IconFilm,
} from './marketing/marketing-icons'

const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'create', label: 'Create', icon: <IconSparkles /> },
  { id: 'gallery', label: 'Gallery', icon: <IconGallery /> },
  { id: 'agents', label: 'Design Agents', icon: <IconUsers /> },
  { id: 'video', label: 'Video', icon: <IconFilm /> },
]

// Roles permitted to POST to /api/marketing/gamma
const CAN_CREATE_ROLES = new Set(['operator', 'admin'])

const DEFAULT_FORM: CreateFormState = {
  format: 'presentation',
  inputText: '',
  numCards: 8,
  selectedTheme: '',
  dimensions: '16x9',
  instructions: '',
  exportAs: 'pptx',
}

export function MarketingPanel() {
  const { currentUser } = useMissionControl()
  const canCreate = CAN_CREATE_ROLES.has(currentUser?.role ?? '')
  const [tab, setTab] = useState<PanelTab>('create')
  const [gammaStatus, setGammaStatus] = useState<{ connected: boolean; hasKey: boolean } | null>(null)
  const [themes, setThemes] = useState<GammaTheme[]>([])
  const [generations, setGenerations] = useState<Generation[]>([])
  const [form, setForm] = useState<CreateFormState>(DEFAULT_FORM)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  // Check Gamma connectivity on mount
  useEffect(() => {
    fetch('/api/marketing/gamma?action=status')
      .then(r => r.json())
      .then((d: { connected: boolean; hasKey: boolean }) => setGammaStatus(d))
      .catch(() => setGammaStatus({ connected: false, hasKey: false }))
  }, [])

  // Load themes once connected
  useEffect(() => {
    if (!gammaStatus?.connected) return
    fetch('/api/marketing/gamma?action=themes')
      .then(r => r.json())
      .then((d: unknown) => { if (Array.isArray(d)) setThemes(d as GammaTheme[]) })
      .catch(() => {})
  }, [gammaStatus?.connected])

  const patchForm = useCallback((patch: Partial<CreateFormState>) => {
    setForm(prev => ({ ...prev, ...patch }))
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!form.inputText.trim()) { setError('Please enter content for your generation.'); return }
    setError('')
    setGenerating(true)

    const gen: Generation = {
      id: crypto.randomUUID(),
      format: form.format,
      title: form.inputText.slice(0, 60) + (form.inputText.length > 60 ? '…' : ''),
      status: 'generating',
      createdAt: new Date().toISOString(),
      numCards: form.numCards,
      themeId: form.selectedTheme || undefined,
    }
    setGenerations(prev => [gen, ...prev])

    try {
      const res = await fetch('/api/marketing/gamma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: form.format,
          inputText: form.inputText.trim(),
          numCards: form.numCards,
          themeId: form.selectedTheme || undefined,
          dimensions: form.dimensions,
          additionalInstructions: form.instructions || undefined,
          exportAs: form.exportAs,
        }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Generation failed')
      }
      const result = await res.json() as { url?: string; exportUrl?: string }
      setGenerations(prev => prev.map(g =>
        g.id === gen.id
          ? { ...g, status: 'completed', gammaUrl: result.url, exportUrl: result.exportUrl }
          : g
      ))
      setForm(prev => ({ ...prev, inputText: '' }))
      setTab('gallery')
    } catch (err) {
      setGenerations(prev => prev.map(g =>
        g.id === gen.id ? { ...g, status: 'failed' } : g
      ))
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }, [form])

  const completedGenerations = useMemo(() =>
    generations.filter(g => g.status === 'completed'), [generations])

  // Show sidebar only on create + gallery tabs (not agents or video)
  const showSidebar = tab === 'create' || tab === 'gallery'

  return (
    <div className="flex flex-col h-full">
      {/* ─── Header ─── */}
      <div className="flex-shrink-0 border-b border-border px-6 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[hsl(var(--void-amber))]/10 border border-[hsl(var(--void-amber))]/20 flex items-center justify-center">
              <IconMegaphone className="text-[hsl(var(--void-amber))]" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground leading-tight">Marketing Studio</h1>
              <p className="text-xs text-muted-foreground">AI-powered content creation</p>
            </div>
          </div>

          {/* Gamma status badge */}
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
            gammaStatus?.connected
              ? 'text-[hsl(var(--success))] bg-[hsl(var(--success))]/10 border-[hsl(var(--success))]/20'
              : 'text-muted-foreground bg-muted/30 border-border',
          )}>
            <span className={cn(
              'w-1.5 h-1.5 rounded-full',
              gammaStatus?.connected ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground',
            )} />
            {gammaStatus === null ? 'Checking…'
              : gammaStatus.connected ? 'Gamma Connected'
              : gammaStatus.hasKey ? 'Gamma Offline'
              : 'Gamma Not Configured'}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0">
          {TABS.map(t => {
            const isCreateTab = t.id === 'create'
            const disabled = isCreateTab && !canCreate
            return (
              <button
                key={t.id}
                onClick={() => !disabled && setTab(t.id)}
                disabled={disabled}
                title={disabled ? 'Creating campaigns requires Operator access' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  disabled
                    ? 'border-transparent text-muted-foreground/40 cursor-not-allowed'
                    : tab === t.id
                      ? 'border-[hsl(var(--void-cyan))] text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/50',
                )}
              >
                {t.icon}
                {t.label}
                {t.id === 'gallery' && completedGenerations.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-[hsl(var(--void-cyan))]/15 text-[hsl(var(--void-cyan))]">
                    {completedGenerations.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Body: main content + optional sidebar ─── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'create' && (
            canCreate ? (
              <MarketingCreateTab
                form={form}
                onChange={patchForm}
                onGenerate={handleGenerate}
                generating={generating}
                error={error}
                onClearError={() => setError('')}
                themes={themes}
                gammaConnected={gammaStatus?.connected ?? false}
                gammaHasKey={gammaStatus?.hasKey ?? false}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm font-medium text-foreground">Access restricted</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Creating campaigns requires Operator access.
                </p>
              </div>
            )
          )}
          {tab === 'gallery' && (
            <MarketingGalleryTab
              generations={generations}
              onCreateNew={() => setTab('create')}
            />
          )}
          {tab === 'agents' && <MarketingAgentsTab />}
          {tab === 'video' && <MarketingVideoTab />}
        </div>

        {/* Right sidebar — create & gallery tabs only */}
        {showSidebar && (
          <MarketingSidebar
            generations={generations}
            onSelectTemplate={patch => {
              patchForm(patch)
              setTab('create')
            }}
          />
        )}
      </div>
    </div>
  )
}
