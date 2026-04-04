'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Generation } from './marketing-types'
import { FORMAT_LABELS } from './marketing-constants'
import { IconGallery, IconPlus, IconExternalLink, IconDownload, IconLoader, IconCheck } from './marketing-icons'

interface GalleryTabProps {
  generations: Generation[]
  onCreateNew: () => void
}

export function MarketingGalleryTab({ generations, onCreateNew }: GalleryTabProps) {
  const completed = generations.filter(g => g.status === 'completed')
  const all = generations

  if (all.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
          <IconGallery className="text-muted-foreground w-7 h-7" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-1">No generations yet</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          Create your first presentation, document, or social post using the Create tab.
        </p>
        <Button variant="outline" size="sm" className="mt-5 gap-1.5" onClick={onCreateNew}>
          <IconPlus /> Create Something
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Summary strip */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {completed.length} completed · {all.length - completed.length} in progress
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onCreateNew}>
          <IconPlus /> New
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {all.map(gen => (
          <GenerationCard key={gen.id} gen={gen} />
        ))}
      </div>
    </div>
  )
}

function GenerationCard({ gen }: { gen: Generation }) {
  return (
    <div className={cn(
      'group rounded-xl border bg-card overflow-hidden transition-all',
      gen.status === 'completed'
        ? 'border-border hover:border-[hsl(var(--void-cyan))]/30'
        : gen.status === 'generating'
        ? 'border-[hsl(var(--void-cyan))]/20 animate-pulse'
        : 'border-destructive/20',
    )}>
      {/* Preview area */}
      <div className="aspect-video bg-muted/20 flex items-center justify-center relative">
        <div className="text-3xl opacity-20">
          {gen.format === 'presentation' ? '🖥️'
            : gen.format === 'document' ? '📄'
            : gen.format === 'social' ? '📱' : '🌐'}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-card/90 to-transparent" />
        {/* Status badge */}
        <div className="absolute top-2 right-2">
          <span className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border',
            gen.status === 'completed'
              ? 'bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20'
              : gen.status === 'generating'
              ? 'bg-[hsl(var(--void-cyan))]/10 text-[hsl(var(--void-cyan))] border-[hsl(var(--void-cyan))]/20'
              : 'bg-destructive/10 text-destructive border-destructive/20',
          )}>
            {gen.status === 'generating' ? <IconLoader className="w-2.5 h-2.5" /> : gen.status === 'completed' ? <IconCheck className="w-2.5 h-2.5" /> : '✕'}
            {gen.status}
          </span>
        </div>
        {/* Format badge */}
        <div className="absolute bottom-2 left-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--void-cyan))]/10 text-[hsl(var(--void-cyan))] border border-[hsl(var(--void-cyan))]/20">
            {FORMAT_LABELS[gen.format] ?? gen.format}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <h4 className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{gen.title}</h4>
        <p className="text-xs text-muted-foreground mt-1">
          {gen.numCards} slides · {new Date(gen.createdAt).toLocaleDateString()}
        </p>
        <div className="flex gap-2 mt-3">
          {gen.gammaUrl && (
            <a href={gen.gammaUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="xs" className="gap-1">
                <IconExternalLink /> Open
              </Button>
            </a>
          )}
          {gen.exportUrl && (
            <a href={gen.exportUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="xs" className="gap-1">
                <IconDownload /> Download
              </Button>
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
