'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { SystemNowPanel } from '@/components/layout/system-now-panel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useWebSocket } from '@/lib/websocket'
import { useServerEvents } from '@/lib/use-server-events'
import { useMissionControl } from '@/store'

const PanelLoading = () => (
  <div className="p-5">
    <div className="rounded-xl border border-border bg-card/60 px-4 py-6 text-sm text-muted-foreground">
      Loading panel...
    </div>
  </div>
)

const MissionControlBoard = dynamic(
  () => import('@/components/dashboard/mission-control-board').then((mod) => mod.MissionControlBoard),
  { loading: () => <PanelLoading /> }
)
const AgentSpawnPanel = dynamic(
  () => import('@/components/panels/agent-spawn-panel').then((mod) => mod.AgentSpawnPanel),
  { loading: () => <PanelLoading /> }
)
const LogViewerPanel = dynamic(
  () => import('@/components/panels/log-viewer-panel').then((mod) => mod.LogViewerPanel),
  { loading: () => <PanelLoading /> }
)
const CronManagementPanel = dynamic(
  () => import('@/components/panels/cron-management-panel').then((mod) => mod.CronManagementPanel),
  { loading: () => <PanelLoading /> }
)
const MemoryBrowserPanel = dynamic(
  () => import('@/components/panels/memory-browser-panel').then((mod) => mod.MemoryBrowserPanel),
  { loading: () => <PanelLoading /> }
)
const TokenDashboardPanel = dynamic(
  () => import('@/components/panels/token-dashboard-panel').then((mod) => mod.TokenDashboardPanel),
  { loading: () => <PanelLoading /> }
)
const AgentCostPanel = dynamic(
  () => import('@/components/panels/agent-cost-panel').then((mod) => mod.AgentCostPanel),
  { loading: () => <PanelLoading /> }
)
const SessionDetailsPanel = dynamic(
  () => import('@/components/panels/session-details-panel').then((mod) => mod.SessionDetailsPanel),
  { loading: () => <PanelLoading /> }
)
const TaskBoardPanel = dynamic(
  () => import('@/components/panels/task-board-panel').then((mod) => mod.TaskBoardPanel),
  { loading: () => <PanelLoading /> }
)
const ActivityFeedPanel = dynamic(
  () => import('@/components/panels/activity-feed-panel').then((mod) => mod.ActivityFeedPanel),
  { loading: () => <PanelLoading /> }
)
const AgentSquadPanelPhase3 = dynamic(
  () => import('@/components/panels/agent-squad-panel-phase3').then((mod) => mod.AgentSquadPanelPhase3),
  { loading: () => <PanelLoading /> }
)
const AgentCommsPanel = dynamic(
  () => import('@/components/panels/agent-comms-panel').then((mod) => mod.AgentCommsPanel),
  { loading: () => <PanelLoading /> }
)
const StandupPanel = dynamic(
  () => import('@/components/panels/standup-panel').then((mod) => mod.StandupPanel),
  { loading: () => <PanelLoading /> }
)
const OrchestrationBar = dynamic(
  () => import('@/components/panels/orchestration-bar').then((mod) => mod.OrchestrationBar),
  { loading: () => <PanelLoading /> }
)
const NotificationsPanel = dynamic(
  () => import('@/components/panels/notifications-panel').then((mod) => mod.NotificationsPanel),
  { loading: () => <PanelLoading /> }
)
const UserManagementPanel = dynamic(
  () => import('@/components/panels/user-management-panel').then((mod) => mod.UserManagementPanel),
  { loading: () => <PanelLoading /> }
)
const AuditTrailPanel = dynamic(
  () => import('@/components/panels/audit-trail-panel').then((mod) => mod.AuditTrailPanel),
  { loading: () => <PanelLoading /> }
)
const AgentHistoryPanel = dynamic(
  () => import('@/components/panels/agent-history-panel').then((mod) => mod.AgentHistoryPanel),
  { loading: () => <PanelLoading /> }
)
const WebhookPanel = dynamic(
  () => import('@/components/panels/webhook-panel').then((mod) => mod.WebhookPanel),
  { loading: () => <PanelLoading /> }
)
const SettingsPanel = dynamic(
  () => import('@/components/panels/settings-panel').then((mod) => mod.SettingsPanel),
  { loading: () => <PanelLoading /> }
)
const GatewayConfigPanel = dynamic(
  () => import('@/components/panels/gateway-config-panel').then((mod) => mod.GatewayConfigPanel),
  { loading: () => <PanelLoading /> }
)
const IntegrationsPanel = dynamic(
  () => import('@/components/panels/integrations-panel').then((mod) => mod.IntegrationsPanel),
  { loading: () => <PanelLoading /> }
)
const AlertRulesPanel = dynamic(
  () => import('@/components/panels/alert-rules-panel').then((mod) => mod.AlertRulesPanel),
  { loading: () => <PanelLoading /> }
)
const MultiGatewayPanel = dynamic(
  () => import('@/components/panels/multi-gateway-panel').then((mod) => mod.MultiGatewayPanel),
  { loading: () => <PanelLoading /> }
)
const SuperAdminPanel = dynamic(
  () => import('@/components/panels/super-admin-panel').then((mod) => mod.SuperAdminPanel),
  { loading: () => <PanelLoading /> }
)
const GitHubSyncPanel = dynamic(
  () => import('@/components/panels/github-sync-panel').then((mod) => mod.GitHubSyncPanel),
  { loading: () => <PanelLoading /> }
)
const OrchestratorRunPanel = dynamic(
  () => import('@/components/panels/orchestrator-run-panel').then((mod) => mod.OrchestratorRunPanel),
  { loading: () => <PanelLoading /> }
)
const ChatPanel = dynamic(
  () => import('@/components/chat/chat-panel').then((mod) => mod.ChatPanel),
  { loading: () => null }
)

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

    // Auto-connect to gateway only if explicitly configured
    const explicitWsUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || ''
    const gatewayHost = process.env.NEXT_PUBLIC_GATEWAY_HOST || ''
    if (explicitWsUrl || gatewayHost) {
      const wsToken = process.env.NEXT_PUBLIC_GATEWAY_TOKEN || process.env.NEXT_PUBLIC_WS_TOKEN || ''
      const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
      const gatewayProto =
        process.env.NEXT_PUBLIC_GATEWAY_PROTOCOL ||
        (window.location.protocol === 'https:' ? 'wss' : 'ws')
      const wsUrl = explicitWsUrl || `${gatewayProto}://${gatewayHost}:${gatewayPort}`
      connect(wsUrl, wsToken)
    }
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
        <main className="flex-1 overflow-auto pb-16 md:pb-0" role="main">
          <div className="lg:hidden sticky top-0 z-20 flex justify-end px-3 pt-3">
            <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card/95 shadow-[0_18px_40px_rgba(0,0,0,0.24)] backdrop-blur">
              <SystemNowPanel className="border-b-0 bg-transparent" maxLines={2} />
            </div>
          </div>
          <div aria-live="polite">
            <ErrorBoundary key={activeTab}>
              <ContentRouter tab={activeTab} />
            </ErrorBoundary>
          </div>
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
      return <MissionControlBoard />
    case 'tasks':
      return <TaskBoardPanel />
    case 'agents':
      return (
        <>
          <OrchestrationBar />
          <AgentSquadPanelPhase3 />
          <div className="mt-4 mx-4 mb-4 rounded-xl border border-border bg-card overflow-hidden">
            <AgentCommsPanel />
          </div>
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
    case 'agent-costs':
      return <AgentCostPanel />
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
    case 'github':
      return <GitHubSyncPanel />
    case 'super-admin':
      return <SuperAdminPanel />
    case 'orchestrator':
      return <OrchestratorRunPanel />
    default:
      return <MissionControlBoard />
  }
}
