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
import { AgentDetailPage } from '@/components/panels/agent-detail-page'
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
import { SuperAdminPanel } from '@/components/panels/super-admin-panel'
import { XFeedPanel } from '@/components/panels/xfeed-panel'
import { GardenPanel } from '@/components/panels/garden-panel'
import { InboxPanel } from '@/components/panels/inbox-panel'
import { ProjectsPanel } from '@/components/panels/projects-panel'
import { ChatPanel } from '@/components/chat/chat-panel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
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
    const explicitWsUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || ''

    // Use /ws proxy on same origin (works for remote access via LAN/Tailscale)
    // Fall back to direct gateway connection if explicit URL is set
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = explicitWsUrl || `${wsProto}://${window.location.host}/ws`
    connect(wsUrl, wsToken)
  }, [connect, setCurrentUser])

  if (!isClient) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden">
            <img src="/eden-icon.png" alt="Eden" className="w-full h-full object-cover" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-sm text-muted-foreground">Loading Eden...</span>
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
  // Handle agent:* routes
  if (tab.startsWith('agent:')) {
    const agentName = tab.substring(6)
    return <AgentDetailPage agentName={agentName} />
  }

  switch (tab) {
    case 'inbox':
      return <InboxPanel />
    case 'overview':
      return <Dashboard />
    case 'tasks':
      return <TaskBoardPanel />
    case 'agents':
      return <AgentCrewOverview />
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
    case 'super-admin':
      return <SuperAdminPanel />
    case 'xfeed':
      return <XFeedPanel />
    case 'garden':
      return <GardenPanel />
    case 'projects':
      return <ProjectsPanel />
    default:
      return <Dashboard />
  }
}

// Simple crew overview with agent cards
function AgentCrewOverview() {
  const { setActiveTab } = useMissionControl()
  const [agents, setAgents] = useState<Array<{
    id: number
    name: string
    role: string
    status: 'offline' | 'idle' | 'busy' | 'error'
    config?: any
    taskStats?: { total: number; assigned: number; in_progress: number; completed: number }
  }>>([])
  const [loading, setLoading] = useState(true)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      if (res.ok) {
        const data = await res.json()
        setAgents(data.agents || [])
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const statusColors = {
    offline: 'bg-zinc-500',
    idle: 'bg-green-500',
    busy: 'bg-yellow-500',
    error: 'bg-red-500',
  }

  return (
    <div className="h-full flex flex-col">
      <OrchestrationBar />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">Crew</h2>
          <p className="text-muted-foreground">Click an agent to view details</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No agents found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setActiveTab(`agent:${agent.name}`)}
                className="p-4 bg-card border border-border rounded-lg hover:bg-surface-1 transition-smooth text-left group"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="shrink-0 relative">
                    <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-xl font-bold text-foreground">
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${statusColors[agent.status]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {agent.name}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate">{agent.role}</p>
                  </div>
                </div>

                {agent.taskStats && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {agent.taskStats.total} tasks
                    </span>
                    {agent.taskStats.in_progress > 0 && (
                      <span className="text-yellow-400">
                        {agent.taskStats.in_progress} active
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
