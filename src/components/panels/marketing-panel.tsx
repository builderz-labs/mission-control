'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */
interface GammaTheme {
  id: string
  name: string
  previewUrl?: string
}

interface Generation {
  id: string
  format: string
  title: string
  status: 'generating' | 'completed' | 'failed'
  gammaUrl?: string
  exportUrl?: string
  createdAt: string
  numCards: number
  themeId?: string
}

interface DesignAgent {
  id: string
  name: string
  handle: string
  role: string
  trigger: string
  color: string
  outputs: string[]
  phase: 'discovery' | 'strategy' | 'system' | 'application' | 'launch'
}

type PanelTab = 'create' | 'gallery' | 'agents' | 'video'
type FormatType = 'presentation' | 'document' | 'social' | 'webpage'

/* ═══════════════════════════════════════════════════════════════════
   DESIGN AGENTS CONFIG
   ═══════════════════════════════════════════════════════════════════ */
const DESIGN_AGENTS: DesignAgent[] = [
  {
    id: 'trend-synth', name: 'Trend Synthesizer', handle: '@TrendSynth',
    role: 'Researches and synthesizes market trends and competitive intelligence',
    trigger: '/trend-report', color: 'hsl(var(--void-cyan))',
    outputs: ['Trend reports', 'Competitive analysis', 'Opportunity map'],
    phase: 'discovery',
  },
  {
    id: 'brand-identity', name: 'Brand Identity Creator', handle: '@BrandIdentity',
    role: 'Develops comprehensive brand identity systems from scratch',
    trigger: '/brand-create', color: 'hsl(var(--void-violet))',
    outputs: ['Logo concepts', 'Color system', 'Typography guide', 'Brand voice'],
    phase: 'strategy',
  },
  {
    id: 'design-system', name: 'Design System Architect', handle: '@DesignSystem',
    role: 'Creates scalable design systems with tokens and components',
    trigger: '/design-system', color: 'hsl(var(--void-mint))',
    outputs: ['Design tokens', 'Component library', 'Usage guidelines'],
    phase: 'system',
  },
  {
    id: 'marketing-asset', name: 'Marketing Asset Factory', handle: '@MarketingAssets',
    role: 'Creates marketing collateral from brand assets',
    trigger: '/marketing-assets', color: 'hsl(var(--void-amber))',
    outputs: ['Social templates', 'Ad creatives', 'Email templates'],
    phase: 'application',
  },
  {
    id: 'presentation', name: 'Presentation Designer', handle: '@PresentationDesigner',
    role: 'Builds cinematic pitch decks and presentations via Gamma',
    trigger: '/create-deck', color: 'hsl(var(--success))',
    outputs: ['Pitch deck', 'Keynote slides', 'Data visualizations'],
    phase: 'application',
  },
  {
    id: 'critique', name: 'Critique Partner', handle: '@CritiquePartner',
    role: 'Provides expert design critique and improvement suggestions',
    trigger: '/critique', color: 'hsl(var(--warning))',
    outputs: ['Design review', 'Improvement roadmap', 'Priority fixes'],
    phase: 'launch',
  },
  {
    id: 'accessibility', name: 'Accessibility Auditor', handle: '@A11yAuditor',
    role: 'Ensures WCAG compliance and inclusive design',
    trigger: '/a11y-audit', color: 'hsl(var(--info))',
    outputs: ['WCAG report', 'Color contrast fixes', 'Screen reader notes'],
    phase: 'launch',
  },
]

const PHASES = [
  { id: 'discovery', label: 'Discovery', color: 'hsl(var(--void-cyan))' },
  { id: 'strategy', label: 'Strategy', color: 'hsl(var(--void-violet))' },
  { id: 'system', label: 'System', color: 'hsl(var(--void-mint))' },
  { id: 'application', label: 'Application', color: 'hsl(var(--void-amber))' },
  { id: 'launch', label: 'Launch', color: 'hsl(var(--warning))' },
] as const

const FORMAT_OPTIONS: { value: FormatType; label: string; desc: string }[] = [
  { value: 'presentation', label: 'Presentation', desc: 'Slide deck with visuals' },
  { value: 'document', label: 'Document', desc: 'Long-form content' },
  { value: 'social', label: 'Social Post', desc: 'Social media content' },
  { value: 'webpage', label: 'Web Page', desc: 'Landing page layout' },
]

/* ═══════════════════════════════════════════════════════════════════
   INLINE SVG ICONS (no lucide-react dependency)
   ═══════════════════════════════════════════════════════════════════ */
function IconPresentation({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h20" /><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </svg>
  )
}
function IconMegaphone({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 11 18-5v12L3 13v-2z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  )
}
function IconSparkles({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
    </svg>
  )
}
function IconGallery({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  )
}
function IconFilm({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" />
    </svg>
  )
}
function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
function IconExternalLink({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}
function IconDownload({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  )
}
function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
function IconTrending({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  )
}
function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export function MarketingPanel() {
  const [tab, setTab] = useState<PanelTab>('create')
  const [gammaStatus, setGammaStatus] = useState<{ connected: boolean; hasKey: boolean } | null>(null)
  const [themes, setThemes] = useState<GammaTheme[]>([])
  const [generations, setGenerations] = useState<Generation[]>([])

  // Create form state
  const [format, setFormat] = useState<FormatType>('presentation')
  const [inputText, setInputText] = useState('')
  const [numCards, setNumCards] = useState(8)
  const [selectedTheme, setSelectedTheme] = useState('')
  const [dimensions, setDimensions] = useState('16x9')
  const [instructions, setInstructions] = useState('')
  const [exportAs, setExportAs] = useState<'pdf' | 'pptx'>('pptx')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Check Gamma status on mount
  useEffect(() => {
    fetch('/api/marketing/gamma?action=status')
      .then(r => r.json())
      .then(d => setGammaStatus(d))
      .catch(() => setGammaStatus({ connected: false, hasKey: false }))
  }, [])

  // Load themes when connected
  useEffect(() => {
    if (!gammaStatus?.connected) return
    fetch('/api/marketing/gamma?action=themes')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setThemes(d) })
      .catch(() => {})
  }, [gammaStatus?.connected])

  const handleGenerate = useCallback(async () => {
    if (!inputText.trim()) { setError('Please enter content for your generation.'); return }
    setError('')
    setGenerating(true)

    const gen: Generation = {
      id: crypto.randomUUID(),
      format,
      title: inputText.slice(0, 60) + (inputText.length > 60 ? '...' : ''),
      status: 'generating',
      createdAt: new Date().toISOString(),
      numCards,
      themeId: selectedTheme || undefined,
    }
    setGenerations(prev => [gen, ...prev])

    try {
      const res = await fetch('/api/marketing/gamma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          inputText: inputText.trim(),
          numCards,
          themeId: selectedTheme || undefined,
          dimensions,
          additionalInstructions: instructions || undefined,
          exportAs,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }
      const result = await res.json()
      setGenerations(prev => prev.map(g =>
        g.id === gen.id
          ? { ...g, status: 'completed', gammaUrl: result.url, exportUrl: result.exportUrl }
          : g
      ))
      setInputText('')
    } catch (err) {
      setGenerations(prev => prev.map(g =>
        g.id === gen.id ? { ...g, status: 'failed' } : g
      ))
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }, [format, inputText, numCards, selectedTheme, dimensions, instructions, exportAs])

  const completedGenerations = useMemo(() => generations.filter(g => g.status === 'completed'), [generations])

  const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'create', label: 'Create', icon: <IconSparkles /> },
    { id: 'gallery', label: 'Gallery', icon: <IconGallery /> },
    { id: 'agents', label: 'Design Agents', icon: <IconUsers /> },
    { id: 'video', label: 'Video', icon: <IconFilm /> },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* ─── Header ─── */}
      <div className="flex-shrink-0 border-b border-border px-6 pt-6 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2.5">
              <IconMegaphone className="text-[hsl(var(--void-amber))]" />
              Marketing Studio
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create presentations, marketing assets, and design systems powered by Gamma
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
              gammaStatus?.connected
                ? 'text-[hsl(var(--success))] bg-[hsl(var(--success))]/10 border-[hsl(var(--success))]/20'
                : 'text-muted-foreground bg-muted/50 border-border',
            )}>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                gammaStatus?.connected ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground',
              )} />
              {gammaStatus?.connected ? 'Gamma Connected' : gammaStatus?.hasKey ? 'Checking...' : 'Gamma Not Configured'}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-[hsl(var(--void-cyan))] text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ═══ CREATE TAB ═══ */}
        {tab === 'create' && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Gamma not configured warning */}
            {gammaStatus && !gammaStatus.hasKey && (
              <div className="flex items-center gap-3 p-4 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5">
                <IconSparkles className="text-[hsl(var(--warning))] shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Gamma API Key Required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Add <code className="px-1 py-0.5 rounded bg-muted text-xs">GAMMA_API_KEY</code> to your <code className="px-1 py-0.5 rounded bg-muted text-xs">.env</code> file to enable presentation generation.
                  </p>
                </div>
              </div>
            )}

            {/* Format selector */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Format</label>
              <div className="grid grid-cols-4 gap-2">
                {FORMAT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setFormat(opt.value)}
                    className={cn(
                      'p-3 rounded-lg border text-left transition-all',
                      format === opt.value
                        ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/5'
                        : 'border-border hover:border-[hsl(var(--void-cyan))]/30 hover:bg-muted/30',
                    )}
                  >
                    <div className="text-sm font-medium text-foreground">{opt.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Content input */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Content</label>
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="Describe what you want to create. For presentations, outline your slides. For documents, describe the content structure..."
                className="w-full h-40 px-4 py-3 rounded-lg border border-border bg-card text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30 focus:border-[hsl(var(--void-cyan))]/50 placeholder:text-muted-foreground/50 transition-all"
              />
              <div className="flex justify-between mt-1.5">
                <span className="text-xs text-muted-foreground">{inputText.length} characters</span>
                <span className="text-xs text-muted-foreground">Use --- to separate slides</span>
              </div>
            </div>

            {/* Settings row */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Slides</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={numCards}
                  onChange={e => setNumCards(parseInt(e.target.value) || 8)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Dimensions</label>
                <select
                  value={dimensions}
                  onChange={e => setDimensions(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30"
                >
                  <option value="16x9">16:9 (Widescreen)</option>
                  <option value="4x3">4:3 (Standard)</option>
                  <option value="fluid">Fluid</option>
                  {format === 'social' && <option value="4x5">4:5 (Instagram)</option>}
                  {format === 'social' && <option value="9x16">9:16 (Stories)</option>}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Export As</label>
                <select
                  value={exportAs}
                  onChange={e => setExportAs(e.target.value as 'pdf' | 'pptx')}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30"
                >
                  <option value="pptx">PowerPoint (.pptx)</option>
                  <option value="pdf">PDF (.pdf)</option>
                </select>
              </div>
            </div>

            {/* Theme selector */}
            {themes.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Theme</label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setSelectedTheme('')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
                      !selectedTheme
                        ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Auto
                  </button>
                  {themes.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTheme(t.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
                        selectedTheme === t.id
                          ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Additional instructions */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                Style Instructions <span className="text-muted-foreground/50">(optional)</span>
              </label>
              <input
                type="text"
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder="e.g., Professional tone, dark theme, include data visualizations..."
                className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30 placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">
                <span className="shrink-0">!</span>
                <span className="flex-1">{error}</span>
                <button onClick={() => setError('')} className="text-destructive/60 hover:text-destructive">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </div>
            )}

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              disabled={generating || !inputText.trim()}
              size="lg"
              className="w-full h-12 text-sm font-medium"
            >
              {generating ? (
                <>
                  <IconLoader />
                  Generating...
                </>
              ) : (
                <>
                  <IconSparkles />
                  Generate {FORMAT_OPTIONS.find(f => f.value === format)?.label}
                </>
              )}
            </Button>

            {/* Recent generations */}
            {generations.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Recent Generations</h3>
                <div className="space-y-2">
                  {generations.slice(0, 5).map(gen => (
                    <div
                      key={gen.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 hover:bg-card transition-colors"
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-md flex items-center justify-center shrink-0',
                        gen.status === 'completed' ? 'bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]'
                          : gen.status === 'generating' ? 'bg-[hsl(var(--void-cyan))]/10 text-[hsl(var(--void-cyan))]'
                          : 'bg-destructive/10 text-destructive',
                      )}>
                        {gen.status === 'generating' ? <IconLoader /> : gen.status === 'completed' ? <IconCheck /> : '!'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{gen.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {gen.format} &middot; {gen.numCards} slides &middot; {new Date(gen.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                      {gen.gammaUrl && (
                        <a href={gen.gammaUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                          <IconExternalLink />
                        </a>
                      )}
                      {gen.exportUrl && (
                        <a href={gen.exportUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                          <IconDownload />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ GALLERY TAB ═══ */}
        {tab === 'gallery' && (
          <div className="max-w-5xl mx-auto">
            {completedGenerations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                  <IconGallery className="text-muted-foreground w-7 h-7" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-1">No generations yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Create your first presentation, document, or social post using the Create tab.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setTab('create')}>
                  <IconPlus /> Create Something
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {completedGenerations.map(gen => (
                  <div key={gen.id} className="group rounded-xl border border-border bg-card overflow-hidden hover:border-[hsl(var(--void-cyan))]/30 transition-all">
                    {/* Preview area */}
                    <div className="aspect-video bg-muted/30 flex items-center justify-center relative">
                      <IconPresentation className="text-muted-foreground w-10 h-10 opacity-30" />
                      <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent" />
                      <div className="absolute bottom-2 left-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--void-cyan))]/10 text-[hsl(var(--void-cyan))] border border-[hsl(var(--void-cyan))]/20">
                          {gen.format}
                        </span>
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-4">
                      <h4 className="text-sm font-medium text-foreground truncate">{gen.title}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {gen.numCards} slides &middot; {new Date(gen.createdAt).toLocaleDateString()}
                      </p>
                      <div className="flex gap-2 mt-3">
                        {gen.gammaUrl && (
                          <a href={gen.gammaUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="xs">
                              <IconExternalLink /> Open
                            </Button>
                          </a>
                        )}
                        {gen.exportUrl && (
                          <a href={gen.exportUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="xs">
                              <IconDownload /> Download
                            </Button>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ DESIGN AGENTS TAB ═══ */}
        {tab === 'agents' && (
          <div className="max-w-5xl mx-auto space-y-8">
            {/* Phase pipeline */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Design Workflow Pipeline</h3>
              <div className="flex items-center gap-1">
                {PHASES.map((phase, i) => (
                  <div key={phase.id} className="flex items-center gap-1 flex-1">
                    <div className="flex-1 rounded-md p-3 border border-border bg-card/50 text-center">
                      <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: phase.color }}>
                        {phase.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {DESIGN_AGENTS.filter(a => a.phase === phase.id).length} agent{DESIGN_AGENTS.filter(a => a.phase === phase.id).length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    {i < PHASES.length - 1 && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/30 shrink-0">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Agent cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {DESIGN_AGENTS.map(agent => (
                <div
                  key={agent.id}
                  className="group rounded-xl border border-border bg-card p-5 hover:border-[hsl(var(--void-cyan))]/20 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border"
                      style={{
                        background: `color-mix(in srgb, ${agent.color} 10%, transparent)`,
                        borderColor: `color-mix(in srgb, ${agent.color} 20%, transparent)`,
                        color: agent.color,
                      }}
                    >
                      <IconSparkles />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-foreground">{agent.name}</h4>
                        <span className="text-[10px] font-mono text-muted-foreground">{agent.handle}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{agent.role}</p>
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {agent.outputs.map(out => (
                          <span
                            key={out}
                            className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted/50 text-muted-foreground border border-border"
                          >
                            {out}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{agent.trigger}</code>
                        <span
                          className="text-[10px] font-medium uppercase tracking-wider"
                          style={{ color: PHASES.find(p => p.id === agent.phase)?.color }}
                        >
                          {agent.phase}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ VIDEO TAB ═══ */}
        {tab === 'video' && (
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                <IconFilm className="text-muted-foreground w-7 h-7" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-1">Video Generation</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Generate marketing videos with AI-powered Remotion rendering. Configure your video pipeline in Settings.
              </p>
              <div className="grid grid-cols-3 gap-4 mt-8 max-w-lg w-full">
                {[
                  { label: 'Explainer', desc: 'Product walkthroughs' },
                  { label: 'Presentation', desc: 'Keynote-style videos' },
                  { label: 'Social', desc: 'Short-form content' },
                ].map(style => (
                  <div key={style.label} className="p-4 rounded-lg border border-border bg-card/50 text-center">
                    <div className="text-sm font-medium text-foreground">{style.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{style.desc}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-6">
                Coming soon — requires Remotion and FFmpeg setup
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
