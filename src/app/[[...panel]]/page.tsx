'use client'

// Thin orchestrator — owns only the two concerns that must live in the route
// file: URL ↔ Zustand activeTab sync, and the boot data-fetching effect.
// Everything else is delegated to focused components in src/components/boot/.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useWebSocket } from '@/lib/websocket'
import { useServerEvents } from '@/lib/use-server-events'
import { completeNavigationTiming } from '@/lib/navigation-metrics'
import { panelHref, useNavigateToPanel } from '@/lib/navigation'
import {
  clearOnboardingDismissedThisSession,
  clearOnboardingReplayFromStart,
  getOnboardingSessionDecision,
  markOnboardingReplayFromStart,
  readOnboardingDismissedThisSession,
} from '@/lib/onboarding-session'
import { useMissionControl } from '@/store'
import { Loader } from '@/components/ui/loader'
import { useBootSequence } from '@/components/boot/boot-sequence'
import { AppShell } from '@/components/boot/app-shell'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GatewaySummary {
  id: number
  is_primary: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function Home(): React.ReactElement {
  const router = useRouter()
  const { connect } = useWebSocket()
  const {
    activeTab,
    setActiveTab,
    setCurrentUser,
    setDashboardMode,
    setGatewayAvailable,
    setCapabilitiesChecked,
    setSubscription,
    setDefaultOrgName,
    setUpdateAvailable,
    setOpenclawUpdate,
    setShowOnboarding,
    bootComplete,
    setAgents,
    setSessions,
    setProjects,
    setInterfaceMode,
    setMemoryGraphAgents,
    setSkillsData,
    setChatPanelOpen,
  } = useMissionControl()

  // Boot state: step tracking, failsafe timer, degraded-mode toast
  const { isClient, bootDegradedWarning, initSteps, markStep, dismissDegradedWarning } = useBootSequence()

  // Real-time local-DB events (tasks, agents, chat, etc.)
  useServerEvents()

  // -------------------------------------------------------------------------
  // URL ↔ activeTab sync
  // -------------------------------------------------------------------------

  const pathname = usePathname()
  const panelFromUrl = pathname === '/' ? 'overview' : pathname.slice(1)
  // Legacy /sessions URL is aliased to /chat
  const normalizedPanel = panelFromUrl === 'sessions' ? 'chat' : panelFromUrl

  useEffect(() => {
    completeNavigationTiming(pathname)
  }, [pathname])

  useEffect(() => {
    completeNavigationTiming(panelHref(activeTab))
  }, [activeTab])

  useEffect(() => {
    setActiveTab(normalizedPanel)
    if (normalizedPanel === 'chat') setChatPanelOpen(false)
    // Redirect the old /sessions URL to its canonical path
    if (panelFromUrl === 'sessions') router.replace('/chat')
  }, [panelFromUrl, normalizedPanel, router, setActiveTab, setChatPanelOpen])

  // -------------------------------------------------------------------------
  // Boot data-fetch effect (runs once on mount)
  // -------------------------------------------------------------------------

  useEffect(() => {
    // OpenClaw device identity requires a secure browser context.
    // Redirect remote HTTP sessions to HTTPS to avoid handshake failures.
    if (window.location.protocol === 'http:' && !isLocalHost(window.location.hostname)) {
      const secureUrl = new URL(window.location.href)
      secureUrl.protocol = 'https:'
      window.location.replace(secureUrl.toString())
      return
    }

    // Security console warning (anti-self-XSS) — shown once per session only.
    const consoleKey = 'mc-console-warning'
    if (!sessionStorage.getItem(consoleKey)) {
      sessionStorage.setItem(consoleKey, '1')
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
    }

    // Build a WebSocket URL from env vars as a fallback when no DB gateway exists.
    const connectWithEnvFallback = (): void => {
      const explicitWsUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || ''
      const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
      const gatewayHost = process.env.NEXT_PUBLIC_GATEWAY_HOST || window.location.hostname
      const gatewayProto =
        process.env.NEXT_PUBLIC_GATEWAY_PROTOCOL ||
        (window.location.protocol === 'https:' ? 'wss' : 'ws')
      const wsUrl = explicitWsUrl || `${gatewayProto}://${gatewayHost}:${gatewayPort}`
      connect(wsUrl)
    }

    // Attempt to connect to the primary DB-configured gateway first; fall back
    // to env-var URL if none is configured or the API call fails.
    const connectWithPrimaryGateway = async (): Promise<{ attempted: boolean; connected: boolean }> => {
      try {
        const gatewaysRes = await fetch('/api/gateways', { signal: AbortSignal.timeout(8000) })
        if (!gatewaysRes.ok) return { attempted: false, connected: false }
        const gatewaysJson = await gatewaysRes.json().catch(() => ({}))
        const gateways = Array.isArray(gatewaysJson?.gateways) ? (gatewaysJson.gateways as GatewaySummary[]) : []
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

    // Auth — redirect to /login on 401
    fetch('/api/auth/me', { signal: AbortSignal.timeout(8000) })
      .then(async (res) => {
        if (res.ok) return res.json()
        if (res.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`)
        return null
      })
      .then(data => { if (data?.user) setCurrentUser(data.user); markStep('auth') })
      .catch(() => { markStep('auth') })

    // App-update availability
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

    // OpenClaw-update availability
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

    // Capabilities check — determines gateway availability and interface mode,
    // then triggers the appropriate WebSocket connection strategy.
    fetch('/api/status?action=capabilities', { signal: AbortSignal.timeout(8000) })
      .then(res => res.ok ? res.json() : null)
      .then(async data => {
        if (data?.subscription)   setSubscription(data.subscription)
        if (data?.processUser)    setDefaultOrgName(data.processUser)
        if (data?.interfaceMode === 'essential' || data?.interfaceMode === 'full') {
          setInterfaceMode(data.interfaceMode)
        }
        if (data && data.gateway === false) {
          setDashboardMode('local')
          setGatewayAvailable(false)
          setCapabilitiesChecked(true)
          markStep('capabilities')
          markStep('connect')
          // Skip WebSocket — no gateway to talk to
          return
        }
        if (data && data.gateway === true) {
          setDashboardMode('full')
          setGatewayAvailable(true)
        }
        setCapabilitiesChecked(true)
        markStep('capabilities')

        const primaryConnect = await connectWithPrimaryGateway()
        if (!primaryConnect.connected && !primaryConnect.attempted) connectWithEnvFallback()
        markStep('connect')
      })
      .catch(() => {
        // Capabilities failure — still attempt env-fallback connection
        setCapabilitiesChecked(true)
        markStep('capabilities')
        markStep('connect')
        connectWithEnvFallback()
      })

    // Onboarding state
    fetch('/api/onboarding', { signal: AbortSignal.timeout(8000) })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const decision = getOnboardingSessionDecision({
          isAdmin:              data?.isAdmin === true,
          serverShowOnboarding: data?.showOnboarding === true,
          completed:            data?.completed === true,
          skipped:              data?.skipped === true,
          dismissedThisSession: readOnboardingDismissedThisSession(),
        })
        if (decision.shouldOpen) {
          clearOnboardingDismissedThisSession()
          if (decision.replayFromStart) markOnboardingReplayFromStart()
          else clearOnboardingReplayFromStart()
          setShowOnboarding(true)
        }
        markStep('config')
      })
      .catch(() => { markStep('config') })

    // Workspace pre-load (parallel — panels lazy-load individually on failure)
    Promise.allSettled([
      fetch('/api/agents', { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.agents) setAgents(d.agents) })
        .finally(() => { markStep('agents') }),
      fetch('/api/sessions', { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.sessions) setSessions(d.sessions) })
        .finally(() => { markStep('sessions') }),
      fetch('/api/projects', { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.projects) setProjects(d.projects) })
        .finally(() => { markStep('projects') }),
      fetch('/api/memory/graph?agent=all', { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.agents) setMemoryGraphAgents(d.agents) })
        .finally(() => { markStep('memory') }),
      fetch('/api/skills', { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.skills) setSkillsData(d.skills, d.groups || [], d.total || 0) })
        .finally(() => { markStep('skills') }),
    ]).catch(() => { /* panels lazy-load as fallback */ })

  // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount; stable setters from Zustand are safe to omit
  }, [connect, router, setCurrentUser, setDashboardMode, setGatewayAvailable, setCapabilitiesChecked, setSubscription, setUpdateAvailable, setShowOnboarding, setAgents, setSessions, setProjects, setInterfaceMode, setMemoryGraphAgents, setSkillsData])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!isClient || !bootComplete) {
    return <Loader variant="page" steps={isClient ? initSteps : undefined} />
  }

  return (
    <AppShell
      activeTab={activeTab}
      bootDegradedWarning={bootDegradedWarning}
      onDismissDegraded={dismissDegradedWarning}
    />
  )
}
