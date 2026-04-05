'use client'

import { createElement, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { Dashboard } from '@/components/dashboard/dashboard'
import { PanelSkeleton } from '@/components/ui/panel-skeleton'
import { ChatPanel } from '@/components/chat/chat-panel'

// -- Lazy-loaded panel components (code-split per route) --
// NOTE: Turbopack requires dynamic() options to be an inline object literal — no variable refs allowed.
const LogViewerPanel = dynamic(
  () => import('@/components/panels/log-viewer-panel').then(m => ({ default: m.LogViewerPanel })),
  { loading: () => <PanelSkeleton /> },
)
const CronManagementPanel = dynamic(
  () => import('@/components/panels/cron-management-panel').then(m => ({ default: m.CronManagementPanel })),
  { loading: () => <PanelSkeleton /> },
)
const MemoryBrowserPanel = dynamic(
  () => import('@/components/panels/memory-browser-panel').then(m => ({ default: m.MemoryBrowserPanel })),
  { loading: () => <PanelSkeleton /> },
)
const CostTrackerPanel = dynamic(
  () => import('@/components/panels/cost-tracker-panel').then(m => ({ default: m.CostTrackerPanel })),
  { loading: () => <PanelSkeleton /> },
)
const TaskBoardPanel = dynamic(
  () => import('@/components/panels/task-board-panel').then(m => ({ default: m.TaskBoardPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ActivityFeedPanel = dynamic(
  () => import('@/components/panels/activity-feed-panel').then(m => ({ default: m.ActivityFeedPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AgentSquadPanelPhase3 = dynamic(
  () => import('@/components/panels/agent-squad-panel-phase3').then(m => ({ default: m.AgentSquadPanelPhase3 })),
  { loading: () => <PanelSkeleton /> },
)
const AgentCommsPanel = dynamic(
  () => import('@/components/panels/agent-comms-panel').then(m => ({ default: m.AgentCommsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const StandupPanel = dynamic(
  () => import('@/components/panels/standup-panel').then(m => ({ default: m.StandupPanel })),
  { loading: () => <PanelSkeleton /> },
)
const OrchestrationBar = dynamic(
  () => import('@/components/panels/orchestration-bar').then(m => ({ default: m.OrchestrationBar })),
  { loading: () => <PanelSkeleton /> },
)
const NotificationsPanel = dynamic(
  () => import('@/components/panels/notifications-panel').then(m => ({ default: m.NotificationsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const UserManagementPanel = dynamic(
  () => import('@/components/panels/user-management-panel').then(m => ({ default: m.UserManagementPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AuditTrailPanel = dynamic(
  () => import('@/components/panels/audit-trail-panel').then(m => ({ default: m.AuditTrailPanel })),
  { loading: () => <PanelSkeleton /> },
)
const WebhookPanel = dynamic(
  () => import('@/components/panels/webhook-panel').then(m => ({ default: m.WebhookPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SettingsPanel = dynamic(
  () => import('@/components/panels/settings-panel').then(m => ({ default: m.SettingsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const GatewayConfigPanel = dynamic(
  () => import('@/components/panels/gateway-config-panel').then(m => ({ default: m.GatewayConfigPanel })),
  { loading: () => <PanelSkeleton /> },
)
const IntegrationsPanel = dynamic(
  () => import('@/components/panels/integrations-panel').then(m => ({ default: m.IntegrationsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AlertRulesPanel = dynamic(
  () => import('@/components/panels/alert-rules-panel').then(m => ({ default: m.AlertRulesPanel })),
  { loading: () => <PanelSkeleton /> },
)
const MultiGatewayPanel = dynamic(
  () => import('@/components/panels/multi-gateway-panel').then(m => ({ default: m.MultiGatewayPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SuperAdminPanel = dynamic(
  () => import('@/components/panels/super-admin-panel').then(m => ({ default: m.SuperAdminPanel })),
  { loading: () => <PanelSkeleton /> },
)
const OfficePanel = dynamic(
  () => import('@/components/panels/office-panel').then(m => ({ default: m.OfficePanel })),
  { loading: () => <PanelSkeleton /> },
)
const GitHubSyncPanel = dynamic(
  () => import('@/components/panels/github-sync-panel').then(m => ({ default: m.GitHubSyncPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SkillsPanel = dynamic(
  () => import('@/components/panels/skills-panel').then(m => ({ default: m.SkillsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const LocalAgentsDocPanel = dynamic(
  () => import('@/components/panels/local-agents-doc-panel').then(m => ({ default: m.LocalAgentsDocPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ChannelsPanel = dynamic(
  () => import('@/components/panels/channels-panel').then(m => ({ default: m.ChannelsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const DebugPanel = dynamic(
  () => import('@/components/panels/debug-panel').then(m => ({ default: m.DebugPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SecurityAuditPanel = dynamic(
  () => import('@/components/panels/security-audit-panel').then(m => ({ default: m.SecurityAuditPanel })),
  { loading: () => <PanelSkeleton /> },
)
const NodesPanel = dynamic(
  () => import('@/components/panels/nodes-panel').then(m => ({ default: m.NodesPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ExecApprovalPanel = dynamic(
  () => import('@/components/panels/exec-approval-panel').then(m => ({ default: m.ExecApprovalPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ChatPagePanel = dynamic(
  () => import('@/components/panels/chat-page-panel').then(m => ({ default: m.ChatPagePanel })),
  { loading: () => <PanelSkeleton /> },
)
const JarvisPanel = dynamic(
  () => import('@/components/panels/jarvis-panel').then(m => ({ default: m.JarvisPanel })),
  { loading: () => <PanelSkeleton /> },
)
const TokenDashboardPanel = dynamic(
  () => import('@/components/panels/token-dashboard-panel').then(m => ({ default: m.TokenDashboardPanel })),
  { loading: () => <PanelSkeleton /> },
)
const PipelineTab = dynamic(
  () => import('@/components/panels/pipeline-tab').then(m => ({ default: m.PipelineTab })),
  { loading: () => <PanelSkeleton /> },
)
const AgentCostPanel = dynamic(
  () => import('@/components/panels/agent-cost-panel').then(m => ({ default: m.AgentCostPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AgentHistoryPanel = dynamic(
  () => import('@/components/panels/agent-history-panel').then(m => ({ default: m.AgentHistoryPanel })),
  { loading: () => <PanelSkeleton /> },
)
const DocumentsPanel = dynamic(
  () => import('@/components/panels/documents-panel').then(m => ({ default: m.DocumentsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SessionDetailsPanel = dynamic(
  () => import('@/components/panels/session-details-panel').then(m => ({ default: m.SessionDetailsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const PresentationsPanel = dynamic(
  () => import('@/components/panels/presentations-panel').then(m => ({ default: m.PresentationsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const IntelligenceBriefPanel = dynamic(
  () => import('@/components/panels/intelligence-brief-panel').then(m => ({ default: m.IntelligenceBriefPanel })),
  { loading: () => <PanelSkeleton /> },
)
const LeaderboardPanel = dynamic(
  () => import('@/components/panels/leaderboard-panel').then(m => ({ default: m.LeaderboardPanel })),
  { loading: () => <PanelSkeleton /> },
)
const HandoffChainsPanel = dynamic(
  () => import('@/components/panels/handoff-chains-panel').then(m => ({ default: m.HandoffChainsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ExecReplayPanel = dynamic(
  () => import('@/components/panels/exec-replay-panel').then(m => ({ default: m.ExecReplayPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ProviderFailoverPanel = dynamic(
  () => import('@/components/panels/provider-failover-panel').then(m => ({ default: m.ProviderFailoverPanel })),
  { loading: () => <PanelSkeleton /> },
)
const WarRoomPanel = dynamic(
  () => import('@/components/panels/war-room-panel').then(m => ({ default: m.WarRoomPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SemanticSearchPanel = dynamic(
  () => import('@/components/panels/semantic-search-panel').then(m => ({ default: m.SemanticSearchPanel })),
  { loading: () => <PanelSkeleton /> },
)
import { getPluginPanel } from '@/lib/plugins'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LocalModeBanner } from '@/components/layout/local-mode-banner'
import { UpdateBanner } from '@/components/layout/update-banner'
import { OpenClawUpdateBanner } from '@/components/layout/openclaw-update-banner'
import { OpenClawDoctorBanner } from '@/components/layout/openclaw-doctor-banner'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { Loader } from '@/components/ui/loader'
import { ProjectManagerModal } from '@/components/modals/project-manager-modal'
import { ExecApprovalOverlay } from '@/components/modals/exec-approval-overlay'
import { useWebSocket } from '@/lib/websocket'
import { useServerEvents } from '@/lib/use-server-events'
import { completeNavigationTiming } from '@/lib/navigation-metrics'
import { panelHref, useNavigateToPanel } from '@/lib/navigation'
import { clearOnboardingDismissedThisSession, clearOnboardingReplayFromStart, getOnboardingSessionDecision, markOnboardingReplayFromStart, readOnboardingDismissedThisSession } from '@/lib/onboarding-session'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { CommandBar } from '@/components/command-bar/command-bar'
import { useCommandBar } from '@/components/command-bar/use-command-bar'

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

export default function Home() {
  const router = useRouter()
  const { connect } = useWebSocket()
  const { activeTab, setActiveTab, setCurrentUser, setDashboardMode, setGatewayAvailable, setCapabilitiesChecked, setSubscription, setDefaultOrgName, setUpdateAvailable, setOpenclawUpdate, showOnboarding, setShowOnboarding, liveFeedOpen, toggleLiveFeed, showProjectManagerModal, setShowProjectManagerModal, fetchProjects, setChatPanelOpen, bootComplete, setBootComplete, setAgents, setSessions, setProjects, setInterfaceMode, setMemoryGraphAgents, setSkillsData } = useMissionControl()
  const commandBar = useCommandBar()

  // Sync URL → Zustand activeTab
  const pathname = usePathname()
  const panelFromUrl = pathname === '/' ? 'overview' : pathname.slice(1)
  const normalizedPanel = panelFromUrl === 'sessions' ? 'chat' : panelFromUrl

  useEffect(() => {
    completeNavigationTiming(pathname)
  }, [pathname])

  useEffect(() => {
    completeNavigationTiming(panelHref(activeTab))
  }, [activeTab])

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
    { key: 'auth',         label: 'Authenticating operator',    status: 'pending' },
    { key: 'capabilities', label: 'Detecting station mode',     status: 'pending' },
    { key: 'config',       label: 'Loading control config',     status: 'pending' },
    { key: 'connect',      label: 'Connecting runtime links',   status: 'pending' },
    { key: 'agents',       label: 'Syncing agent registry',     status: 'pending' },
    { key: 'sessions',     label: 'Loading active sessions',    status: 'pending' },
    { key: 'projects',     label: 'Hydrating workspace board',  status: 'pending' },
    { key: 'memory',       label: 'Mapping memory graph',       status: 'pending' },
    { key: 'skills',       label: 'Indexing skill catalog',     status: 'pending' },
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

  // Boot failsafe — force-complete any pending steps after 15 seconds so
  // the user is never stuck on the loader if an API endpoint hangs.
  useEffect(() => {
    const BOOT_FAILSAFE_MS = 15_000

    const timer = setTimeout(() => {
      if (bootComplete) return

      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Ultron] Boot failsafe triggered — forcing completion after 15s')
      }
      setInitSteps(prev => prev.map(s =>
        s.status === 'pending' ? { ...s, status: 'done' as const } : s
      ))
    }, BOOT_FAILSAFE_MS)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only failsafe; bootComplete checked inside callback
  }, [])

  // Security console warning (anti-self-XSS)
  useEffect(() => {
    if (!bootComplete) return
    if (typeof window === 'undefined') return
    const key = 'mc-console-warning'
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')

    if (process.env.NODE_ENV !== 'production') {
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
    }
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
        const gatewaysRes = await fetch('/api/gateways', { signal: AbortSignal.timeout(8000) })
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
          signal: AbortSignal.timeout(8000),
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
    fetch('/api/auth/me', { signal: AbortSignal.timeout(8000) })
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
    fetch('/api/releases/check', { signal: AbortSignal.timeout(8000) })
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
    fetch('/api/openclaw/version', { signal: AbortSignal.timeout(8000) })
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
    fetch('/api/status?action=capabilities', { signal: AbortSignal.timeout(8000) })
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
    fetch('/api/onboarding', { signal: AbortSignal.timeout(8000) })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const decision = getOnboardingSessionDecision({
          isAdmin: data?.isAdmin === true,
          serverShowOnboarding: data?.showOnboarding === true,
          completed: data?.completed === true,
          skipped: data?.skipped === true,
          dismissedThisSession: readOnboardingDismissedThisSession(),
        })

        if (decision.shouldOpen) {
          clearOnboardingDismissedThisSession()
          if (decision.replayFromStart) {
            markOnboardingReplayFromStart()
          } else {
            clearOnboardingReplayFromStart()
          }
          setShowOnboarding(true)
        }
        markStep('config')
      })
      .catch(() => { markStep('config') })
    // Preload workspace data in parallel
    Promise.allSettled([
      fetch('/api/agents', { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then((agentsData) => {
          if (agentsData?.agents) setAgents(agentsData.agents)
        })
        .finally(() => { markStep('agents') }),
      fetch('/api/sessions', { signal: AbortSignal.timeout(12000) })
        .then(r => r.ok ? r.json() : null)
        .then((sessionsData) => {
          if (sessionsData?.sessions) setSessions(sessionsData.sessions)
        })
        .finally(() => { markStep('sessions') }),
      fetch('/api/projects', { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then((projectsData) => {
          if (projectsData?.projects) setProjects(projectsData.projects)
        })
        .finally(() => { markStep('projects') }),
      fetch('/api/memory/graph?agent=all', { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then((graphData) => {
          if (graphData?.agents) setMemoryGraphAgents(graphData.agents)
        })
        .finally(() => { markStep('memory') }),
      fetch('/api/skills', { signal: AbortSignal.timeout(12000) })
        .then(r => r.ok ? r.json() : null)
        .then((skillsData) => {
          if (skillsData?.skills) setSkillsData(skillsData.skills, skillsData.groups || [], skillsData.total || 0)
        })
        .finally(() => { markStep('skills') }),
    ]).catch(() => { /* panels will lazy-load as fallback */ })

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

      {/* Left: Icon rail navigation (hidden on mobile, shown as bottom bar instead) */}
      {!showOnboarding && <NavRail />}

      {/* Center: Header + Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {!showOnboarding && (
          <>
            <HeaderBar />
            <LocalModeBanner />
            <UpdateBanner />
            <OpenClawUpdateBanner />
            <OpenClawDoctorBanner />
          </>
        )}
        <main
          id="main-content"
          className={`flex-1 overflow-auto pb-16 md:pb-0 ${showOnboarding ? 'pointer-events-none select-none blur-[2px] opacity-30' : ''}`}
          role="main"
          aria-hidden={showOnboarding}
        >
          <div aria-live="polite" className="flex flex-col min-h-full">
            <ErrorBoundary key={activeTab}>
              <ContentRouter tab={activeTab} />
            </ErrorBoundary>
          </div>
          <footer className="px-4 pb-4 pt-2">
            <p className="text-2xs text-muted-foreground/50 text-center">
              Built by <a href="https://www.linkedin.com/in/tonywalteur/" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/70 hover:text-primary transition-colors duration-200">Tony W.</a> for Mantu Group.
            </p>
          </footer>
        </main>
      </div>

      {/* Right: Live feed (hidden on mobile) */}
      {!showOnboarding && liveFeedOpen && (
        <div className="hidden lg:flex h-full">
          <LiveFeed />
        </div>
      )}

      {/* Floating button to reopen LiveFeed when closed */}
      {!showOnboarding && !liveFeedOpen && (
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
      {!showOnboarding && <ChatPanel />}

      {/* Global exec approval overlay (shown regardless of active panel) */}
      {!showOnboarding && <ExecApprovalOverlay />}

      {/* Global Project Manager Modal */}
      {!showOnboarding && showProjectManagerModal && (
        <ProjectManagerModal
          onClose={() => setShowProjectManagerModal(false)}
          onChanged={async () => { await fetchProjects() }}
        />
      )}

      {/* Global ⌘K command bar */}
      <CommandBar isOpen={commandBar.isOpen} onClose={commandBar.close} />

      <OnboardingWizard />
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
              try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { 'general.interface_mode': 'full' } }), signal: AbortSignal.timeout(8000) }) } catch {}
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
    case 'jarvis':
      return <JarvisPanel />
    case 'token-dashboard':
      return <TokenDashboardPanel />
    case 'pipeline':
      return <PipelineTab />
    case 'agent-cost':
      return <AgentCostPanel />
    case 'agent-history':
      return <AgentHistoryPanel />
    case 'documents':
      return <DocumentsPanel />
    case 'session-details':
      return <SessionDetailsPanel />
    case 'presentations':
      return <PresentationsPanel />
    case 'intelligence-brief':
      return <IntelligenceBriefPanel />
    case 'leaderboard':
      return <LeaderboardPanel />
    case 'handoff-chains':
      return <HandoffChainsPanel />
    case 'exec-replay':
      return <ExecReplayPanel />
    case 'providers':
      return <ProviderFailoverPanel />
    case 'war-room':
      return <WarRoomPanel />
    case 'search':
      return <SemanticSearchPanel />
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
