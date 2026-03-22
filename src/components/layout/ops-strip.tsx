'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useMissionControl, type ConnectionStatus } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { useNavigateToPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { DigitalClock } from '@/components/ui/digital-clock'

/**
 * OpsStrip — the operator's command bar.
 *
 * Left:   Operational metrics (what needs attention, not system state)
 * Center: Bridge | Lab tab switcher (intent-based: "See my squad" vs "Give instructions")
 * Right:  Clock + Chat + Search + Notifications
 *
 * Keyboard shortcuts:
 *   1 = Bridge (see your squad)
 *   2 = Lab (give instructions)
 *   3 = Chat (talk to agents)
 *   Cmd+K or / = Search
 *   Esc = Close overlay
 */
export function OpsStrip() {
  const {
    agents, tasks, connection, sessions, cronJobs,
    activeTab, setActiveTab,
    unreadNotificationCount,
  } = useMissionControl()
  const { isConnected, reconnect } = useWebSocket()
  const navigateToPanel = useNavigateToPanel()

  // Operational metrics — what matters to the operator
  const squadReady = agents.filter(a => a.status === 'idle' || a.status === 'busy').length
  const totalAgents = agents.length
  const needsReview = tasks.filter(t => t.status === 'review' || t.status === 'quality_review').length
  const inFlight = tasks.filter(t => t.status === 'assigned' || t.status === 'in_progress').length

  // Command palette state
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => { setIsMounted(true) }, [])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [])

  // Tab navigation — intent-based
  const currentView = activeTab === 'lab' ? 'lab' : 'bridge'

  const switchView = useCallback((view: 'bridge' | 'lab') => {
    const panel = view === 'bridge' ? 'overview' : 'lab'
    navigateToPanel(panel)
  }, [navigateToPanel])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openSearch()
      }
      if (!isTyping && e.key === '/') {
        e.preventDefault()
        openSearch()
      }
      if (!isTyping && e.key === '1') { e.preventDefault(); switchView('bridge') }
      if (!isTyping && e.key === '2') { e.preventDefault(); switchView('lab') }
      if (!isTyping && e.key === '3') { e.preventDefault(); navigateToPanel('chat') }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openSearch, switchView, navigateToPanel])

  return (
    <header
      role="banner"
      aria-label="Operations strip"
      className="relative z-50 h-12 bg-card border-b border-border px-4 shrink-0"
    >
      <div className="h-full flex items-center">
        {/* Left: Operational Metrics */}
        <div className="flex items-center gap-4 min-w-0">
          <Metric
            label="Squad"
            value={`${squadReady}/${totalAgents}`}
            status={squadReady > 0 ? 'success' : 'muted'}
            title={`${squadReady} agents ready out of ${totalAgents} registered`}
          />
          <Metric
            label="In Flight"
            value={String(inFlight)}
            status={inFlight > 0 ? 'info' : 'muted'}
            title={`${inFlight} tasks currently being worked on`}
          />
          {needsReview > 0 && (
            <button
              onClick={() => switchView('lab')}
              className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity"
              title={`${needsReview} items need your review — click to go to Lab`}
            >
              <span className="text-primary font-semibold font-mono-tight">{needsReview}</span>
              <span className="text-primary text-2xs font-medium">need review</span>
            </button>
          )}
          <GatewayMetric connection={connection} onReconnect={reconnect} />
        </div>

        {/* Center: Intent-Based Tab Switcher */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-1 bg-secondary/60 rounded-full p-0.5">
            <button
              onClick={() => switchView('bridge')}
              className={`desk-tab text-xs px-5 py-1.5 ${currentView === 'bridge' ? 'desk-tab-active' : ''}`}
              title="See your squad and what's happening (1)"
            >
              Bridge
            </button>
            <button
              onClick={() => switchView('lab')}
              className={`desk-tab text-xs px-5 py-1.5 ${currentView === 'lab' ? 'desk-tab-active' : ''}`}
              title="Give instructions and review results (2)"
            >
              Lab
            </button>
          </div>
        </div>

        {/* Right: Clock + Chat + Search + Notifications */}
        <div className="flex items-center gap-3 shrink-0">
          <DigitalClock />
          <Button
            variant="outline"
            size="sm"
            onClick={openSearch}
            className="hidden md:flex h-8 gap-2 bg-secondary/30 hover:bg-secondary/50 text-muted-foreground"
          >
            <SearchIcon />
            <span className="text-xs">Search</span>
            <kbd className="text-2xs px-1 py-0.5 rounded bg-muted border border-border font-mono ml-1">&#8984;K</kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={openSearch}
            className="md:hidden"
            title="Search"
          >
            <SearchIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigateToPanel('chat')}
            className="relative"
            title="Chat with agents (3)"
          >
            <ChatIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigateToPanel('notifications')}
            className="relative"
            title="Notifications"
          >
            <BellIcon />
            {unreadNotificationCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-2xs flex items-center justify-center font-medium">
                {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Command Palette */}
      {searchOpen && isMounted && createPortal(
        <div className="fixed inset-0 z-[9999] isolate" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" onClick={() => setSearchOpen(false)} />
          <div className="absolute inset-0 flex items-start justify-center pt-[12vh]">
            <div className="command-palette-in w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
              <div className="p-3">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search agents, tasks, or jump to..."
                  className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false) }}
                />
              </div>
              {/* Quick navigation hints */}
              <div className="px-3 pb-3 space-y-1.5">
                <p className="text-2xs text-muted-foreground font-semibold uppercase tracking-wider">Quick Jump</p>
                <div className="flex flex-wrap gap-2">
                  <QuickJumpChip label="Bridge" shortcut="1" onClick={() => { setSearchOpen(false); switchView('bridge') }} />
                  <QuickJumpChip label="Lab" shortcut="2" onClick={() => { setSearchOpen(false); switchView('lab') }} />
                  <QuickJumpChip label="Chat" shortcut="3" onClick={() => { setSearchOpen(false); navigateToPanel('chat') }} />
                </div>
                <p className="text-2xs text-muted-foreground mt-2">
                  Press <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-2xs">Esc</kbd> to close
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  )
}

// ─── Sub-components ───

function Metric({
  label,
  value,
  status,
  title,
}: {
  label: string
  value: string
  status?: 'success' | 'warning' | 'info' | 'muted'
  title?: string
}) {
  const color =
    status === 'success' ? 'text-success' :
    status === 'warning' ? 'text-warning' :
    status === 'info' ? 'text-info' :
    'text-muted-foreground'

  return (
    <div className="flex items-center gap-1.5 text-xs" title={title}>
      <span className="text-muted-foreground hidden xl:inline">{label}</span>
      <span className={`font-semibold font-mono-tight ${color}`}>{value}</span>
    </div>
  )
}

function GatewayMetric({ connection, onReconnect }: { connection: ConnectionStatus; onReconnect: () => void }) {
  const isConnected = connection.isConnected
  const isReconnecting = !isConnected && connection.reconnectAttempts > 0

  let dotClass: string
  let textClass: string
  let label: string

  if (isConnected) {
    dotClass = 'bg-success'
    textClass = 'text-success'
    label = connection.latency != null ? `${connection.latency}ms` : 'Live'
  } else if (isReconnecting) {
    dotClass = 'bg-warning animate-pulse'
    textClass = 'text-warning'
    label = `Retry ${connection.reconnectAttempts}`
  } else {
    dotClass = 'bg-destructive animate-pulse'
    textClass = 'text-destructive'
    label = 'Offline'
  }

  return (
    <button
      onClick={!isConnected ? onReconnect : undefined}
      className={`flex items-center gap-1.5 text-xs ${!isConnected ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
      title={isConnected ? 'Gateway connected' : 'Click to reconnect'}
    >
      <span className="text-muted-foreground hidden xl:inline">GW</span>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className={`font-mono-tight font-medium ${textClass}`}>{label}</span>
    </button>
  )
}

function QuickJumpChip({ label, shortcut, onClick }: { label: string; shortcut: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/60 hover:bg-secondary text-xs text-foreground transition-colors"
    >
      <span>{label}</span>
      <kbd className="text-2xs px-1 py-0.5 rounded bg-muted border border-border font-mono">{shortcut}</kbd>
    </button>
  )
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V4a1 1 0 011-1z" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13h4M3.5 10c0-1-1-2-1-4a5.5 5.5 0 0111 0c0 2-1 3-1 4H3.5z" />
    </svg>
  )
}
