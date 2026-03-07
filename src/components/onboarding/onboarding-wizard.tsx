'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { SecurityScanCard } from './security-scan-card'

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

interface CapabilitiesData {
  gateway: boolean
  openclawHome: boolean
  claudeHome: boolean
}

interface DiagSecurityCheck {
  name: string
  pass: boolean
  detail: string
}

export function OnboardingWizard() {
  const { showOnboarding, setShowOnboarding, dashboardMode, gatewayAvailable } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [step, setStep] = useState(0)
  const [state, setState] = useState<OnboardingState | null>(null)
  const [credentialStatus, setCredentialStatus] = useState<{ authOk: boolean; apiKeyOk: boolean } | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (!showOnboarding) return
    fetch('/api/onboarding')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setState(data)
          setStep(data.currentStep)
        }
      })
      .catch(() => {})
  }, [showOnboarding])

  useEffect(() => {
    if (step !== 1 || credentialStatus) return
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
  }, [step, credentialStatus])

  const completeStep = useCallback(async (stepId: string) => {
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete_step', step: stepId }),
    }).catch(() => {})
  }, [])

  const finish = useCallback(async () => {
    setClosing(true)
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete' }),
    }).catch(() => {})
    setTimeout(() => setShowOnboarding(false), 300)
  }, [setShowOnboarding])

  const skip = useCallback(async () => {
    setClosing(true)
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    }).catch(() => {})
    setTimeout(() => setShowOnboarding(false), 300)
  }, [setShowOnboarding])

  const goNext = useCallback(() => {
    const steps = state?.steps || []
    const currentId = steps[step]?.id
    if (currentId) completeStep(currentId)
    setStep(s => Math.min(s + 1, 4))
  }, [step, state, completeStep])

  const goBack = useCallback(() => setStep(s => Math.max(s - 1, 0)), [])

  if (!showOnboarding || !state) return null

  const totalSteps = 5
  const isGateway = dashboardMode === 'full' || gatewayAvailable

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={skip} />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-background border border-border/50 rounded-xl shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-0.5 bg-surface-2">
          <div
            className="h-full bg-void-cyan transition-all duration-500"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1.5 pt-4 pb-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === step ? 'bg-void-cyan' : i < step ? 'bg-void-cyan/40' : 'bg-surface-2'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-4 min-h-[320px] flex flex-col">
          {step === 0 && (
            <StepWelcome isGateway={isGateway} onNext={goNext} onSkip={skip} />
          )}
          {step === 1 && (
            <StepCredentials status={credentialStatus} onNext={goNext} onBack={goBack} navigateToPanel={navigateToPanel} onClose={() => setShowOnboarding(false)} />
          )}
          {step === 2 && (
            <StepGateway isGateway={isGateway} onNext={goNext} onBack={goBack} navigateToPanel={navigateToPanel} onClose={() => setShowOnboarding(false)} />
          )}
          {step === 3 && (
            <StepSecurity onNext={goNext} onBack={goBack} />
          )}
          {step === 4 && (
            <StepNextSteps onFinish={finish} onBack={goBack} navigateToPanel={navigateToPanel} onClose={() => setShowOnboarding(false)} />
          )}
        </div>
      </div>
    </div>
  )
}

function StepWelcome({ isGateway, onNext, onSkip }: { isGateway: boolean; onNext: () => void; onSkip: () => void }) {
  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-surface-1 border border-border/50 flex items-center justify-center shadow-lg">
          <img src="/brand/mc-logo-128.png" alt="Mission Control" className="w-full h-full object-cover" />
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-2">Welcome to Mission Control</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your open-source dashboard for AI agent orchestration. Let&apos;s get your station set up.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-1 border border-border/30">
          <span className={`w-2 h-2 rounded-full ${isGateway ? 'bg-green-400' : 'bg-void-cyan'}`} />
          <span className="text-xs text-muted-foreground">
            {isGateway ? 'Gateway mode — connected to OpenClaw' : 'Local mode — monitoring local sessions'}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-xs text-muted-foreground">
          Skip setup
        </Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Get started
        </Button>
      </div>
    </>
  )
}

function StepCredentials({
  status,
  onNext,
  onBack,
  navigateToPanel,
  onClose,
}: {
  status: { authOk: boolean; apiKeyOk: boolean } | null
  onNext: () => void
  onBack: () => void
  navigateToPanel: (panel: string) => void
  onClose: () => void
}) {
  const allGood = status?.authOk && status?.apiKeyOk

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">Credentials Check</h2>
        <p className="text-sm text-muted-foreground mb-4">Verifying your authentication configuration is secure.</p>

        {!status ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <div className="w-1.5 h-1.5 rounded-full bg-void-cyan animate-pulse" />
            Checking credentials...
          </div>
        ) : (
          <div className="space-y-3">
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${status.authOk ? 'border-green-400/20 bg-green-400/5' : 'border-red-400/20 bg-red-400/5'}`}>
              <span className={`font-mono text-sm mt-0.5 ${status.authOk ? 'text-green-400' : 'text-red-400'}`}>
                [{status.authOk ? '+' : 'x'}]
              </span>
              <div>
                <p className="text-sm font-medium">Admin Password</p>
                <p className="text-xs text-muted-foreground">
                  {status.authOk ? 'Password is strong and non-default' : 'Using a default or weak password — change AUTH_PASS in .env'}
                </p>
              </div>
            </div>

            <div className={`flex items-start gap-3 p-3 rounded-lg border ${status.apiKeyOk ? 'border-green-400/20 bg-green-400/5' : 'border-red-400/20 bg-red-400/5'}`}>
              <span className={`font-mono text-sm mt-0.5 ${status.apiKeyOk ? 'text-green-400' : 'text-red-400'}`}>
                [{status.apiKeyOk ? '+' : 'x'}]
              </span>
              <div>
                <p className="text-sm font-medium">API Key</p>
                <p className="text-xs text-muted-foreground">
                  {status.apiKeyOk ? 'API key is configured' : 'API_KEY is not set or uses the default — run: bash scripts/generate-env.sh --force'}
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
                Open Settings
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          {allGood ? 'Continue' : 'Continue anyway'}
        </Button>
      </div>
    </>
  )
}

function StepGateway({
  isGateway,
  onNext,
  onBack,
  navigateToPanel,
  onClose,
}: {
  isGateway: boolean
  onNext: () => void
  onBack: () => void
  navigateToPanel: (panel: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">Gateway Configuration</h2>
        <p className="text-sm text-muted-foreground mb-4">Connect to your OpenClaw gateway for full agent orchestration.</p>

        {isGateway ? (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-green-400/20 bg-green-400/5">
            <span className="font-mono text-sm mt-0.5 text-green-400">[+]</span>
            <div>
              <p className="text-sm font-medium">Gateway Connected</p>
              <p className="text-xs text-muted-foreground">
                OpenClaw gateway is reachable. Full orchestration features are available.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg border border-void-cyan/20 bg-void-cyan/5">
              <span className="font-mono text-sm mt-0.5 text-void-cyan">[i]</span>
              <div>
                <p className="text-sm font-medium">Local Mode Active</p>
                <p className="text-xs text-muted-foreground">
                  No gateway detected. Mission Control is monitoring local Claude Code sessions and tasks.
                  To enable full agent orchestration, install and start an OpenClaw gateway.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface-1/50 border border-border/30 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Two ways to use Mission Control:</p>
              <div className="grid gap-2 text-xs">
                <div className="flex gap-2">
                  <span className="text-void-cyan shrink-0">Local:</span>
                  <span className="text-muted-foreground">Monitor Claude Code, manage tasks, track costs — no gateway needed</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-void-cyan shrink-0">Gateway:</span>
                  <span className="text-muted-foreground">Full agent orchestration, multi-channel messaging, skill management</span>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => { onClose(); navigateToPanel('gateways') }}
            >
              Configure Gateway
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Continue
        </Button>
      </div>
    </>
  )
}

function StepSecurity({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1">Security Scan</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Check your installation&apos;s security posture across credentials, network, OpenClaw config, and runtime.
        </p>
        <SecurityScanCard />
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Continue
        </Button>
      </div>
    </>
  )
}

function StepNextSteps({
  onFinish,
  onBack,
  navigateToPanel,
  onClose,
}: {
  onFinish: () => void
  onBack: () => void
  navigateToPanel: (panel: string) => void
  onClose: () => void
}) {
  const goTo = (panel: string) => { onClose(); navigateToPanel(panel) }

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">You&apos;re All Set</h2>
        <p className="text-sm text-muted-foreground mb-4">Here&apos;s what you can do next:</p>

        <div className="space-y-2">
          {[
            { label: 'Register your first agent', panel: 'agents', desc: 'Add agents via the UI or let them self-register via API' },
            { label: 'Explore the task board', panel: 'tasks', desc: 'Kanban board for managing agent work' },
            { label: 'Browse the skills hub', panel: 'skills', desc: 'Install and manage agent skills' },
            { label: 'Configure webhooks', panel: 'webhooks', desc: 'Set up outbound notifications' },
            { label: 'Review settings', panel: 'settings', desc: 'Data retention, backups, and more' },
          ].map(item => (
            <button
              key={item.panel}
              onClick={() => goTo(item.panel)}
              className="w-full flex items-start gap-3 p-3 rounded-lg border border-border/30 hover:border-void-cyan/30 hover:bg-surface-1/50 transition-colors text-left"
            >
              <span className="text-void-cyan text-sm mt-0.5">-{'>'}</span>
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onFinish} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Finish Setup
        </Button>
      </div>
    </>
  )
}
