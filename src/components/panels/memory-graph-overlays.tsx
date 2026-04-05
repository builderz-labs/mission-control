'use client'

import { useTranslations } from 'next-intl'
import { type AgentGraphData, type AgentFileInfo, formatBytes } from './memory-graph-types'

/* ── Breadcrumb nav (top-left) ── */

interface BreadcrumbNavProps {
  selectedAgent: string
  activeAgent: AgentGraphData | null
  onGoBack: () => void
}

export function BreadcrumbNav({ selectedAgent, activeAgent, onGoBack }: BreadcrumbNavProps): React.JSX.Element {
  const t = useTranslations('memoryGraph')
  return (
    <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
      <button
        onClick={onGoBack}
        className={`px-2.5 py-1 text-[11px] font-mono rounded-md backdrop-blur-xl transition-all ${
          selectedAgent === 'all'
            ? 'bg-[#cba6f7]/15 text-[#cba6f7] border border-[#cba6f7]/25'
            : 'bg-[#1e1e2e]/80 text-[#6c7086] border border-[#45475a]/50 hover:text-[#cdd6f4] hover:border-[#cba6f7]/30'
        }`}
      >
        {t('allAgents')}
      </button>
      {activeAgent && (
        <>
          <span className="text-[#45475a] text-[10px]">/</span>
          <span className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-[#cba6f7]/15 text-[#cba6f7] border border-[#cba6f7]/25">
            {activeAgent.name}
          </span>
        </>
      )}
    </div>
  )
}

/* ── Stats bar (top-right) ── */

interface StatsBarProps {
  selectedAgent: string
  searchQuery: string
  stats: { totalAgents: number; totalFiles: number; totalChunks: number; totalSize: number }
  onSearchChange: (q: string) => void
}

export function StatsBar({ selectedAgent, searchQuery, stats, onSearchChange }: StatsBarProps): React.JSX.Element {
  const t = useTranslations('memoryGraph')

  return (
    <div className="absolute top-3 right-3 flex items-center gap-3 z-10">
      {selectedAgent !== 'all' && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('filterFiles')}
          className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-[#1e1e2e]/80 backdrop-blur-xl border border-[#45475a]/50 text-[#cdd6f4] placeholder-[#45475a] focus:outline-none focus:border-[#cba6f7]/40 w-36 transition-colors"
        />
      )}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#1e1e2e]/80 backdrop-blur-xl border border-[#45475a]/30">
        <StatChip label={t('statAgents')} value={stats.totalAgents} />
        <Sep />
        <StatChip label={t('statFiles')} value={stats.totalFiles} />
        <Sep />
        <StatChip label={t('statChunks')} value={stats.totalChunks} />
        <Sep />
        <StatChip label={t('statSize')} value={formatBytes(stats.totalSize)} />
      </div>
    </div>
  )
}

/* ── Hover tooltip (bottom-center) ── */

interface HoverTooltipProps {
  node: { label: string; sub?: string } | null
}

export function HoverTooltip({ node }: HoverTooltipProps): React.JSX.Element | null {
  if (!node) return null
  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
      <div className="px-3 py-2 rounded-lg bg-[#1e1e2e]/90 backdrop-blur-xl border border-[#45475a]/40 shadow-2xl shadow-black/40 max-w-md">
        <div className="text-[11px] font-mono text-[#cdd6f4] truncate">{node.label}</div>
        {node.sub && (
          <div className="text-[10px] font-mono text-[#6c7086] mt-0.5">{node.sub}</div>
        )}
      </div>
    </div>
  )
}

/* ── Selected file panel (bottom-left) ── */

interface SelectedFilePanelProps {
  file: AgentFileInfo | null
  onClose: () => void
}

export function SelectedFilePanel({ file, onClose }: SelectedFilePanelProps): React.JSX.Element | null {
  const t = useTranslations('memoryGraph')
  if (!file) return null
  return (
    <div className="absolute bottom-3 left-3 z-10 max-w-sm">
      <div className="px-4 py-3 rounded-lg bg-[#1e1e2e]/90 backdrop-blur-xl border border-[#45475a]/40 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h3 className="text-[11px] font-mono text-[#cdd6f4] truncate">{file.path}</h3>
          <button
            onClick={onClose}
            className="text-[#6c7086] hover:text-[#cdd6f4] text-xs transition-colors shrink-0"
          >
            x
          </button>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono text-[#6c7086]">
          <span><span className="text-[#cba6f7]">{file.chunks}</span> {t('chunks')}</span>
          <span><span className="text-[#89b4fa]">{formatBytes(file.textSize)}</span> {t('text')}</span>
        </div>
      </div>
    </div>
  )
}

/* ── Color legend (bottom-right) ── */

export function ColorLegend(): React.JSX.Element {
  const t = useTranslations('memoryGraph')
  return (
    <div className="absolute bottom-3 right-3 z-10">
      <div className="px-3 py-2 rounded-lg bg-[#1e1e2e]/80 backdrop-blur-xl border border-[#45475a]/30">
        <div className="flex items-center gap-3 text-[9px] font-mono text-[#585b70]">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#89dceb]" />{t('legendSessions')}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#94e2d5]" />{t('legendMemory')}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#b4befe]" />{t('legendKnowledge')}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#f9e2af]" />.md</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#cba6f7]" />.json</span>
        </div>
      </div>
    </div>
  )
}

/* ── Shared mini components ── */

function StatChip({ label, value }: { label: string; value: number | string }): React.JSX.Element {
  const display = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <span className="text-[10px] font-mono">
      <span className="text-[#cdd6f4]">{display}</span>
      <span className="text-[#585b70] ml-1">{label}</span>
    </span>
  )
}

function Sep(): React.JSX.Element {
  return <span className="text-[#313244]">|</span>
}
