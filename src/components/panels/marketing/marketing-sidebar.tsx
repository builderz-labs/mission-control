'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Generation, CreateFormState } from './marketing-types'
import { PHASES, DESIGN_AGENTS } from './marketing-constants'
import { IconLayout, IconHistory, IconUsers, IconZap, IconExternalLink, IconDownload, IconChevronRight } from './marketing-icons'

type SidebarTab = 'templates' | 'pipeline' | 'history' | 'specialists'

interface MarketingSidebarProps {
  generations: Generation[]
  onSelectTemplate: (form: Partial<CreateFormState>) => void
}

const TEMPLATES = [
  { label: 'Investor Pitch', slides: 12, theme: 'Corporate', tag: 'Popular' },
  { label: 'Product Launch', slides: 10, theme: 'Modern', tag: 'Trending' },
  { label: 'Annual Report', slides: 16, theme: 'Executive', tag: 'New' },
  { label: 'Sales Deck', slides: 8, theme: 'Bold', tag: '' },
  { label: 'Case Study', slides: 6, theme: 'Clean', tag: '' },
  { label: 'Brand Story', slides: 8, theme: 'Creative', tag: '' },
]

export function MarketingSidebar({ generations, onSelectTemplate }: MarketingSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('pipeline')

  const TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
    { id: 'pipeline', label: 'Pipeline', icon: <IconZap /> },
    { id: 'templates', label: 'Templates', icon: <IconLayout /> },
    { id: 'history', label: 'History', icon: <IconHistory /> },
    { id: 'specialists', label: 'Agents', icon: <IconUsers /> },
  ]

  return (
    <aside className="w-64 shrink-0 border-l border-border flex flex-col bg-surface-1/30">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            title={t.label}
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
              activeTab === t.id
                ? 'text-foreground border-b-2 border-[hsl(var(--void-cyan))]'
                : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'pipeline' && <PipelinePanel />}
        {activeTab === 'templates' && <TemplatesPanel onSelect={onSelectTemplate} />}
        {activeTab === 'history' && <HistoryPanel generations={generations} />}
        {activeTab === 'specialists' && <SpecialistsPanel />}
      </div>
    </aside>
  )
}

/* ── Pipeline ── */
function PipelinePanel() {
  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 pt-1">
        Design Workflow
      </p>
      {PHASES.map((phase, i) => {
        const agents = DESIGN_AGENTS.filter(a => a.phase === phase.id)
        return (
          <div key={phase.id} className="relative">
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-surface-1/50 border border-border/50">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border"
                  style={{
                    background: `color-mix(in srgb, ${phase.color} 15%, transparent)`,
                    borderColor: `color-mix(in srgb, ${phase.color} 30%, transparent)`,
                    color: phase.color,
                  }}
                >
                  {i + 1}
                </div>
                {i < PHASES.length - 1 && (
                  <div className="w-px h-3 bg-border" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-foreground">{phase.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {agents.map(a => a.name).join(', ')}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Templates ── */
function TemplatesPanel({ onSelect }: { onSelect: (form: Partial<CreateFormState>) => void }) {
  return (
    <div className="p-3 space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 pt-1 pb-0.5">
        Starter Templates
      </p>
      {TEMPLATES.map(tpl => (
        <button
          key={tpl.label}
          onClick={() => onSelect({ format: 'presentation', numCards: tpl.slides })}
          className="w-full text-left p-2.5 rounded-lg border border-border bg-surface-1/50 hover:border-[hsl(var(--void-cyan))]/40 hover:bg-surface-1 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">{tpl.label}</span>
            {tpl.tag && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[hsl(var(--void-cyan))]/10 text-[hsl(var(--void-cyan))] border border-[hsl(var(--void-cyan))]/20">
                {tpl.tag}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
            <span>{tpl.slides} slides</span>
            <span>·</span>
            <span>{tpl.theme}</span>
            <IconChevronRight className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </button>
      ))}
    </div>
  )
}

/* ── History ── */
function HistoryPanel({ generations }: { generations: Generation[] }) {
  if (generations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <IconHistory className="text-muted-foreground/30 w-8 h-8 mb-2" />
        <p className="text-xs text-muted-foreground">No generations yet</p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">Your history will appear here</p>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 pt-1 pb-0.5">
        Recent ({generations.length})
      </p>
      {generations.slice(0, 10).map(gen => (
        <div key={gen.id} className="p-2.5 rounded-lg border border-border bg-surface-1/50">
          <div className="flex items-center gap-1.5 mb-1">
            <div className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              gen.status === 'completed' ? 'bg-[hsl(var(--success))]'
                : gen.status === 'generating' ? 'bg-[hsl(var(--void-cyan))] animate-pulse'
                : 'bg-destructive',
            )} />
            <span className="text-[10px] font-mono text-muted-foreground">{gen.format}</span>
          </div>
          <p className="text-[11px] text-foreground leading-snug line-clamp-2">{gen.title}</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            {gen.gammaUrl && (
              <a href={gen.gammaUrl} target="_blank" rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors">
                <IconExternalLink />
              </a>
            )}
            {gen.exportUrl && (
              <a href={gen.exportUrl} target="_blank" rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors">
                <IconDownload />
              </a>
            )}
            <span className="text-[9px] text-muted-foreground ml-auto">
              {new Date(gen.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Specialists ── */
function SpecialistsPanel() {
  return (
    <div className="p-3 space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 pt-1 pb-0.5">
        Design Specialists
      </p>
      {DESIGN_AGENTS.map(agent => {
        const phase = PHASES.find(p => p.id === agent.phase)
        return (
          <div key={agent.id} className="p-2.5 rounded-lg border border-border bg-surface-1/50">
            <div className="flex items-start gap-2">
              <div
                className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-[8px] font-bold mt-0.5"
                style={{
                  background: `color-mix(in srgb, ${agent.color} 15%, transparent)`,
                  color: agent.color,
                }}
              >
                AI
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-foreground">{agent.name}</div>
                <div className="text-[9px] font-mono text-muted-foreground">{agent.trigger}</div>
                {phase && (
                  <div className="text-[9px] mt-0.5" style={{ color: phase.color }}>
                    {phase.label}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
