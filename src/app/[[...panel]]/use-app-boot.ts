'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { STORAGE_GATEWAY_URL } from '@/lib/device-identity'
import { shouldRedirectDashboardToHttps } from '@/lib/browser-security'
import { clearOnboardingDismissedThisSession, clearOnboardingReplayFromStart, getOnboardingSessionDecision, markOnboardingReplayFromStart, readOnboardingDismissedThisSession } from '@/lib/onboarding-session'
import { useWebSocket } from '@/lib/websocket'
import { useMissionControl } from '@/store'

interface GatewaySummary {
  id: number
  is_primary: number
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

export function useAppBoot() {
  const router = useRouter()
  const pathname = usePathname()
  const { connect } = useWebSocket()
  const tb = useTranslations('boot')
  const {
    setCurrentUser,
    setDashboardMode,
    setGatewayAvailable,
    setLocalSessionsAvailable,
    setCapabilitiesChecked,
    setSubscription,
    setDefaultOrgName,
    setUpdateAvailable,
    setOpenclawUpdate,
    setShowOnboarding,
    bootComplete,
    setBootComplete,
    setAgents,
    setSessions,
    setProjects,
    setInterfaceMode,
    setMemoryGraphAgents,
    setSkillsData,
  } = useMissionControl()

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
    if (!bootComplete && initSteps.every(s => s.status === 'done')) {
      setBootComplete()
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
        } else {
          setOpenclawUpdate(null)
        }
      })
      .catch(() => {})

    // Check capabilities, then conditionally connect to gateway
    fetch('/api/status?action=capabilities')
      .then(res => res.ok ? res.json() : null)
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
          const primaryConnect = await connectWithPrimaryGateway(localGatewayUrl)
          if (!primaryConnect.connected) {
            connect(localGatewayUrl)
          }
          markStep('connect')
          return
        }

        // No user-chosen URL — use server's gateway flag to decide
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
        if (data?.claudeHome) {
          setLocalSessionsAvailable(true)
        }
        setCapabilitiesChecked(true)
        markStep('capabilities')

        // No user choice + server gateway flag false → try primary gateway / env fallback
        const primaryConnect = await connectWithPrimaryGateway()
        if (!primaryConnect.connected && !primaryConnect.attempted) {
          connectWithEnvFallback(null)
        }
        markStep('connect')
      })
      .catch(() => {
        // If capabilities check fails, still try to connect
        setCapabilitiesChecked(true)
        markStep('capabilities')
        markStep('connect')
        connectWithEnvFallback(null)
      })

    // Check onboarding state
    fetch('/api/onboarding')
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
      fetch('/api/agents')
        .then(r => r.ok ? r.json() : null)
        .then((agentsData) => {
          if (agentsData?.agents) setAgents(agentsData.agents)
        })
        .finally(() => { markStep('agents') }),
      // Sessions can be slow with many JSONL files — don't block boot
      (() => {
        markStep('sessions')
        return fetch('/api/sessions')
          .then(r => r.ok ? r.json() : null)
          .then((sessionsData) => {
            if (sessionsData?.sessions) setSessions(sessionsData.sessions)
          })
      })(),
      fetch('/api/projects')
        .then(r => r.ok ? r.json() : null)
        .then((projectsData) => {
          if (projectsData?.projects) setProjects(projectsData.projects)
        })
        .finally(() => { markStep('projects') }),
      // Memory graph can be slow — don't block boot
      (() => {
        markStep('memory')
        return fetch('/api/memory/graph?agent=all')
          .then(r => r.ok ? r.json() : null)
          .then((graphData) => {
            if (graphData?.agents) setMemoryGraphAgents(graphData.agents)
          })
      })(),
      fetch('/api/skills')
        .then(r => r.ok ? r.json() : null)
        .then((skillsData) => {
          if (skillsData?.skills) setSkillsData(skillsData.skills, skillsData.groups || [], skillsData.total || 0)
        })
        .finally(() => { markStep('skills') }),
    ]).catch(() => { /* panels will lazy-load as fallback */ })

  // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount, not on every pathname change
  }, [connect, router, setCurrentUser, setDashboardMode, setGatewayAvailable, setLocalSessionsAvailable, setCapabilitiesChecked, setSubscription, setUpdateAvailable, setShowOnboarding, setAgents, setSessions, setProjects, setInterfaceMode, setMemoryGraphAgents, setSkillsData])

  return { isClient, initSteps }
}
