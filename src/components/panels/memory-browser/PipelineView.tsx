'use client'

import { useTranslations } from 'next-intl'
import { Loader } from '@/components/ui/loader'
import type { ProcessingResult, MOCGroup } from './types'

interface PipelineViewProps {
  result: ProcessingResult | null
  mocGroups: MOCGroup[]
  isRunning: boolean
  onRunAction: (action: string) => void
  onNavigate: (path: string) => void
}

export function PipelineView({ result, mocGroups, isRunning, onRunAction, onNavigate }: PipelineViewProps) {
  const t = useTranslations('memoryBrowser')

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold font-mono text-foreground mb-1">{t('pipelineTitle')}</h2>
        <p className="text-xs text-muted-foreground font-mono">{t('pipelineDesc')}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => onRunAction('reflect')} disabled={isRunning} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 text-left hover:border-primary/30 transition-colors disabled:opacity-50">
          <div className="text-sm font-semibold font-mono text-foreground mb-1">{t('pipelineReflect')}</div>
          <div className="text-[11px] text-muted-foreground font-mono">{t('pipelineReflectDesc')}</div>
        </button>
        <button onClick={() => onRunAction('reweave')} disabled={isRunning} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 text-left hover:border-primary/30 transition-colors disabled:opacity-50">
          <div className="text-sm font-semibold font-mono text-foreground mb-1">{t('pipelineReweave')}</div>
          <div className="text-[11px] text-muted-foreground font-mono">{t('pipelineReweaveDesc')}</div>
        </button>
        <button onClick={() => onRunAction('generate-moc')} disabled={isRunning} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 text-left hover:border-primary/30 transition-colors disabled:opacity-50">
          <div className="text-sm font-semibold font-mono text-foreground mb-1">{t('pipelineGenerateMoc')}</div>
          <div className="text-[11px] text-muted-foreground font-mono">{t('pipelineGenerateMocDesc')}</div>
        </button>
      </div>
      {isRunning && (
        <Loader variant="inline" label={t('processing')} />
      )}
      {result && (
        <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold font-mono text-foreground capitalize">{result.action}</span>
            <span className="text-[10px] font-mono text-muted-foreground/50">{t('filesProcessed', { count: result.filesProcessed })}</span>
          </div>
          {result.suggestions.length === 0 ? (
            <div className="text-[11px] font-mono text-green-400/70">{t('noSuggestions')}</div>
          ) : (
            <div className="space-y-1.5">
              {result.suggestions.map((sug, i) => <div key={i} className="text-[11px] font-mono text-muted-foreground/80 leading-relaxed">{sug}</div>)}
            </div>
          )}
        </div>
      )}
      {mocGroups.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold font-mono text-foreground">{t('mapsOfContent', { count: mocGroups.length })}</div>
          {mocGroups.map((group) => (
            <div key={group.directory} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
              <div className="text-xs font-semibold font-mono text-foreground/80 mb-2">{group.directory}</div>
              <div className="space-y-0.5">
                {group.entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button onClick={() => onNavigate(entry.path)} className="text-[11px] font-mono text-primary/70 hover:text-primary truncate flex-1 text-left">{entry.title}</button>
                    {entry.linkCount > 0 && <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums shrink-0">{entry.linkCount} links</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
