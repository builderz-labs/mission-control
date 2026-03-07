'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { Dashboard } from '@/components/dashboard/dashboard'
import { LogViewerPanel } from '@/components/panels/log-viewer-panel'
import { CronManagementPanel } from '@/components/panels/cron-management-panel'
import { MemoryBrowserPanel } from '@/components/panels/memory-browser-panel'
import { TokenDashboardPanel } from '@/components/panels/token-dashboard-panel'
import { AgentCostPanel } from '@/components/panels/agent-cost-panel'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'
import { ActivityFeedPanel } from '@/components/panels/activity-feed-panel'
import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'
import { AgentCommsPanel } from '@/components/panels/agent-comms-panel'
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
import { OfficePanel } from '@/components/panels/office-panel'
import { GitHubSyncPanel } from '@/components/panels/github-sync-panel'
import { SkillsPanel } from '@/components/panels/skills-panel'
import { LocalAgentsDocPanel } from '@/components/panels/local-agents-doc-panel'
import { ChatPagePanel } from '@/components/panels/chat-page-panel'
import { ChatPanel } from '@/components/chat/chat-panel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LocalModeBanner } from '@/components/layout/local-mode-banner'
import { UpdateBanner } from '@/components/layout/update-banner'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { ProjectManagerModal } from '@/components/modals/project-manager-modal'
import { useWebSocket } from '@/lib/websocket'
import { useServerEvents } from '@/lib/use-server-events'
import { completeNavigationTiming } from '@/lib/navigation-metrics'
import { useMissionControl } from '@/store'

interface GatewaySummary {
  id: number
  is_primary: number
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export default function Home() {
  const router = useRouter()
  const { connect } = useWebSocket()
  const { activeTab, setActiveTab, setCurrentUser, setDashboardMode, setGatewayAvailable, setCapabilitiesChecked, setSubscription, setDefaultOrgName, setUpdateAvailable, setShowOnboarding, liveFeedOpen, toggleLiveFeed, showProjectManagerModal, setShowProjectManagerModal, fetchProjects, setChatPanelOpen } = useMissionControl()

  // Sync URL → Zustand activeTab
  const pathname = usePathname()
  const panelFromUrl = pathname === '/' ? 'overview' : pathname.slice(1)
  const normalizedPanel = panelFromUrl === 'sessions' ? 'chat' : panelFromUrl

  useEffect(() => {
    completeNavigationTiming(pathname)
  }, [pathname])

  useEffect(() => {
    setActiveTab(normalizedPanel)
    if (normalizedPanel === 'chat') {
      setChatPanelOpen(false)
    }
    if (panelFromUrl === 'sessions') {
      router.replace('/chat')
    }
  }, [panelFromUrl, normalizedPanel, router, setActiveTab, setChatPanelOpen])

  // Connect to SSE for real-time local DB events (tasks, agents, chat, etc.)
  useServerEvents()
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)

    // OpenClaw control-ui device identity requires a secure browser context.
    // Redirect remote HTTP sessions to HTTPS automatically to avoid handshake failures.
    if (window.location.protocol === 'http:' && !isLocalHost(window.location.hostname)) {
      const secureUrl = new URL(window.location.href)
      secureUrl.protocol = 'https:'
      window.location.replace(secureUrl.toString())
      return
    }

    const connectWithEnvFallback = () => {
      const explicitWsUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || ''
      const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
      const gatewayHost = process.env.NEXT_PUBLIC_GATEWAY_HOST || window.location.hostname
      const gatewayProto =
        process.env.NEXT_PUBLIC_GATEWAY_PROTOCOL ||
        (window.location.protocol === 'https:' ? 'wss' : 'ws')
      const wsUrl = explicitWsUrl || `${gatewayProto}://${gatewayHost}:${gatewayPort}`
      connect(wsUrl)
    }

    const connectWithPrimaryGateway = async (): Promise<{ attempted: boolean; connected: boolean }> => {
      try {
        const gatewaysRes = await fetch('/api/gateways')
        if (!gatewaysRes.ok) return { attempted: false, connected: false }
        const gatewaysJson = await gatewaysRes.json().catch(() => ({}))
        const gateways = Array.isArray(gatewaysJson?.gateways) ? gatewaysJson.gateways as GatewaySummary[] : []
        if (gateways.length === 0) return { attempted: false, connected: false }

        const primaryGateway = gateways.find(gw => Number(gw?.is_primary) === 1) || gateways[0]
        if (!primaryGateway?.id) return { attempted: true, connected: false }

        const connectRes = await fetch('/api/gateways/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: primaryGateway.id }),
        })
        if (!connectRes.ok) return { attempted: true, connected: false }

        const payload = await connectRes.json().catch(() => ({}))
        const wsUrl = typeof payload?.ws_url === 'string' ? payload.ws_url : ''
        const wsToken = typeof payload?.token === 'string' ? payload.token : ''
        if (!wsUrl) return { attempted: true, connected: false }

        connect(wsUrl, wsToken)
        return { attempted: true, connected: true }
      } catch {
        return { attempted: false, connected: false }
      }
    }

    // Fetch current user
    fetch('/api/auth/me')
      .then(async (res) => {
        if (res.ok) return res.json()
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`)
        }
        return null
      })
      .then(data => { if (data?.user) setCurrentUser(data.user) })
      .catch(() => {})

    // Check for available updates
    fetch('/api/releases/check')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.updateAvailable) {
          setUpdateAvailable({
            latestVersion: data.latestVersion,
            releaseUrl: data.releaseUrl,
            releaseNotes: data.releaseNotes,
          })
        }
      })
      .catch(() => {})

    // Check capabilities, then conditionally connect to gateway
    fetch('/api/status?action=capabilities')
      .then(res => res.ok ? res.json() : null)
      .then(async data => {
        if (data?.subscription) {
          setSubscription(data.subscription)
        }
        if (data?.processUser) {
          setDefaultOrgName(data.processUser)
        }
        if (data && data.gateway === false) {
          setDashboardMode('local')
          setGatewayAvailable(false)
          setCapabilitiesChecked(true)
          // Skip WebSocket connect — no gateway to talk to
          return
        }
        if (data && data.gateway === true) {
          setDashboardMode('full')
          setGatewayAvailable(true)
        }
        setCapabilitiesChecked(true)

        const primaryConnect = await connectWithPrimaryGateway()
        if (!primaryConnect.connected && !primaryConnect.attempted) {
          connectWithEnvFallback()
        }
      })
      .catch(() => {
        // If capabilities check fails, still try to connect
        setCapabilitiesChecked(true)
        connectWithEnvFallback()
      })

    // Check onboarding state
    fetch('/api/onboarding')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.showOnboarding) {
          setShowOnboarding(true)
        }
      })
      .catch(() => {})
  }, [connect, pathname, router, setCurrentUser, setDashboardMode, setGatewayAvailable, setCapabilitiesChecked, setSubscription, setUpdateAvailable, setShowOnboarding])

  if (!isClient) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-6">
          {/* Logo with glow pulse */}
          <div className="relative">
            <div className="absolute -inset-3 rounded-2xl bg-primary/10 blur-xl animate-glow-pulse" />
            <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-surface-1 border border-border/50 flex items-center justify-center shadow-lg shadow-primary/5">
              <img src="/brand/mc-logo-128.png" alt="Mission Control logo" className="w-full h-full object-cover" />
            </div>
          </div>

          {/* Animated loading dots */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '600ms' }} />
            </div>
            <span className="text-sm text-muted-foreground font-medium tracking-wide">Loading Mission Control</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium">
        Skip to main content
      </a>

      <OnboardingWizard />

      {/* Left: Icon rail navigation (hidden on mobile, shown as bottom bar instead) */}
      <NavRail />

      {/* Center: Header + Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <HeaderBar />
        <LocalModeBanner />
        <UpdateBanner />
        <main id="main-content" className="flex-1 overflow-auto pb-16 md:pb-0" role="main">
          <div aria-live="polite" className="flex flex-col min-h-full">
            <ErrorBoundary key={activeTab}>
              <ContentRouter tab={activeTab} />
            </ErrorBoundary>
          </div>
          <footer className="px-4 pb-4 pt-2">
            <p className="text-2xs text-muted-foreground/50 text-center">
              Built with care by <a href="https://x.com/nyk_builderz" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/70 hover:text-primary transition-colors duration-200">nyk</a>.
            </p>
          </footer>
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

      {/* Global Project Manager Modal */}
      {showProjectManagerModal && (
        <ProjectManagerModal
          onClose={() => setShowProjectManagerModal(false)}
          onChanged={async () => { await fetchProjects() }}
        />
      )}
    </div>
  )
}

function ContentRouter({ tab }: { tab: string }) {
  const { dashboardMode } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  switch (tab) {
    case 'overview':
      return (
        <>
          <Dashboard />
          {!isLocal && (
            <div className="mt-4 mx-4 mb-4 rounded-lg border border-border bg-card overflow-hidden">
              <AgentCommsPanel />
            </div>
          )}
        </>
      )
    case 'tasks':
      return <TaskBoardPanel />
    case 'agents':
      return (
        <>
          <OrchestrationBar />
          {isLocal && <LocalAgentsDocPanel />}
          <AgentSquadPanelPhase3 />
        </>
      )
    case 'activity':
      return <ActivityFeedPanel />
    case 'notifications':
      return <NotificationsPanel />
    case 'standup':
      return <StandupPanel />
    case 'sessions':
      return <ChatPagePanel />
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
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <MultiGatewayPanel />
    case 'gateway-config':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <GatewayConfigPanel />
    case 'integrations':
      return <IntegrationsPanel />
    case 'settings':
      return <SettingsPanel />
    case 'super-admin':
      return <SuperAdminPanel />
    case 'github':
      return <GitHubSyncPanel />
    case 'office':
      return <OfficePanel />
    case 'skills':
      return <SkillsPanel />
    case 'chat':
      return <ChatPagePanel />
    default:
      return <Dashboard />
  }
}

function LocalModeUnavailable({ panel }: { panel: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{panel}</span> requires an OpenClaw gateway connection.
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Configure a gateway to enable this panel.
      </p>
    </div>
  )
}
