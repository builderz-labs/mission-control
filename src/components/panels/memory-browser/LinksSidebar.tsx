'use client'

import { useTranslations } from 'next-intl'
import type { FileLinks } from './types'

interface LinksSidebarProps {
  fileLinks: FileLinks
  onNavigate: (path: string) => void
}

export function LinksSidebar({ fileLinks, onNavigate }: LinksSidebarProps) {
  const t = useTranslations('memoryBrowser')
  const links = fileLinks.wikiLinks

  return (
    <div className="w-56 shrink-0 border-l border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0 overflow-y-auto">
      <div className="p-3 border-b border-border/50">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">{t('outgoing', { count: fileLinks.outgoing.length })}</div>
        {fileLinks.outgoing.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-0.5">
            {fileLinks.outgoing.map((path, i) => (
              <button key={i} onClick={() => onNavigate(path)} className="block w-full text-left px-1.5 py-1 rounded text-[11px] font-mono text-primary/70 hover:text-primary hover:bg-[hsl(var(--surface-2))] transition-colors truncate">
                {path.split('/').pop()?.replace(/\.[^.]+$/, '')}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-3 border-b border-border/50">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">{t('backlinks', { count: fileLinks.incoming.length })}</div>
        {fileLinks.incoming.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-0.5">
            {fileLinks.incoming.map((path, i) => (
              <button key={i} onClick={() => onNavigate(path)} className="block w-full text-left px-1.5 py-1 rounded text-[11px] font-mono text-primary/70 hover:text-primary hover:bg-[hsl(var(--surface-2))] transition-colors truncate">
                {path.split('/').pop()?.replace(/\.[^.]+$/, '')}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">{t('wikiLinks', { count: links.length })}</div>
        {links.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-0.5">
            {links.map((link, i) => (
              <div key={i} className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                <span className="text-muted-foreground/30 tabular-nums shrink-0">L{link.line}</span>
                <span className="text-primary/60 truncate">[[{link.target}]]</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
