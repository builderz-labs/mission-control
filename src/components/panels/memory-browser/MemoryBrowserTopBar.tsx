'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { formatFileSize } from './utils'
import type { ActiveView, FileFilter } from './use-memory-browser'
import type { HealthReport } from './types'

const VIEW_LABELS: Record<string, string> = {
  files: 'File Tree',
  graph: 'Memory Graph',
  health: 'Health',
  pipeline: 'Pipeline',
  hermes: 'Hermes',
}

const VIEW_TITLES: Record<string, string> = {
  files: 'Browse memory files in a tree view',
  graph: 'Visualize memory as a knowledge graph',
  health: 'Check memory health and diagnostics',
  pipeline: 'Run processing pipelines on memory files',
  hermes: 'Explore Hermes agent memory',
}

interface MemoryBrowserTopBarProps {
  sidebarOpen: boolean
  activeView: ActiveView
  viewTabs: readonly string[]
  healthReport: HealthReport | null
  fileCount: number
  sizeTotal: number
  isHydratingTree: boolean
  onToggleSidebar: () => void
  onChangeView: (view: ActiveView) => void
  onNewFile: () => void
}

export function MemoryBrowserTopBar({
  sidebarOpen,
  activeView,
  viewTabs,
  healthReport,
  fileCount,
  sizeTotal,
  isHydratingTree,
  onToggleSidebar,
  onChangeView,
  onNewFile,
}: MemoryBrowserTopBarProps): React.ReactElement {
  const t = useTranslations('memoryBrowser')

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]">
      <button
        onClick={onToggleSidebar}
        className="p-1.5 rounded hover:bg-[hsl(var(--surface-2))] text-muted-foreground text-xs font-mono"
        title={sidebarOpen ? t('hideSidebar') : t('showSidebar')}
      >|||</button>
      <div className="w-px h-4 bg-border mx-1" />
      {viewTabs.map((view) => (
        <button
          key={view}
          onClick={() => onChangeView(view as ActiveView)}
          title={VIEW_TITLES[view]}
          className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${activeView === view ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >{VIEW_LABELS[view] ?? view}</button>
      ))}
      <div className="flex-1" />
      <HealthScoreBadge healthReport={healthReport} />
      <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">
        {t('fileCountSize', { count: fileCount, size: formatFileSize(sizeTotal) })}
      </span>
      {isHydratingTree && (
        <span className="ml-2 text-[10px] text-muted-foreground/35 font-mono">{t('indexing')}</span>
      )}
      <div className="w-px h-4 bg-border mx-1" />
      <button
        onClick={onNewFile}
        className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
      >{t('newFile')}</button>
    </div>
  )
}

interface HealthScoreBadgeProps {
  healthReport: HealthReport | null
}

function HealthScoreBadge({ healthReport }: HealthScoreBadgeProps): React.ReactElement | null {
  if (!healthReport) return null
  const colorClass =
    healthReport.overall === 'healthy' ? 'text-green-400' :
    healthReport.overall === 'warning' ? 'text-amber-400' :
    'text-red-400'
  return (
    <span className={`text-[10px] font-mono tabular-nums mr-1 ${colorClass}`}>
      {healthReport.overallScore}%
    </span>
  )
}
