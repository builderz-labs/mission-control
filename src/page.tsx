'use client'

import { useEffect, useState } from 'react'
import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { Dashboard } from '@/components/dashboard/dashboard'
import { AgentSpawnPanel } from '@/components/panels/agent-spawn-panel'
import { LogViewerPanel } from '@/components/panels/log-viewer-panel'
import { CronManagementPanel } from '@/components/panels/cron-management-panel'
import { MemoryBrowserPanel } from '@/components/panels/memory-browser-panel'
import { TokenDashboardPanel } from '@/components/panels/token-dashboard-panel'
import { SessionDetailsPanel } from '@/components/panels/session-details-panel'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'
import { ActivityFeedPanel } from '@/components/panels/activity-feed-panel'
import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'
import { StandupPanel } from '@/components/panels/standup-panel'
import { OrchestrationBar } from '@/components/panels/orchestration-bar'
import { NotificationsPanel } from '@/components/panels/notifications-panel'
import { UserManagementPanel } from '@/components/panels/user-management-panel'
import { AuditTrailPanel } from '@/components/panels/audit-trail-panel'
import { AgentHistoryPanel } from '@/components/panels/agent-history-panel'
import { WebhookPanel } from '@/components/panels/webhook-panel'
import { SettingsPanel } from '@/components/panels/settings-panel'
import { GatewayConfigPanel } from '@/components/panels/gateway-config-panel'
import { IntegrationsPanel } from '@/components/panels/integrations-panel'
import { AlertRulesPanel } from '@/components/panels/alert-rules-panel'
import { MultiGatewayPanel } from '@/components/panels/multi-gateway-panel'
import { ChatPanel } from '@/components/chat/chat-panel'
import { useWebSocket } from '@/lib/websocket'
import { useServerEvents } from '@/lib/use-server-events'
import { useMissionControl } from '@/store'

export default function Home() {
  const { connect } = useWebSocket()
  const { activeTab, setCurrentUser, liveFeedOpen, toggleLiveFeed } = useMissionControl()

  // Connect to SSE for real-time local DB events (tasks, agents, chat, etc.)
  useServerEvents()
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)

    // Fetch current user
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.user) setCurrentUser(data.user) })
      .catch(() => {})

    // Auto-connect to gateway on mount
    const wsToken = process.env.NEXT_PUBLIC_GATEWAY_TOKEN || process.env.NEXT_PUBLIC_WS_TOKEN || ''
    const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
    const gatewayHost = window.location.hostname
    const wsUrl = `ws://${gatewayHost}:${gatewayPort}`
    connect(wsUrl, wsToken)
  }, [connect, setCurrentUser])

  if (!isClient) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">MC</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-sm text-muted-foreground">Loading Mission Control...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left: Icon rail navigation (hidden on mobile, shown as bottom bar instead) */}
      <NavRail />

      {/* Center: Header + Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <HeaderBar />
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          <ContentRouter tab={activeTab} />
        </main>
      </div>

      {/* Right: Live feed (hidden on mobile) */}
      {liveFeedOpen && (
        <div className="hidden lg:flex h-full">
          <LiveFeed />
        </div>
      )}

      {/* Floating button to reopen LiveFeed when closed */}
      {!liveFeedOpen && (
        <button
          onClick={toggleLiveFeed}
          className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 w-6 h-12 items-center justify-center bg-card border border-r-0 border-border rounded-l-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
          title="Show live feed"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Chat panel overlay */}
      <ChatPanel />
    </div>
  )
}

function ContentRouter({ tab }: { tab: string }) {
  switch (tab) {
    case 'overview':
      return <Dashboard />
    case 'tasks':
      return <TaskBoardPanel />
    case 'agents':
      return (
        <>
          <OrchestrationBar />
          <AgentSquadPanelPhase3 />
        </>
      )
    case 'activity':
      return <ActivityFeedPanel />
    case 'notifications':
      return <NotificationsPanel />
    case 'standup':
      return <StandupPanel />
    case 'spawn':
      return <AgentSpawnPanel />
    case 'sessions':
      return <SessionDetailsPanel />
    case 'logs':
      return <LogViewerPanel />
    case 'cron':
      return <CronManagementPanel />
    case 'memory':
      return <MemoryBrowserPanel />
    case 'tokens':
      return <TokenDashboardPanel />
    case 'users':
      return <UserManagementPanel />
    case 'history':
      return <AgentHistoryPanel />
    case 'audit':
      return <AuditTrailPanel />
    case 'webhooks':
      return <WebhookPanel />
    case 'alerts':
      return <AlertRulesPanel />
    case 'gateways':
      return <MultiGatewayPanel />
    case 'gateway-config':
      return <GatewayConfigPanel />
    case 'integrations':
      return <IntegrationsPanel />
    case 'settings':
      return <SettingsPanel />
    default:
      return <Dashboard />
  }
}
