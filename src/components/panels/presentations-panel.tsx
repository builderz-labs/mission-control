'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

interface Slide {
  title: string
  bullets: string[]
  notes: string
}

interface PresentationConfig {
  title: string
  subtitle: string
  author: string
  theme: 'dark' | 'light' | 'corporate' | 'modern'
  slides: Slide[]
}

const THEMES = [
  { id: 'dark' as const, label: 'Dark', bg: '#1a1a2e', text: '#e0e0e0', accent: '#16213e' },
  { id: 'corporate' as const, label: 'Corporate', bg: '#003366', text: '#ffffff', accent: '#0055aa' },
  { id: 'modern' as const, label: 'Modern', bg: '#2d2d2d', text: '#f5f5f5', accent: '#e63946' },
  { id: 'light' as const, label: 'Light', bg: '#ffffff', text: '#1a1a1a', accent: '#3b82f6' },
]

const SLIDE_TEMPLATES = [
  { label: 'Executive Summary', slides: 5 },
  { label: 'Project Proposal', slides: 8 },
  { label: 'Quarterly Review', slides: 7 },
  { label: 'Strategy Overview', slides: 6 },
  { label: 'Technical Deep-dive', slides: 10 },
]

function buildDefaultSlides(topic: string, count: number): Slide[] {
  const slides: Slide[] = [
    { title: topic, bullets: ['Prepared by Tony W. — Mantu Group', new Date().toLocaleDateString()], notes: 'Title slide' },
    { title: 'Agenda', bullets: Array.from({ length: Math.min(count - 2, 5) }, (_, i) => `Section ${i + 1}`), notes: '' },
    ...Array.from({ length: Math.max(count - 3, 1) }, (_, i) => ({
      title: `Section ${i + 1}`,
      bullets: ['Key point 1', 'Key point 2', 'Key point 3'],
      notes: '',
    })),
    { title: 'Thank You', bullets: ['Questions & Discussion', 'tony.walteur@mantu.com'], notes: 'Closing slide' },
  ]
  return slides.slice(0, count)
}

/** Generates and downloads a .pptx file using pptxgenjs (dynamic import — browser only). */
async function generatePptx(config: PresentationConfig): Promise<void> {
  // Dynamic import keeps pptxgenjs out of the SSR bundle
  const PptxGenJS = (await import('pptxgenjs')).default
  const theme = THEMES.find(t => t.id === config.theme) ?? THEMES[0]

  const prs = new PptxGenJS()
  prs.author = config.author || 'Tony W.'
  prs.title = config.title
  prs.subject = config.subtitle

  // Title slide
  const titleSlide = prs.addSlide()
  titleSlide.background = { color: theme.bg.replace('#', '') }
  titleSlide.addText(config.title, {
    x: '5%', y: '35%', w: '90%', h: '20%',
    fontSize: 36, bold: true, color: theme.text.replace('#', ''),
    align: 'center',
  })
  if (config.subtitle) {
    titleSlide.addText(config.subtitle, {
      x: '5%', y: '58%', w: '90%', h: '10%',
      fontSize: 20, color: theme.text.replace('#', ''),
      align: 'center',
    })
  }
  titleSlide.addText(config.author || 'Tony W. — Mantu Group', {
    x: '5%', y: '75%', w: '90%', h: '8%',
    fontSize: 14, color: theme.text.replace('#', ''),
    align: 'center',
  })

  // Content slides (skip index 0 — title handled above)
  for (let i = 1; i < config.slides.length; i++) {
    const slide = config.slides[i]
    const s = prs.addSlide()
    s.background = { color: theme.bg.replace('#', '') }

    // Header accent bar
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 0.12,
      fill: { color: theme.accent.replace('#', '') },
    })

    // Slide title
    s.addText(slide.title, {
      x: '4%', y: '8%', w: '92%', h: '12%',
      fontSize: 24, bold: true, color: theme.text.replace('#', ''),
    })

    // Bullet points
    if (slide.bullets.length > 0) {
      const bulletItems = slide.bullets
        .filter(b => b.trim())
        .map(text => ({
          text,
          options: { bullet: true, fontSize: 16, color: theme.text.replace('#', ''), paraSpaceAfter: 6 },
        }))
      if (bulletItems.length > 0) {
        s.addText(bulletItems, { x: '6%', y: '25%', w: '88%', h: '65%' })
      }
    }

    // Speaker notes
    if (slide.notes) {
      s.addNotes(slide.notes)
    }
  }

  await prs.writeFile({ fileName: `${config.title.replace(/\s+/g, '_')}.pptx` })
}

function SlideEditor({
  slide, index, total, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  slide: Slide
  index: number
  total: number
  onChange: (updated: Slide) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground w-8">#{index + 1}</span>
        <input
          type="text"
          value={slide.title}
          onChange={e => onChange({ ...slide, title: e.target.value })}
          placeholder="Slide title"
          className="flex-1 px-2 py-1.5 text-sm bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
        />
        <div className="flex gap-1">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
            className="px-1.5 py-1 text-xs rounded hover:bg-secondary disabled:opacity-30 transition-colors"
          >↑</button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
            className="px-1.5 py-1 text-xs rounded hover:bg-secondary disabled:opacity-30 transition-colors"
          >↓</button>
          <button
            onClick={onRemove}
            title="Remove slide"
            className="px-1.5 py-1 text-xs rounded hover:bg-destructive/20 text-destructive/70 hover:text-destructive transition-colors"
          >✕</button>
        </div>
      </div>
      <textarea
        value={slide.bullets.join('\n')}
        onChange={e => onChange({ ...slide, bullets: e.target.value.split('\n') })}
        placeholder="Bullet points (one per line)"
        rows={4}
        className="w-full px-2 py-1.5 text-sm bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground resize-none"
      />
      <input
        type="text"
        value={slide.notes}
        onChange={e => onChange({ ...slide, notes: e.target.value })}
        placeholder="Speaker notes (optional)"
        className="w-full px-2 py-1.5 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/50 text-muted-foreground"
      />
    </div>
  )
}

export function PresentationsPanel() {
  const [config, setConfig] = useState<PresentationConfig>({
    title: 'Mantu Group — Q1 Strategy',
    subtitle: 'AI-Powered Operations Review',
    author: 'Tony W. — Mantu Group',
    theme: 'dark',
    slides: buildDefaultSlides('Mantu Group — Q1 Strategy', 6),
  })
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clear pending timer on unmount to prevent setState on unmounted component
  useEffect(() => () => { if (successTimerRef.current) clearTimeout(successTimerRef.current) }, [])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    setSuccess(false)
    try {
      await generatePptx(config)
      setSuccess(true)
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate presentation')
    } finally {
      setGenerating(false)
    }
  }, [config])

  const addSlide = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      slides: [...prev.slides, { title: `Slide ${prev.slides.length + 1}`, bullets: ['Point 1', 'Point 2'], notes: '' }],
    }))
  }, [])

  const updateSlide = useCallback((index: number, updated: Slide) => {
    setConfig(prev => ({
      ...prev,
      slides: prev.slides.map((s, i) => i === index ? updated : s),
    }))
  }, [])

  const removeSlide = useCallback((index: number) => {
    setConfig(prev => ({ ...prev, slides: prev.slides.filter((_, i) => i !== index) }))
  }, [])

  const moveSlide = useCallback((from: number, to: number) => {
    setConfig(prev => {
      const next = [...prev.slides]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...prev, slides: next }
    })
  }, [])

  const applyTemplate = useCallback((slideCount: number, label: string) => {
    setConfig(prev => ({
      ...prev,
      title: label,
      slides: buildDefaultSlides(label, slideCount),
    }))
  }, [])

  return (
    <div className="flex flex-col h-full p-4 gap-4 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">AI Presentations</h2>
          <p className="text-xs text-muted-foreground">Build and export PowerPoint presentations (.pptx)</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            onClick={handleGenerate}
            disabled={generating || config.slides.length === 0}
            size="sm"
            className="gap-1.5"
          >
            {generating ? (
              <>
                <span className="animate-spin text-sm">⟳</span> Generating…
              </>
            ) : (
              <>⬇ Download .pptx</>
            )}
          </Button>
        </div>
      </div>

      {/* Status */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-400">
          ✓ Presentation downloaded successfully
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Config */}
        <div className="lg:col-span-1 space-y-4">
          {/* Presentation metadata */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Presentation Settings</h3>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Title</label>
              <input
                type="text"
                value={config.title}
                onChange={e => setConfig(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Subtitle</label>
              <input
                type="text"
                value={config.subtitle}
                onChange={e => setConfig(prev => ({ ...prev, subtitle: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Author</label>
              <input
                type="text"
                value={config.author}
                onChange={e => setConfig(prev => ({ ...prev, author: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Theme</label>
              <div className="grid grid-cols-2 gap-1.5">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setConfig(prev => ({ ...prev, theme: t.id }))}
                    style={{ backgroundColor: t.bg, color: t.text, borderColor: config.theme === t.id ? t.accent : 'transparent' }}
                    className="px-2 py-1.5 text-xs rounded border-2 transition-all"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quick templates */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Quick Templates</h3>
            <div className="space-y-1.5">
              {SLIDE_TEMPLATES.map(t => (
                <button
                  key={t.label}
                  onClick={() => applyTemplate(t.slides, t.label)}
                  className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-secondary transition-colors flex items-center justify-between"
                >
                  <span>{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.slides} slides</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-foreground">{config.slides.length}</p>
                <p className="text-xs text-muted-foreground">Slides</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {config.slides.reduce((sum, s) => sum + s.bullets.filter(b => b.trim()).length, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Bullet points</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Slide editor */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Slides</h3>
            <Button variant="outline" size="sm" onClick={addSlide}>+ Add Slide</Button>
          </div>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {config.slides.map((slide, i) => (
              <SlideEditor
                key={i}
                slide={slide}
                index={i}
                total={config.slides.length}
                onChange={updated => updateSlide(i, updated)}
                onRemove={() => removeSlide(i)}
                onMoveUp={() => moveSlide(i, i - 1)}
                onMoveDown={() => moveSlide(i, i + 1)}
              />
            ))}
          </div>
          {config.slides.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3 border border-dashed border-border rounded-xl">
              <p className="text-sm text-muted-foreground">No slides yet</p>
              <Button variant="outline" size="sm" onClick={addSlide}>Add your first slide</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
