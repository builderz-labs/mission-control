'use client'

import Image from 'next/image'
import { createPortal } from 'react-dom'
import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { clampWizardStep, getWizardSteps, stepIdAt } from '@/lib/onboarding-flow'
import { SecurityScanCard } from '@/components/onboarding/security-scan-card'
// StepAgentRuntimes removed — runtime management moved to Settings page
import { clearOnboardingReplayFromStart, markOnboardingDismissedThisSession, readOnboardingReplayFromStart } from '@/lib/onboarding-session'

interface StepInfo {
  id: string
  title: string
  completed: boolean
}

interface OnboardingState {
  showOnboarding: boolean
  currentStep: number
  steps: StepInfo[]
}

interface DiagSecurityCheck {
  name: string
  pass: boolean
  detail: string
}

interface DashboardRegistration {
  registered: boolean
  alreadySet: boolean
}

interface RuntimeStatusInfo {
  id: string
  name: string
  installed: boolean
  version: string | null
  running: boolean
  authRequired: boolean
  authHint: string
  authenticated: boolean
}

interface SystemCapabilities {
  claudeSessions: number
  agentCount: number
  gatewayConnected: boolean
  hasSkills: boolean
  dashboardRegistration: DashboardRegistration | null
}


/** Mode-aware Tailwind classes — local=amber, gateway=cyan */
function modeColors(isGateway: boolean) {
  return isGateway
    ? { text: 'text-void-cyan', border: 'border-void-cyan/30', bg: 'bg-void-cyan', bgLight: 'bg-void-cyan/5', bgBtn: 'bg-void-cyan/20', hoverBg: 'hover:bg-void-cyan/30', hoverBorder: 'hover:border-void-cyan/30', hoverBgLight: 'hover:bg-void-cyan/10', dot: 'bg-void-cyan', dotDim: 'bg-void-cyan/40' }
    : { text: 'text-void-amber', border: 'border-void-amber/30', bg: 'bg-void-amber', bgLight: 'bg-void-amber/5', bgBtn: 'bg-void-amber/20', hoverBg: 'hover:bg-void-amber/30', hoverBorder: 'hover:border-void-amber/30', hoverBgLight: 'hover:bg-void-amber/10', dot: 'bg-void-amber', dotDim: 'bg-void-amber/40' }
}

export function OnboardingWizard() {
  const { showOnboarding, setShowOnboarding, dashboardMode, gatewayAvailable, interfaceMode, setInterfaceMode } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const t = useTranslations('onboarding')
  const [step, setStep] = useState(0)
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('left')
  const [animating, setAnimating] = useState(false)
  const [state, setState] = useState<OnboardingState | null>(null)
  const [credentialStatus, setCredentialStatus] = useState<{ authOk: boolean; apiKeyOk: boolean } | null>(null)
  const [closing, setClosing] = useState(false)
  const [completionMessage, setCompletionMessage] = useState(false)
  const [runtimeStatuses, setRuntimeStatuses] = useState<RuntimeStatusInfo[]>([])
  const [runtimesLoading, setRuntimesLoading] = useState(true)
  const [capabilities, setCapabilities] = useState<SystemCapabilities>({
    claudeSessions: 0,
    agentCount: 0,
    gatewayConnected: false,
    hasSkills: false,
    dashboardRegistration: null,
  })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!showOnboarding) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    fetch('/api/onboarding')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setState(data)
          const shouldReplayFromStart = readOnboardingReplayFromStart()
          setStep((current) => {
            const incoming = shouldReplayFromStart ? 0 : (typeof data.currentStep === 'number' ? data.currentStep : current)
            return clampWizardStep(incoming, data?.steps?.length || 0)
          })
          if (shouldReplayFromStart) {
            clearOnboardingReplayFromStart()
          }
        }
      })
      .catch(() => {})

    // Fetch system capabilities and runtime status in parallel
    Promise.allSettled([
      fetch('/api/status?action=capabilities').then(r => r.ok ? r.json() : null),
      fetch('/api/agents?limit=1').then(r => r.ok ? r.json() : null),
      fetch('/api/agent-runtimes').then(r => r.ok ? r.json() : null),
    ]).then(([statusResult, agentsResult, runtimesResult]) => {
      const statusData = statusResult.status === 'fulfilled' ? statusResult.value : null
      const agentsData = agentsResult.status === 'fulfilled' ? agentsResult.value : null
      const runtimesData = runtimesResult.status === 'fulfilled' ? runtimesResult.value : null
      setCapabilities({
        claudeSessions: statusData?.claudeSessions ?? 0,
        gatewayConnected: statusData?.gateway ?? false,
        agentCount: agentsData?.total ?? 0,
        hasSkills: false,
        dashboardRegistration: statusData?.dashboardRegistration ?? null,
      })
      if (runtimesData?.runtimes) {
        setRuntimeStatuses(runtimesData.runtimes)
      }
      setRuntimesLoading(false)
    })

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [showOnboarding])

  const STEPS = getWizardSteps(capabilities.gatewayConnected)
  const credentialsStepIndex = STEPS.findIndex((s) => s.id === 'credentials')

  useEffect(() => {
    setStep((current) => clampWizardStep(current, STEPS.length))
  }, [STEPS.length])

  useEffect(() => {
    if (step !== credentialsStepIndex || credentialStatus) return
    fetch('/api/diagnostics')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.security?.checks) {
          const checks = data.security.checks as DiagSecurityCheck[]
          const authOk = checks.find(c => c.name === 'Auth password secure')?.pass ?? false
          const apiKeyOk = checks.find(c => c.name === 'API key configured')?.pass ?? false
          setCredentialStatus({ authOk, apiKeyOk })
        }
      })
      .catch(() => {})
  }, [step, credentialStatus, credentialsStepIndex])

  const completeStep = useCallback(async (stepId: string) => {
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete_step', step: stepId }),
    }).catch(() => {})
  }, [])

  const finish = useCallback(async () => {
    setCompletionMessage(true)
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete' }),
    }).catch(() => {})
    setTimeout(() => {
      setClosing(true)
      markOnboardingDismissedThisSession()
      setTimeout(() => setShowOnboarding(false), 300)
    }, 1200)
  }, [setShowOnboarding])

  const skip = useCallback(async () => {
    setClosing(true)
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    }).catch(() => {})
    markOnboardingDismissedThisSession()
    setTimeout(() => setShowOnboarding(false), 300)
  }, [setShowOnboarding])

  const goNext = useCallback(() => {
    const currentId = stepIdAt(step, STEPS)
    if (currentId) completeStep(currentId)
    setSlideDir('left')
    setAnimating(true)
    setTimeout(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
      setAnimating(false)
    }, 150)
  }, [step, STEPS, completeStep])

  const goBack = useCallback(() => {
    setSlideDir('right')
    setAnimating(true)
    setTimeout(() => {
      setStep((s) => Math.max(s - 1, 0))
      setAnimating(false)
    }, 150)
  }, [])

  useEffect(() => {
    if (!showOnboarding) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        skip()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showOnboarding, skip])

  if (!mounted || !showOnboarding || !state) return null

  const totalSteps = STEPS.length
  const isGateway = dashboardMode === 'full' || gatewayAvailable

  return createPortal(
    <div className={`fixed inset-0 z-[140] flex items-start justify-center overflow-y-auto p-2 sm:items-center sm:p-4 transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/82 backdrop-blur-md" onClick={skip} />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mission Control onboarding"
        className="relative z-10 my-auto w-full max-w-3xl bg-background border border-border/50 rounded-lg sm:rounded-xl shadow-2xl overflow-hidden flex max-h-[calc(100dvh-1rem)] sm:max-h-[85vh] flex-col"
      >
        {/* Progress bar */}
        <div className="h-0.5 bg-surface-2">
          <div
            className={`h-full transition-all duration-500 ${isGateway ? 'bg-void-cyan' : 'bg-void-amber'}`}
            style={{ width: `${((step + 1) / totalSteps) * 85 + 15}%` }}
          />
        </div>

        {/* Step indicator */}
        <div className="flex flex-col items-center gap-1 pt-4 pb-2">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === step
                    ? (isGateway ? 'bg-void-cyan' : 'bg-void-amber')
                    : i < step
                      ? (isGateway ? 'bg-void-cyan/40' : 'bg-void-amber/40')
                      : 'bg-surface-2'
                }`}
              />
            ))}
          </div>
          <span className="text-sm text-muted-foreground">{STEPS[step]?.title}</span>
        </div>

        {/* Content */}
        <div className={`relative flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:min-h-[320px] transition-all duration-150 ${
          animating
            ? `opacity-0 ${slideDir === 'left' ? '-translate-x-3' : 'translate-x-3'}`
            : 'opacity-100 translate-x-0'
        }`}>
          {completionMessage && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
              <div className={`text-2xl font-bold mb-2 ${isGateway ? 'text-void-cyan' : 'text-void-amber'}`}>{t('stationOnline')}</div>
              <p className="text-sm text-muted-foreground">{t('stationReady')}</p>
            </div>
          )}
          {STEPS[step]?.id === 'welcome' && (
            <StepWelcome isGateway={isGateway} capabilities={capabilities} runtimeStatuses={runtimeStatuses} runtimesLoading={runtimesLoading} onNext={goNext} onSkip={skip} onNavigateToSettings={() => { skip(); navigateToPanel('settings') }} />
          )}
          {STEPS[step]?.id === 'interface-mode' && (
            <StepInterfaceMode isGateway={isGateway} onNext={goNext} onBack={goBack} />
          )}
          {STEPS[step]?.id === 'gateway-link' && (
            <StepGatewayLink isGateway={isGateway} registration={capabilities.dashboardRegistration} onNext={goNext} onBack={goBack} />
          )}
          {/* agent-runtimes step removed — runtime management via Settings */}
          {STEPS[step]?.id === 'credentials' && (
            <StepCredentials isGateway={isGateway} status={credentialStatus} onFinish={finish} onBack={goBack} navigateToPanel={navigateToPanel} onClose={skip} />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function StepWelcome({ isGateway, capabilities, runtimeStatuses, runtimesLoading, onNext, onSkip, onNavigateToSettings }: {
  isGateway: boolean
  capabilities: SystemCapabilities
  runtimeStatuses: RuntimeStatusInfo[]
  runtimesLoading: boolean
  onNext: () => void
  onSkip: () => void
  onNavigateToSettings: () => void
}) {
  const mc = modeColors(isGateway)
  const t = useTranslations('onboarding.welcome')

  const installedCount = runtimeStatuses.filter(r => r.installed).length
  const totalCount = runtimeStatuses.length

  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-surface-1 border border-border/50 flex items-center justify-center shadow-lg">
          <Image
            src="/brand/mc-logo-128.png"
            alt="Mission Control"
            width={56}
            height={56}
            className="w-full h-full object-cover"
          />
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-2">{t('title')}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {t('description')}
          </p>
        </div>

        {/* Runtime status list */}
        <div className="w-full max-w-sm">
          {runtimesLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader variant="inline" />
              <span>{t('runtimesLoading')}</span>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border/30 bg-surface-1/20 divide-y divide-border/20">
                {runtimeStatuses.map((rt) => (
                  <div key={rt.id} className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        rt.installed && (!rt.authRequired || rt.authenticated)
                          ? 'bg-emerald-400'
                          : rt.installed
                            ? 'bg-amber-400'
                            : 'bg-surface-2'
                      }`} />
                      <div className="text-left">
                        <span className={`text-sm font-medium ${rt.installed ? 'text-foreground' : 'text-muted-foreground/60'}`}>
                          {rt.name}
                        </span>
                        {rt.version && (
                          <span className="text-2xs text-muted-foreground/50 ml-1.5">v{rt.version}</span>
                        )}
                      </div>
                    </div>
                    <span className={`text-2xs ${
                      rt.installed && (!rt.authRequired || rt.authenticated)
                        ? 'text-emerald-400'
                        : rt.installed
                          ? 'text-amber-400'
                          : 'text-muted-foreground/40'
                    }`}>
                      {!rt.installed
                        ? t('runtimeNotInstalled')
                        : rt.authRequired && !rt.authenticated
                          ? t('runtimeNotAuthenticated')
                          : t('runtimeAuthenticated')}
                    </span>
                  </div>
                ))}
              </div>

              {totalCount > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t('runtimesReady', { installed: installedCount, total: totalCount })}
                </p>
              )}

              {installedCount === 0 && totalCount > 0 && (
                <div className="mt-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-center">
                  <p className="text-xs text-amber-400 mb-2">{t('installAtLeastOne')}</p>
                  <Button variant="ghost" size="sm" onClick={onNavigateToSettings} className="text-xs text-primary">
                    {t('goToSettings')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Live status chips */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <StatusChip
            ok={capabilities.claudeSessions > 0}
            label={capabilities.claudeSessions > 0
              ? t('activeSessionsDetected', { count: capabilities.claudeSessions })
              : t('noActiveSessions')}
          />
          <StatusChip
            ok={capabilities.gatewayConnected}
            label={capabilities.gatewayConnected ? t('gatewayConnected') : t('localModeNoGateway')}
          />
          <StatusChip
            ok={capabilities.agentCount > 0}
            label={capabilities.agentCount > 0
              ? t('agentsRegistered', { count: capabilities.agentCount })
              : t('noAgentsYet')}
          />
        </div>
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between border-t border-border/30 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:z-auto sm:mx-0 sm:mt-6 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-0">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-sm text-muted-foreground min-h-10 px-4">
          {t('skipSetup')}
        </Button>
        <Button onClick={onNext} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg} min-h-10 px-4`}>
          {t('getStarted')}
        </Button>
      </div>
    </>
  )
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-1 border border-border/30">
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-400' : 'bg-surface-2'}`} />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

function StepInterfaceMode({ isGateway, onNext, onBack }: {
  isGateway: boolean
  onNext: () => void
  onBack: () => void
}) {
  const mc = modeColors(isGateway)
  const t = useTranslations('onboarding.interfaceMode')
  const tc = useTranslations('common')
  const { interfaceMode, setInterfaceMode } = useMissionControl()
  const [selected, setSelected] = useState<'essential' | 'full'>(interfaceMode)

  const handleSelect = async (mode: 'essential' | 'full') => {
    setSelected(mode)
    setInterfaceMode(mode)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { 'general.interface_mode': mode } }),
      })
    } catch {}
  }

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t('description')}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Essential card */}
          <button
            onClick={() => handleSelect('essential')}
            className={`relative p-4 rounded-lg border text-left transition-all ${
              selected === 'essential'
                ? `border-void-amber/50 bg-void-amber/5 border-l-2 border-l-void-amber ring-1 ring-void-amber/20`
                : 'border-border/30 bg-surface-1/30 hover:border-border/50'
            }`}
          >
            {selected === 'essential' && (
              <span className="absolute -top-2 right-2 text-2xs px-1.5 py-0.5 rounded-full bg-void-amber/20 text-void-amber border border-void-amber/30">
                {tc('selected')}
              </span>
            )}
            <p className={`text-sm font-medium mb-2 ${selected === 'essential' ? 'text-void-amber' : 'text-foreground'}`}>
              {t('essential')}
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {t('essentialDescription')}
            </p>
            <ul className="text-2xs text-muted-foreground/70 space-y-0.5">
              <li>{t('essentialPanels1')}</li>
              <li>{t('essentialPanels2')}</li>
              <li>{t('essentialTotal')}</li>
            </ul>
          </button>

          {/* Full card */}
          <button
            onClick={() => handleSelect('full')}
            className={`relative p-4 rounded-lg border text-left transition-all ${
              selected === 'full'
                ? `border-void-cyan/50 bg-void-cyan/5 border-l-2 border-l-void-cyan ring-1 ring-void-cyan/20`
                : 'border-border/30 bg-surface-1/30 hover:border-border/50'
            }`}
          >
            {selected === 'full' && (
              <span className="absolute -top-2 right-2 text-2xs px-1.5 py-0.5 rounded-full bg-void-cyan/20 text-void-cyan border border-void-cyan/30">
                {tc('selected')}
              </span>
            )}
            <p className={`text-sm font-medium mb-2 ${selected === 'full' ? 'text-void-cyan' : 'text-foreground'}`}>
              {t('full')}
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {t('fullDescription')}
            </p>
            <ul className="text-2xs text-muted-foreground/70 space-y-0.5">
              <li>{t('fullIncludes')}</li>
              <li>{t('fullPanels')}</li>
              <li>{t('fullTotal')}</li>
            </ul>
          </button>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between border-t border-border/30 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:z-auto sm:mx-0 sm:mt-6 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-sm text-muted-foreground min-h-10 px-4">{tc('back')}</Button>
        <Button onClick={onNext} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg} min-h-10 px-4`}>
          {tc('continue')}
        </Button>
      </div>
    </>
  )
}

function StepGatewayLink({ isGateway, registration, onNext, onBack }: {
  isGateway: boolean
  registration: DashboardRegistration | null
  onNext: () => void
  onBack: () => void
}) {
  const mc = modeColors(isGateway)
  const t = useTranslations('onboarding.gatewayLink')
  const tc = useTranslations('common')
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)

  const testConnection = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/gateways/health', { method: 'POST' })
      setHealthOk(res.ok)
    } catch {
      setHealthOk(false)
    } finally {
      setTesting(false)
    }
  }

  const configured = registration?.registered || registration?.alreadySet

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t('description')}
        </p>

        <div className="space-y-3">
          <div className={`flex items-start gap-3 p-3 rounded-lg border ${
            configured ? 'border-green-400/20 bg-green-400/5' : 'border-amber-400/20 bg-amber-400/5'
          }`}>
            <span className={`font-mono text-sm mt-0.5 ${configured ? 'text-green-400' : 'text-amber-400'}`}>
              [{configured ? '+' : '~'}]
            </span>
            <div>
              <p className="text-sm font-medium">{t('originRegistered')}</p>
              <p className="text-sm text-muted-foreground">
                {configured
                  ? t('originAdded')
                  : t('registrationPending')}
              </p>
            </div>
          </div>

          <div className={`flex items-start gap-3 p-3 rounded-lg border ${
            configured ? 'border-green-400/20 bg-green-400/5' : 'border-border/20 bg-surface-1/30'
          }`}>
            <span className={`font-mono text-sm mt-0.5 ${configured ? 'text-green-400' : 'text-muted-foreground'}`}>
              [{configured ? '+' : '-'}]
            </span>
            <div>
              <p className="text-sm font-medium">{t('deviceAuthConfigured')}</p>
              <p className="text-sm text-muted-foreground">
                {configured
                  ? t('deviceAuthDisabled')
                  : t('deviceAuthWillConfigure')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={testConnection}
              disabled={testing}
            >
              {testing ? t('testing') : t('testConnection')}
            </Button>
            {healthOk === true && (
              <span className="text-xs text-green-400">{t('gatewayReachable')}</span>
            )}
            {healthOk === false && (
              <span className="text-xs text-red-400">{t('gatewayUnreachable')}</span>
            )}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between border-t border-border/30 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:z-auto sm:mx-0 sm:mt-6 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-sm text-muted-foreground min-h-10 px-4">{tc('back')}</Button>
        <Button onClick={onNext} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg} min-h-10 px-4`}>
          {tc('continue')}
        </Button>
      </div>
    </>
  )
}

function StepCredentials({
  isGateway,
  status,
  onFinish,
  onBack,
  navigateToPanel,
  onClose,
}: {
  isGateway: boolean
  status: { authOk: boolean; apiKeyOk: boolean } | null
  onFinish: () => void
  onBack: () => void
  navigateToPanel: (panel: string) => void
  onClose: () => void
}) {
  const mc = modeColors(isGateway)
  const t = useTranslations('onboarding.credentials')
  const tc = useTranslations('common')
  const allGood = status?.authOk && status?.apiKeyOk

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t('description')}
        </p>

        {!status ? (
          <div className="py-4">
            <Loader variant="inline" label={t('checkingCredentials')} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${status.authOk ? 'border-green-400/20 bg-green-400/5' : 'border-red-400/20 bg-red-400/5'}`}>
              <span className={`font-mono text-sm mt-0.5 ${status.authOk ? 'text-green-400' : 'text-red-400'}`}>
                [{status.authOk ? '+' : 'x'}]
              </span>
              <div>
                <p className="text-sm font-medium">{t('adminPassword')}</p>
                <p className="text-sm text-muted-foreground">
                  {status.authOk ? t('passwordStrong') : t('passwordWeak')}
                </p>
              </div>
            </div>

            <div className={`flex items-start gap-3 p-3 rounded-lg border ${status.apiKeyOk ? 'border-green-400/20 bg-green-400/5' : 'border-red-400/20 bg-red-400/5'}`}>
              <span className={`font-mono text-sm mt-0.5 ${status.apiKeyOk ? 'text-green-400' : 'text-red-400'}`}>
                [{status.apiKeyOk ? '+' : 'x'}]
              </span>
              <div>
                <p className="text-sm font-medium">{t('apiKey')}</p>
                <p className="text-sm text-muted-foreground">
                  {status.apiKeyOk
                    ? t('apiKeyConfigured')
                    : t('apiKeyNotSet')}
                </p>
              </div>
            </div>

            {!allGood && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => { onClose(); navigateToPanel('settings') }}
              >
                {t('openSettings')}
              </Button>
            )}

            <div className="pt-2">
              <div className="mb-2">
                <p className="text-sm font-medium">{t('securityScan')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('securityScanDescription')}
                </p>
              </div>
              <div className="rounded-lg border border-border/40 bg-surface-1/40 p-3">
                <SecurityScanCard compact autoScan />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between border-t border-border/30 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:z-auto sm:mx-0 sm:mt-6 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-sm text-muted-foreground min-h-10 px-4">{tc('back')}</Button>
        <Button onClick={onFinish} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg} min-h-10 px-4`}>
          {allGood ? t('launchStation') : t('launchAnyway')}
        </Button>
      </div>
    </>
  )
}
