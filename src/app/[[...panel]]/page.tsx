'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { ChatPanel } from '@/components/chat/chat-panel'
import { ContentRouter } from '@/components/layout/content-router'
import { STORAGE_GATEWAY_URL } from '@/lib/device-identity'
import { shouldRedirectDashboardToHttps } from '@/lib/browser-security'
import { useTranslations } from 'next-intl'
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
import { panelHref } from '@/lib/navigation'
import { clearOnboardingDismissedThisSession, clearOnboardingReplayFromStart, getOnboardingSessionDecision, markOnboardingReplayFromStart, readOnboardingDismissedThisSession } from '@/lib/onboarding-session'
import { useMissionControl, type CurrentUser } from '@/store'
import { apiFetch, ApiError } from '@/lib/api-client'
import { canonicalPanelId } from '@/lib/panel-routing'

interface GatewaySummary {
  id: number
  is_primary: number
}

interface CapabilitiesResponse {
  subscription?: { type: string; provider?: string; rateLimitTier?: string } | null
  processUser?: string
  interfaceMode?: 'essential' | 'full' | string
  gateway?: boolean
  claudeHome?: unknown
}

const STEP_KEYS = ['auth', 'capabilities', 'config', 'connect', 'agents', 'sessions', 'projects', 'memory', 'skills'] as const

const bootLabelKeys: Record<string, string> = {
  auth: 'authenticatingOperator',
  capabilities: 'detectingStationMode',
  config: 'loadingControlConfig',
  connect: 'connectingRuntimeLinks',
  agents: 'syncingAgentRegistry',
  sessions: 'loadingActiveSessions',
  projects: 'hydratingWorkspaceBoard',
  memory: 'mappingMemoryGraph',
  skills: 'indexingSkillCatalog',
}

export default function Home() {
  const router = useRouter()
  const { connect } = useWebSocket()
  const tb = useTranslations('boot')
  const tp = useTranslations('page')
  const tc = useTranslations('common')
  const { activeTab, setActiveTab, setCurrentUser, setDashboardMode, setGatewayAvailable, setLocalSessionsAvailable, setCapabilitiesChecked, setSubscription, setDefaultOrgName, setUpdateAvailable, setOpenclawUpdate, showOnboarding, setShowOnboarding, liveFeedOpen, toggleLiveFeed, showProjectManagerModal, setShowProjectManagerModal, fetchProjects, setChatPanelOpen, bootComplete, setBootComplete, setAgents, setSessions, setProjects, setInterfaceMode, setMemoryGraphAgents, setSkillsData, setSidebarExpanded } = useMissionControl()

  // Sync URL → Zustand activeTab
  const pathname = usePathname()
  const panelFromUrl = pathname === '/' ? 'overview' : pathname.slice(1)
  const normalizedPanel = canonicalPanelId(panelFromUrl)

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
      setSidebarExpanded(false)
    }
    if (panelFromUrl !== normalizedPanel) {
      router.replace(panelHref(normalizedPanel))
    }
  }, [panelFromUrl, normalizedPanel, router, setActiveTab, setChatPanelOpen, setSidebarExpanded])

  // Connect to SSE for real-time local DB events (tasks, agents, chat, etc.)
  useServerEvents()
  const [isClient, setIsClient] = useState(false)
  const [stepStatuses, setStepStatuses] = useState<Record<string, 'pending' | 'done'>>(
    () => Object.fromEntries(STEP_KEYS.map(k => [k, 'pending']))
  )

  const initSteps = useMemo(() =>
    STEP_KEYS.map(key => ({
      key,
      label: tb(bootLabelKeys[key] as Parameters<typeof tb>[0]),
      status: stepStatuses[key] || 'pending' as const,
    })),
    [tb, stepStatuses]
  )

  const markStep = (key: string) => {
    setStepStatuses(prev => ({ ...prev, [key]: 'done' }))
  }

  useEffect(() => {
    if (!bootComplete && stepStatuses.auth === 'done') {
      setBootComplete()
    }
  }, [stepStatuses.auth, bootComplete, setBootComplete])

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
    const failSafe = window.setTimeout(() => markStep('auth'), 3000)

    if (shouldRedirectDashboardToHttps({
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      forceHttps: process.env.NEXT_PUBLIC_FORCE_HTTPS === '1',
    })) {
      const secureUrl = new URL(window.location.href)
      secureUrl.protocol = 'https:'
      window.location.replace(secureUrl.toString())
      return
    }

    const connectWithEnvFallback = (localGatewayUrl: string | null) => {
      // localStorage user choice takes priority over env vars
      const explicitWsUrl = localGatewayUrl || process.env.NEXT_PUBLIC_GATEWAY_URL || ''
      if (explicitWsUrl) {
        connect(explicitWsUrl)
        return
      }
      const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
      const gatewayHost = process.env.NEXT_PUBLIC_GATEWAY_HOST || window.location.hostname
      const gatewayProto =
        process.env.NEXT_PUBLIC_GATEWAY_PROTOCOL ||
        (window.location.protocol === 'https:' ? 'wss' : 'ws')
      const wsUrl = `${gatewayProto}://${gatewayHost}:${gatewayPort}`
      connect(wsUrl)
    }

    const connectWithPrimaryGateway = async (preferredWsUrl?: string | null): Promise<{ attempted: boolean; connected: boolean }> => {
      try {
        // Non-2xx (or non-JSON body) → graceful "no gateways" result, matching the
        // original `!gatewaysRes.ok` / `.json().catch(() => ({}))` degradation.
        let gatewaysJson: { gateways?: unknown } | null
        try {
          gatewaysJson = await apiFetch<{ gateways?: unknown }>('/api/gateways')
        } catch (err) {
          if (err instanceof ApiError) return { attempted: false, connected: false }
          throw err
        }
        const gateways = Array.isArray(gatewaysJson?.gateways) ? gatewaysJson.gateways as GatewaySummary[] : []
        if (gateways.length === 0) return { attempted: false, connected: false }

        const primaryGateway = gateways.find(gw => Number(gw?.is_primary) === 1) || gateways[0]
        if (!primaryGateway?.id) return { attempted: true, connected: false }

        // Non-2xx (or non-JSON body) → graceful "attempted but not connected", matching
        // the original `!connectRes.ok` / `.json().catch(() => ({}))` degradation.
        let payload: { ws_url?: unknown; token?: unknown } | null
        try {
          payload = await apiFetch<{ ws_url?: unknown; token?: unknown }>('/api/gateways/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: primaryGateway.id }),
          })
        } catch (err) {
          if (err instanceof ApiError) return { attempted: true, connected: false }
          throw err
        }
        const resolvedWsUrl = typeof payload?.ws_url === 'string' ? payload.ws_url : ''
        const wsUrl = preferredWsUrl?.trim() || resolvedWsUrl
        const wsToken = typeof payload?.token === 'string' ? payload.token : ''
        if (!wsUrl) return { attempted: true, connected: false }

        connect(wsUrl, wsToken)
        return { attempted: true, connected: true }
      } catch {
        return { attempted: false, connected: false }
      }
    }

    // Fetch current user.
    // Suppress apiFetch's built-in /login?from=… redirect: this site uses a different
    // redirect (`/login?next=…`) and must drive it from the 401 branch itself.
    apiFetch<{ user?: CurrentUser }>('/api/auth/me', { redirectOnUnauthenticated: false })
      .then(data => { if (data?.user) setCurrentUser(data.user); markStep('auth') })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`)
        }
        markStep('auth')
      })

    // Check for available updates.
    // Non-ok previously yielded data=null (no update applied); apiFetch throws instead,
    // caught by the existing no-op .catch — same net effect (no update banner shown).
    apiFetch<{ updateAvailable?: boolean; latestVersion: string; releaseUrl: string; releaseNotes: string }>('/api/releases/check')
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

    // Check for OpenClaw updates.
    // Original mapped non-ok → data=null → the `else` branch cleared the update
    // (setOpenclawUpdate(null)). Reproduce that on thrown ApiError in the catch so a
    // failed/no-update check still clears any stale banner.
    apiFetch<{ updateAvailable?: boolean; installed: string; latest: string; releaseUrl: string; releaseNotes: string; updateCommand: string }>('/api/openclaw/version')
      .then(data => {
        if (data?.updateAvailable) {
          setOpenclawUpdate({
            installed: data.installed,
            latest: data.latest,
            releaseUrl: data.releaseUrl,
            releaseNotes: data.releaseNotes,
            updateCommand: data.updateCommand,
          })
        } else {
          setOpenclawUpdate(null)
        }
      })
      .catch(() => { setOpenclawUpdate(null) })

    // Check capabilities, then conditionally connect to gateway.
    // Original: a non-ok response mapped to data=null and still ran the success path
    // (which attempts connectWithPrimaryGateway); only a fetch-level network failure hit
    // the .catch (env fallback). apiFetch throws on non-ok too, so map non-network
    // ApiErrors back to null data to preserve that branch split; let NETWORK_ERROR (and
    // anything else) propagate to the existing .catch env-fallback.
    apiFetch<CapabilitiesResponse | null>('/api/status?action=capabilities')
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code !== 'NETWORK_ERROR') return null
        throw err
      })
      .then(async data => {
        const localGatewayUrl = localStorage.getItem(STORAGE_GATEWAY_URL)

        if (data?.subscription) {
          setSubscription(data.subscription)
        }
        if (data?.processUser) {
          setDefaultOrgName(data.processUser)
        }
        if (data?.interfaceMode === 'essential' || data?.interfaceMode === 'full') {
          setInterfaceMode(data.interfaceMode)
        }

        // User's explicit gateway URL choice (localStorage) takes PRIORITY over server's gateway flag.
        // If user chose a URL from login page, always connect to it.
        if (localGatewayUrl) {
          // User explicitly chose a gateway URL — always set full mode
          setDashboardMode('full')
          setGatewayAvailable(true)
          if (data?.claudeHome) {
            setLocalSessionsAvailable(true)
          }
          setCapabilitiesChecked(true)
          markStep('capabilities')
          return
        }

        // A missed TCP probe is "unknown", not "no gateway". Keep retrying WS.
        if (data && data.gateway === false) {
          setDashboardMode('local')
          setGatewayAvailable(false)
          setCapabilitiesChecked(true)
          markStep('capabilities')
          return
        }
        if (data && data.gateway === true) {
          setDashboardMode('full')
          setGatewayAvailable(true)
        }
        if (data?.claudeHome) {
          setLocalSessionsAvailable(true)
        }
        setCapabilitiesChecked(true)
        markStep('capabilities')
      })
      .catch(() => {
        setCapabilitiesChecked(true)
        markStep('capabilities')
      })

    void connectWithPrimaryGateway(typeof window !== 'undefined' ? localStorage.getItem(STORAGE_GATEWAY_URL) : null)
      .then((primaryConnect) => {
        if (!primaryConnect.connected && !primaryConnect.attempted) {
          connectWithEnvFallback(typeof window !== 'undefined' ? localStorage.getItem(STORAGE_GATEWAY_URL) : null)
        }
      })
      .catch(() => {
        connectWithEnvFallback(typeof window !== 'undefined' ? localStorage.getItem(STORAGE_GATEWAY_URL) : null)
      })
      .finally(() => { markStep('connect') })

    // Check onboarding state.
    // Original mapped non-ok → data=null → getOnboardingSessionDecision with all-false
    // flags → shouldOpen:false (no-op) → markStep('config'). apiFetch throws on non-ok
    // instead, hitting the .catch that also marks 'config' — same net effect (onboarding
    // stays closed, boot step completes).
    apiFetch<{ isAdmin?: boolean; showOnboarding?: boolean; completed?: boolean; skipped?: boolean }>('/api/onboarding')
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
    // Preload workspace data in parallel.
    // Each call previously mapped non-ok → null data → the `data?.…` guard skipped the
    // setter. apiFetch throws on non-ok instead; the rejection is absorbed by
    // Promise.allSettled and the guarded .then is skipped — same net effect (no setter,
    // step still marked via .finally / pre-fetch markStep). Panels lazy-load as fallback.
    markStep('agents')
    markStep('sessions')
    markStep('projects')
    markStep('memory')
    markStep('skills')
    Promise.allSettled([
      apiFetch<{ agents?: unknown }>('/api/agents')
        .then((agentsData) => {
          if (agentsData?.agents) setAgents(agentsData.agents as Parameters<typeof setAgents>[0])
        }),
      apiFetch<{ sessions?: unknown }>('/api/sessions', {
        signal: AbortSignal.timeout(15_000),
      })
        .then((sessionsData) => {
          if (sessionsData?.sessions) setSessions(sessionsData.sessions as Parameters<typeof setSessions>[0])
        }),
      apiFetch<{ projects?: unknown }>('/api/projects')
        .then((projectsData) => {
          if (projectsData?.projects) setProjects(projectsData.projects as Parameters<typeof setProjects>[0])
        }),
      apiFetch<{ agents?: unknown }>('/api/memory/graph?agent=all')
        .then((graphData) => {
          if (graphData?.agents) setMemoryGraphAgents(graphData.agents as Parameters<typeof setMemoryGraphAgents>[0])
        }),
      apiFetch<{ skills?: unknown; groups?: unknown; total?: unknown }>('/api/skills')
        .then((skillsData) => {
          if (skillsData?.skills) setSkillsData(skillsData.skills as Parameters<typeof setSkillsData>[0], (skillsData.groups || []) as Parameters<typeof setSkillsData>[1], (skillsData.total || 0) as number)
        }),
    ]).catch(() => { /* panels will lazy-load as fallback */ })

    return () => window.clearTimeout(failSafe)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount, not on every pathname change
  }, [connect, router, setCurrentUser, setDashboardMode, setGatewayAvailable, setLocalSessionsAvailable, setCapabilitiesChecked, setSubscription, setUpdateAvailable, setShowOnboarding, setAgents, setSessions, setProjects, setInterfaceMode, setMemoryGraphAgents, setSkillsData])

  if (!isClient || !bootComplete) {
    return <Loader variant="page" steps={isClient ? initSteps : undefined} />
  }

  const isChatDesktop = !showOnboarding && normalizedPanel === 'chat'

  return (
    <div className={`flex h-screen overflow-hidden ${isChatDesktop ? '' : 'bg-background'}`}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium">
        {tc('skipToMainContent')}
      </a>

      {/* Left: Icon rail navigation (hidden on mobile, shown as bottom bar instead) */}
      {!showOnboarding && <NavRail />}

      {/* Center: Header + Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {!showOnboarding && !isChatDesktop && (
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
          className={isChatDesktop
            ? 'flex-1 overflow-hidden pb-16 md:pb-0'
            : `flex-1 overflow-auto pb-16 md:pb-0 ${showOnboarding ? 'pointer-events-none select-none blur-[2px] opacity-30' : ''}`}
          role="main"
          aria-hidden={showOnboarding}
        >
          <div aria-live="polite" className={`flex flex-col ${isChatDesktop ? 'h-full' : 'min-h-full'}`}>
            <ErrorBoundary key={activeTab}>
              <ContentRouter tab={activeTab} />
            </ErrorBoundary>
          </div>
{/* Footer removed — attribution moved to nav sidebar */}
        </main>
      </div>

      {/* Right: Live feed (hidden on mobile) */}
      {!showOnboarding && !isChatDesktop && liveFeedOpen && (
        <div className="hidden lg:flex h-full">
          <LiveFeed />
        </div>
      )}

      {/* Floating button to reopen LiveFeed when closed */}
      {!showOnboarding && !isChatDesktop && !liveFeedOpen && (
        <button
          onClick={toggleLiveFeed}
          className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 w-6 h-12 items-center justify-center bg-card border border-r-0 border-border rounded-l-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
          title={tp('showLiveFeed')}
          aria-label={tp('showLiveFeed')}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Chat panel overlay */}
      {!showOnboarding && !isChatDesktop && <ChatPanel />}

      {/* Global exec approval overlay (shown regardless of active panel) */}
      {!showOnboarding && <ExecApprovalOverlay />}

      {/* Global Project Manager Modal */}
      {!showOnboarding && showProjectManagerModal && (
        <ProjectManagerModal
          onClose={() => setShowProjectManagerModal(false)}
          onChanged={async () => { await fetchProjects() }}
        />
      )}

      <OnboardingWizard />
    </div>
  )
}
