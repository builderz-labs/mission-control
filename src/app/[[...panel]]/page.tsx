'use client'

import { createElement, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { Dashboard } from '@/components/dashboard/dashboard'
import { LogViewerPanel } from '@/components/panels/log-viewer-panel'
import { CronManagementPanel } from '@/components/panels/cron-management-panel'
import { MemoryBrowserPanel } from '@/components/panels/memory-browser-panel'
import { CostTrackerPanel } from '@/components/panels/cost-tracker-panel'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'
import { ActivityFeedPanel } from '@/components/panels/activity-feed-panel'
import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'
import { AgentCommsPanel } from '@/components/panels/agent-comms-panel'
import { StandupPanel } from '@/components/panels/standup-panel'
import { OrchestrationBar } from '@/components/panels/orchestration-bar'
import { NotificationsPanel } from '@/components/panels/notifications-panel'
import { UserManagementPanel } from '@/components/panels/user-management-panel'
import { AuditTrailPanel } from '@/components/panels/audit-trail-panel'
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
import { ChannelsPanel } from '@/components/panels/channels-panel'
import { DebugPanel } from '@/components/panels/debug-panel'
import { SecurityAuditPanel } from '@/components/panels/security-audit-panel'
import { NodesPanel } from '@/components/panels/nodes-panel'
import { ExecApprovalPanel } from '@/components/panels/exec-approval-panel'
import { ChatPagePanel } from '@/components/panels/chat-page-panel'
import { ChatPanel } from '@/components/chat/chat-panel'
import { getPluginPanel } from '@/lib/plugins'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LocalModeBanner } from '@/components/layout/local-mode-banner'
import { UpdateBanner } from '@/components/layout/update-banner'
import { OpenClawUpdateBanner } from '@/components/layout/openclaw-update-banner'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { Loader } from '@/components/ui/loader'
import { ProjectManagerModal } from '@/components/modals/project-manager-modal'
import { ExecApprovalOverlay } from '@/components/modals/exec-approval-overlay'
import { useWebSocket } from '@/lib/websocket'
import { useServerEvents } from '@/lib/use-server-events'
import { completeNavigationTiming } from '@/lib/navigation-metrics'
import { useNavigateToPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

interface GatewaySummary {
  id: number
  is_primary: number
}

function renderPluginPanel(panelId: string) {
  const pluginPanel = getPluginPanel(panelId)
  return pluginPanel ? createElement(pluginPanel) : <Dashboard />
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

const ONBOARDING_SESSION_KEY = 'mc-onboarding-session-seen'

export default function Home() {
  const router = useRouter()
  const { connect } = useWebSocket()
  const { activeTab, setActiveTab, setCurrentUser, setDashboardMode, setGatewayAvailable, setCapabilitiesChecked, setSubscription, setDefaultOrgName, setUpdateAvailable, setOpenclawUpdate, setShowOnboarding, liveFeedOpen, toggleLiveFeed, showProjectManagerModal, setShowProjectManagerModal, fetchProjects, setChatPanelOpen, bootComplete, setBootComplete, setAgents, setSessions, setProjects, setInterfaceMode, setMemoryGraphAgents, setSkillsData } = useMissionControl()

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
  const [initSteps, setInitSteps] = useState<Array<{ key: string; label: string; status: 'pending' | 'done' }>>([
    { key: 'auth',         label: 'Authenticating',     status: 'pending' },
    { key: 'capabilities', label: 'Detecting mode',     status: 'pending' },
    { key: 'config',       label: 'Loading config',     status: 'pending' },
    { key: 'connect',      label: 'Connecting',         status: 'pending' },
    { key: 'workspace',    label: 'Loading workspace',  status: 'pending' },
  ])

  const markStep = (key: string) => {
    setInitSteps(prev => prev.map(s => s.key === key ? { ...s, status: 'done' } : s))
  }

  useEffect(() => {
    if (!bootComplete && initSteps.every(s => s.status === 'done')) {
      const t = setTimeout(() => setBootComplete(), 400)
      return () => clearTimeout(t)
    }
  }, [initSteps, bootComplete, setBootComplete])

  // Security console warning (anti-self-XSS)
  useEffect(() => {
    if (!bootComplete) return
    if (typeof window === 'undefined') return
    const key = 'mc-console-warning'
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')

    console.log(
      '%c  Stop!  ',
      'color: #fff; background: #e53e3e; font-size: 40px; font-weight: bold; padding: 4px 16px; border-radius: 4px;'
    )
    console.log(
      '%cThis is a browser feature intended for developers.\n\nIf someone told you to copy-paste something here to enable a feature or "hack" an account, it is a scam and will give them access to your account.',
      'font-size: 14px; color: #e2e8f0; padding: 8px 0;'
    )
    console.log(
      '%cLearn more: https://en.wikipedia.org/wiki/Self-XSS',
      'font-size: 12px; color: #718096;'
    )
  }, [bootComplete])

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
      .then(data => { if (data?.user) setCurrentUser(data.user); markStep('auth') })
      .catch(() => { markStep('auth') })

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

    // Check for OpenClaw updates
    fetch('/api/openclaw/version')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.updateAvailable) {
          setOpenclawUpdate({
            installed: data.installed,
            latest: data.latest,
            releaseUrl: data.releaseUrl,
            releaseNotes: data.releaseNotes,
            updateCommand: data.updateCommand,
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
        if (data?.interfaceMode === 'essential' || data?.interfaceMode === 'full') {
          setInterfaceMode(data.interfaceMode)
        }
        if (data && data.gateway === false) {
          setDashboardMode('local')
          setGatewayAvailable(false)
          setCapabilitiesChecked(true)
          markStep('capabilities')
          markStep('connect')
          // Skip WebSocket connect — no gateway to talk to
          return
        }
        if (data && data.gateway === true) {
          setDashboardMode('full')
          setGatewayAvailable(true)
        }
        setCapabilitiesChecked(true)
        markStep('capabilities')

        const primaryConnect = await connectWithPrimaryGateway()
        if (!primaryConnect.connected && !primaryConnect.attempted) {
          connectWithEnvFallback()
        }
        markStep('connect')
      })
      .catch(() => {
        // If capabilities check fails, still try to connect
        setCapabilitiesChecked(true)
        markStep('capabilities')
        markStep('connect')
        connectWithEnvFallback()
      })

    // Check onboarding state
    fetch('/api/onboarding')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        let shouldOpenOnboarding = Boolean(data?.showOnboarding)

        if (typeof window !== 'undefined' && data?.isAdmin === true) {
          try {
            const seenThisSession = sessionStorage.getItem(ONBOARDING_SESSION_KEY) === '1'
            if (!seenThisSession && !shouldOpenOnboarding) {
              // Replay walkthrough once per fresh browser session (including incognito sessions).
              shouldOpenOnboarding = true
            }
            if (!seenThisSession) {
              sessionStorage.setItem(ONBOARDING_SESSION_KEY, '1')
            }
          } catch {
            // Ignore storage access issues and fall back to server onboarding state only.
          }
        }

        if (shouldOpenOnboarding) {
          setShowOnboarding(true)
        }
        markStep('config')
      })
      .catch(() => { markStep('config') })
    // Preload workspace data in parallel
    Promise.all([
      fetch('/api/agents').then(r => r.ok ? r.json() : null),
      fetch('/api/sessions').then(r => r.ok ? r.json() : null),
      fetch('/api/projects').then(r => r.ok ? r.json() : null),
      fetch('/api/memory/graph?agent=all').then(r => r.ok ? r.json() : null),
      fetch('/api/skills').then(r => r.ok ? r.json() : null),
    ]).then(([agentsData, sessionsData, projectsData, graphData, skillsData]) => {
      if (agentsData?.agents) setAgents(agentsData.agents)
      if (sessionsData?.sessions) setSessions(sessionsData.sessions)
      if (projectsData?.projects) setProjects(projectsData.projects)
      if (graphData?.agents) setMemoryGraphAgents(graphData.agents)
      if (skillsData?.skills) setSkillsData(skillsData.skills, skillsData.groups || [], skillsData.total || 0)
    }).catch(() => { /* panels will lazy-load as fallback */ })
      .finally(() => { markStep('workspace') })

  // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount, not on every pathname change
  }, [connect, router, setCurrentUser, setDashboardMode, setGatewayAvailable, setCapabilitiesChecked, setSubscription, setUpdateAvailable, setShowOnboarding, setAgents, setSessions, setProjects, setInterfaceMode, setMemoryGraphAgents, setSkillsData])

  if (!isClient || !bootComplete) {
    return <Loader variant="page" steps={isClient ? initSteps : undefined} />
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
        <OpenClawUpdateBanner />
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

      {/* Global exec approval overlay (shown regardless of active panel) */}
      <ExecApprovalOverlay />

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

const ESSENTIAL_PANELS = new Set([
  'overview', 'agents', 'tasks', 'chat', 'activity', 'logs', 'settings',
])

function ContentRouter({ tab }: { tab: string }) {
  const { dashboardMode, interfaceMode, setInterfaceMode } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const isLocal = dashboardMode === 'local'

  // Guard: show nudge for non-essential panels in essential mode
  if (interfaceMode === 'essential' && !ESSENTIAL_PANELS.has(tab)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground capitalize">{tab.replace(/-/g, ' ')}</span> is available in Full mode.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setInterfaceMode('full')
              try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { 'general.interface_mode': 'full' } }) }) } catch {}
            }}
          >
            Switch to Full
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToPanel('overview')}
          >
            Go to Overview
          </Button>
        </div>
      </div>
    )
  }

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
    case 'cost-tracker':
    case 'tokens':
    case 'agent-costs':
      return <CostTrackerPanel />
    case 'users':
      return <UserManagementPanel />
    case 'history':
    case 'activity':
      return <ActivityFeedPanel />
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
    case 'channels':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <ChannelsPanel />
    case 'nodes':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <NodesPanel />
    case 'security':
      return <SecurityAuditPanel />
    case 'debug':
      return <DebugPanel />
    case 'exec-approvals':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <ExecApprovalPanel />
    case 'chat':
      return <ChatPagePanel />
    default: {
      return renderPluginPanel(tab)
    }
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
