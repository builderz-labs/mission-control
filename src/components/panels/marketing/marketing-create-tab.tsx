'use client'

import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GammaTheme, CreateFormState } from './marketing-types'
import { QUICK_STARTS, DIMENSION_OPTIONS } from './marketing-constants'
import { IconSparkles, IconLoader } from './marketing-icons'

interface CreateTabProps {
  form: CreateFormState
  onChange: (patch: Partial<CreateFormState>) => void
  onGenerate: () => void
  generating: boolean
  error: string
  onClearError: () => void
  themes: GammaTheme[]
  gammaConnected: boolean
  gammaHasKey: boolean
}

const FORMAT_TABS: { value: CreateFormState['format']; label: string; icon: string }[] = [
  { value: 'presentation', label: 'Presentation', icon: '🖥️' },
  { value: 'document', label: 'Document', icon: '📄' },
  { value: 'social', label: 'Social', icon: '📱' },
  { value: 'webpage', label: 'Web Page', icon: '🌐' },
]

export function MarketingCreateTab({
  form, onChange, onGenerate, generating, error, onClearError, themes, gammaConnected, gammaHasKey,
}: CreateTabProps) {
  const handleQuickStart = useCallback((qs: typeof QUICK_STARTS[0]) => {
    onChange({ format: qs.format, inputText: qs.prompt, numCards: qs.numCards })
  }, [onChange])

  const allowedDimensions = DIMENSION_OPTIONS.filter(d => {
    if (d.value === '4x5' || d.value === '9x16') return form.format === 'social'
    return true
  })

  return (
    <div className="flex flex-col gap-5 max-w-2xl w-full mx-auto">
      {/* Gamma API warning */}
      {!gammaHasKey && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5">
          <span className="text-[hsl(var(--warning))] text-base mt-0.5">⚠️</span>
          <div>
            <p className="text-sm font-medium text-foreground">Gamma API Key Required</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add <code className="px-1 py-0.5 rounded bg-muted text-xs">GAMMA_API_KEY</code> to
              your <code className="px-1 py-0.5 rounded bg-muted text-xs">.env</code> to enable generation.
            </p>
          </div>
        </div>
      )}

      {/* Format selector */}
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          Content Type
        </label>
        <div className="grid grid-cols-4 gap-2">
          {FORMAT_TABS.map(ft => (
            <button
              key={ft.value}
              onClick={() => onChange({ format: ft.value })}
              className={cn(
                'flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-center transition-all',
                form.format === ft.value
                  ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground'
                  : 'border-border bg-surface-1/50 text-muted-foreground hover:text-foreground hover:border-border/80',
              )}
            >
              <span className="text-lg leading-none">{ft.icon}</span>
              <span className="text-xs font-medium">{ft.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick start */}
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          Quick Start
        </label>
        <div className="flex flex-wrap gap-2">
          {QUICK_STARTS.map(qs => (
            <button
              key={qs.label}
              onClick={() => handleQuickStart(qs)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-1/50 text-xs text-muted-foreground hover:text-foreground hover:border-[hsl(var(--void-cyan))]/40 transition-all"
            >
              <span>{qs.icon}</span>
              {qs.label}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt textarea */}
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          Describe What You Want
        </label>
        <textarea
          value={form.inputText}
          onChange={e => onChange({ inputText: e.target.value })}
          rows={5}
          placeholder={
            form.format === 'presentation'
              ? 'e.g., Investor pitch for an AI-powered productivity SaaS. Highlight the problem, our unique solution, $5M ARR traction, and a $2M seed raise ask.'
              : form.format === 'document'
              ? 'e.g., Technical whitepaper on the benefits of zero-trust security for enterprise cloud environments...'
              : form.format === 'social'
              ? 'e.g., Launch announcement series for our new mobile app — focus on the 3 killer features that save users 2 hours/day...'
              : 'e.g., Landing page for a B2B SaaS product with hero, features, social proof, and pricing sections...'
          }
          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30 focus:border-[hsl(var(--void-cyan))]/50 placeholder:text-muted-foreground/50 transition-all"
        />
        <div className="flex justify-between mt-1.5">
          <span className="text-xs text-muted-foreground">{form.inputText.length} chars</span>
          {form.format === 'presentation' && (
            <span className="text-xs text-muted-foreground">Use --- to separate slide sections</span>
          )}
        </div>
      </div>

      {/* Options row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            {form.format === 'presentation' ? 'Slides' : form.format === 'social' ? 'Posts' : 'Sections'}
          </label>
          <input
            type="number"
            min={1}
            max={60}
            value={form.numCards}
            onChange={e => onChange({ numCards: parseInt(e.target.value) || 8 })}
            className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Dimensions
          </label>
          <select
            value={form.dimensions}
            onChange={e => onChange({ dimensions: e.target.value })}
            className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30"
          >
            {allowedDimensions.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Export As
          </label>
          <select
            value={form.exportAs}
            onChange={e => onChange({ exportAs: e.target.value as 'pdf' | 'pptx' })}
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
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Theme
          </label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => onChange({ selectedTheme: '' })}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                !form.selectedTheme
                  ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              Auto
            </button>
            {themes.map(t => (
              <button
                key={t.id}
                onClick={() => onChange({ selectedTheme: t.id })}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  form.selectedTheme === t.id
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

      {/* Style instructions */}
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
          Style Instructions <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
        </label>
        <input
          type="text"
          value={form.instructions}
          onChange={e => onChange({ instructions: e.target.value })}
          placeholder="e.g., Professional tone, dark theme, include data visualizations..."
          className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30 placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm">
          <span className="shrink-0">⚠</span>
          <span className="flex-1">{error}</span>
          <button onClick={onClearError} className="text-destructive/60 hover:text-destructive shrink-0">✕</button>
        </div>
      )}

      {/* Generate button */}
      <Button
        onClick={onGenerate}
        disabled={generating || !form.inputText.trim() || !gammaHasKey}
        size="lg"
        className="w-full h-12 text-sm font-medium gap-2"
      >
        {generating ? (
          <><IconLoader /> Generating…</>
        ) : (
          <><IconSparkles /> Generate {FORMAT_TABS.find(f => f.value === form.format)?.label}</>
        )}
      </Button>
    </div>
  )
}
