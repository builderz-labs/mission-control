'use client'

import { useState, useCallback } from 'react'
import { TerminalView } from './terminal-view'
import { TerminalToolbar } from './terminal-toolbar'

export interface SplitPane {
  id: string
  sessionId: string
  sessionKind: 'claude-code' | 'codex-cli' | 'hermes' | 'gateway'
  sessionName?: string
  isActive?: boolean
}

interface SplitPaneLayoutProps {
  panes: SplitPane[]
  onRemovePane: (paneId: string) => void
  onSwitchToTranscript: (sessionId: string) => void
}

type LayoutMode = '1' | '2h' | '2v' | '4'

function getLayoutMode(count: number): LayoutMode {
  if (count <= 1) return '1'
  if (count === 2) return '2h'
  return '4'
}

const LAYOUT_CLASSES: Record<LayoutMode, string> = {
  '1': 'grid-cols-1 grid-rows-1',
  '2h': 'grid-cols-2 grid-rows-1',
  '2v': 'grid-cols-1 grid-rows-2',
  '4': 'grid-cols-2 grid-rows-2',
}

export function SplitPaneLayout({ panes, onRemovePane, onSwitchToTranscript }: SplitPaneLayoutProps) {
  const [paneModes, setPaneModes] = useState<Record<string, 'readonly' | 'interactive'>>({})
  const [paneViewModes, setPaneViewModes] = useState<Record<string, 'terminal' | 'transcript'>>({})
  const [layout, setLayout] = useState<LayoutMode>(getLayoutMode(panes.length))

  const visiblePanes = panes.slice(0, 4)
  const effectiveLayout = visiblePanes.length === 1 ? '1' : layout

  const handleModeChange = useCallback((paneId: string, mode: 'readonly' | 'interactive') => {
    setPaneModes((prev) => ({ ...prev, [paneId]: mode }))
  }, [])

  const handleViewModeChange = useCallback((paneId: string, viewMode: 'terminal' | 'transcript') => {
    if (viewMode === 'transcript') {
      const pane = visiblePanes.find((p) => p.id === paneId)
      if (pane) onSwitchToTranscript(pane.sessionId)
    }
    setPaneViewModes((prev) => ({ ...prev, [paneId]: viewMode }))
  }, [visiblePanes, onSwitchToTranscript])

  if (visiblePanes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground/50">
        Select a session to open the terminal
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Layout controls (only show when multiple panes) */}
      {visiblePanes.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30 shrink-0">
          <span className="text-[10px] text-muted-foreground/50 mr-1">Layout</span>
          {(['2h', '2v', '4'] as const).filter((l) => {
            if (l === '4') return visiblePanes.length >= 3
            return visiblePanes.length >= 2
          }).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              className={`p-0.5 rounded transition-colors ${
                effectiveLayout === l ? 'bg-secondary text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground'
              }`}
              title={l === '2h' ? 'Side by side' : l === '2v' ? 'Stacked' : 'Grid'}
            >
              {l === '2h' && (
                <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1"><rect x="1" y="2" width="6" height="12" rx="1" /><rect x="9" y="2" width="6" height="12" rx="1" /></svg>
              )}
              {l === '2v' && (
                <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1"><rect x="2" y="1" width="12" height="6" rx="1" /><rect x="2" y="9" width="12" height="6" rx="1" /></svg>
              )}
              {l === '4' && (
                <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Pane grid */}
      <div className={`flex-1 grid gap-px bg-border/30 min-h-0 ${LAYOUT_CLASSES[effectiveLayout]}`}>
        {visiblePanes.map((pane) => {
          const paneMode = paneModes[pane.id] || 'readonly'
          const paneViewMode = paneViewModes[pane.id] || 'terminal'

          return (
            <div key={pane.id} className="flex flex-col min-h-0 bg-background">
              <TerminalToolbar
                sessionId={pane.sessionId}
                sessionKind={pane.sessionKind}
                sessionName={pane.sessionName}
                isActive={pane.isActive}
                mode={paneMode}
                viewMode={paneViewMode}
                onModeChange={(mode) => handleModeChange(pane.id, mode)}
                onViewModeChange={(mode) => handleViewModeChange(pane.id, mode)}
                onDetach={() => onRemovePane(pane.id)}
              />
              <div className="flex-1 min-h-0">
                <TerminalView
                  sessionId={pane.sessionId}
                  sessionKind={pane.sessionKind}
                  mode={paneMode}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
