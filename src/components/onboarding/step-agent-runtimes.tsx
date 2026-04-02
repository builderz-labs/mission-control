'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { RuntimeSetupModal } from './runtime-setup-modal'

const HERMES_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', hermesId: 'anthropic', models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'], env: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', hermesId: 'openai-codex', oauthHermesId: 'openai-codex', supportsDeviceCode: true, models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o4-mini', 'codex-mini-latest', 'gpt-5.3-codex'], env: 'OPENAI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', hermesId: 'openrouter', models: ['anthropic/claude-sonnet-4-6', 'openai/gpt-4.1'], env: 'OPENROUTER_API_KEY' },
  { id: 'google', label: 'Google AI', hermesId: 'google', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], env: 'GOOGLE_API_KEY' },
  { id: 'nous', label: 'Nous Portal', hermesId: 'nous', models: ['hermes-3-llama-3.1-70b'], env: 'NOUS_API_KEY' },
  { id: 'xai', label: 'xAI', hermesId: 'xai', models: ['grok-3', 'grok-3-mini'], env: 'XAI_API_KEY' },
] as const

interface RuntimeStatus {
  id: string
  name: string
  description: string
  installed: boolean
  version: string | null
  running: boolean
  authRequired: boolean
  authHint: string
  authenticated: boolean
}

interface InstallJob {
  id: string
  runtime: string
  status: 'pending' | 'running' | 'success' | 'failed'
  output: string
  error: string | null
}

interface Props {
  isGateway: boolean
  onNext: () => void
  onBack: () => void
}

function modeColors(isGateway: boolean) {
  return isGateway
    ? { text: 'text-void-cyan', border: 'border-void-cyan/30', bgBtn: 'bg-void-cyan/20', hoverBg: 'hover:bg-void-cyan/30' }
    : { text: 'text-void-amber', border: 'border-void-amber/30', bgBtn: 'bg-void-amber/20', hoverBg: 'hover:bg-void-amber/30' }
}

export function StepAgentRuntimes({ isGateway, onNext, onBack }: Props) {
  const mc = modeColors(isGateway)
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([])
  const [isDocker, setIsDocker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeJobs, setActiveJobs] = useState<Record<string, InstallJob>>({})
  const [copiedYaml, setCopiedYaml] = useState<string | null>(null)
  const [setupRuntime, setSetupRuntime] = useState<'openclaw' | 'hermes' | 'claude' | 'codex' | null>(null)
  const [setupCompleted, setSetupCompleted] = useState<Set<string>>(new Set())
  const [hermesProvider, setHermesProvider] = useState('anthropic')
  const [hermesModel, setHermesModel] = useState('claude-sonnet-4-6')
  const [hermesAuthMethod, setHermesAuthMethod] = useState<'api_key' | 'device_code'>('api_key')
  const [hermesApiKey, setHermesApiKey] = useState('')
  const [hermesConfigSaved, setHermesConfigSaved] = useState(false)
  const [hermesConfigBusy, setHermesConfigBusy] = useState(false)
  const [hermesOAuthBusy, setHermesOAuthBusy] = useState(false)
  const [hermesOAuthOutput, setHermesOAuthOutput] = useState<string | null>(null)
  const [hermesOAuthError, setHermesOAuthError] = useState<string | null>(null)
  const [hermesOAuthUrl, setHermesOAuthUrl] = useState<string | null>(null)
  const [hermesOAuthCode, setHermesOAuthCode] = useState<string | null>(null)
  const [hermesMigrating, setHermesMigrating] = useState(false)
  const [hermesMigrateResult, setHermesMigrateResult] = useState<string | null>(null)
  const hermesOauthLogRef = useRef<HTMLPreElement | null>(null)
  const hermesOauthStickToBottomRef = useRef(true)
  const [showHermesOauthJump, setShowHermesOauthJump] = useState(false)

  const syncHermesOauthScrollState = useCallback(() => {
    const el = hermesOauthLogRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 12
    hermesOauthStickToBottomRef.current = atBottom
    setShowHermesOauthJump(!atBottom)
  }, [])

  useEffect(() => {
    const el = hermesOauthLogRef.current
    if (!el || !hermesOAuthOutput) return
    if (hermesOauthStickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      setShowHermesOauthJump(false)
      return
    }
    syncHermesOauthScrollState()
  }, [hermesOAuthOutput, syncHermesOauthScrollState])

  const fetchRuntimes = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-runtimes')
      if (!res.ok) return
      const data = await res.json()
      setRuntimes(data.runtimes || [])
      setIsDocker(data.isDocker || false)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRuntimes() }, [fetchRuntimes])

  // Poll active jobs
  useEffect(() => {
    const running = Object.values(activeJobs).filter(j => j.status === 'running' || j.status === 'pending')
    if (running.length === 0) return

    const interval = setInterval(async () => {
      for (const job of running) {
        try {
          const res = await fetch('/api/agent-runtimes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'job-status', jobId: job.id }),
          })
          if (!res.ok) continue
          const data = await res.json()
          if (data.job) {
            setActiveJobs(prev => ({ ...prev, [data.job.runtime]: data.job }))
            if (data.job.status === 'success' || data.job.status === 'failed') {
              fetchRuntimes()
            }
          }
        } catch {
          // ignore
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [activeJobs, fetchRuntimes])

  const handleInstall = async (runtimeId: string) => {
    try {
      const res = await fetch('/api/agent-runtimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', runtime: runtimeId, mode: 'local' }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.job) {
        setActiveJobs(prev => ({ ...prev, [runtimeId]: data.job }))
      }
    } catch {
      // ignore
    }
  }

  const handleCopyCompose = async (runtimeId: string) => {
    try {
      const res = await fetch('/api/agent-runtimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'docker-compose', runtime: runtimeId }),
      })
      if (!res.ok) return
      const data = await res.json()
      await navigator.clipboard.writeText(data.yaml)
      setCopiedYaml(runtimeId)
      setTimeout(() => setCopiedYaml(null), 2000)
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <>
        <div className="flex-1 flex items-center justify-center">
          <Loader />
        </div>
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between border-t border-border/30 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:z-auto sm:mx-0 sm:mt-6 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-sm text-muted-foreground min-h-10 px-4">Back</Button>
          <Button onClick={onNext} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg} min-h-10 px-4`}>Continue</Button>
        </div>
      </>
    )
  }

  const selectedHermesProvider = HERMES_PROVIDERS.find(p => p.id === hermesProvider)
  const supportsDeviceCode = Boolean(selectedHermesProvider && 'supportsDeviceCode' in selectedHermesProvider && selectedHermesProvider.supportsDeviceCode)
  const usesDeviceCode = supportsDeviceCode && hermesAuthMethod === 'device_code'

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">Agent Runtimes</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Install agent runtimes to run AI agents. You can skip this and install later from Settings.
        </p>

        {isDocker && (
          <div className="mb-3 p-2.5 rounded-lg border border-void-cyan/20 bg-void-cyan/5 text-sm text-muted-foreground">
            Running in Docker — install directly or use sidecar services for production.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {runtimes.map((rt) => {
            const job = activeJobs[rt.id]
            const isInstalling = job?.status === 'running' || job?.status === 'pending'
            const installFailed = job?.status === 'failed'
            const justInstalled = job?.status === 'success'

            return (
              <div
                key={rt.id}
                className={`relative rounded-lg border text-left transition-all overflow-hidden ${
                  isInstalling
                    ? 'border-primary/30 bg-primary/5'
                    : rt.installed || justInstalled
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-border/30 bg-surface-1/30'
                }`}
              >
                {/* Installing shimmer overlay */}
                {isInstalling && (
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent animate-[shimmer_2s_infinite]" style={{ backgroundSize: '200% 100%' }} />
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/20 overflow-hidden">
                      <div className="h-full bg-emerald-500/60 animate-[indeterminate_1.5s_infinite_ease-in-out]" />
                    </div>
                  </div>
                )}

                <div className="relative p-4 lg:p-5">
                  {/* Status badge */}
                  {(rt.installed || justInstalled) && !isInstalling && (
                    <span className="absolute -top-0.5 right-2 text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Detected
                    </span>
                  )}

                  {isInstalling ? (
                    /* Full-card installing state with live output */
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="relative shrink-0">
                          <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-emerald-400">
                            {rt.name.charAt(0)}
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{rt.name}</p>
                          <p className="text-2xs text-emerald-400/70">Installing...</p>
                        </div>
                      </div>
                      {/* Live output tail */}
                      {job?.output && (
                        <div className="bg-black/30 rounded px-2 py-1.5 max-h-20 overflow-y-auto">
                          <pre className="font-mono text-[10px] text-muted-foreground/60 whitespace-pre-wrap break-all leading-relaxed">
                            {job.output.trim().split('\n').slice(-6).join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className={`text-sm font-medium mb-1 ${rt.installed || justInstalled ? 'text-emerald-400' : 'text-foreground'}`}>
                        {rt.name}
                      </p>
                      <p className="text-sm text-muted-foreground mb-2 leading-relaxed">{rt.description}</p>

                      {rt.version && (
                        <p className="text-2xs text-muted-foreground/60 mb-1">v{rt.version}</p>
                      )}

                      {/* Auth status */}
                      {rt.installed && rt.authRequired && (
                        <p className={`text-2xs mb-1 ${rt.authenticated ? 'text-emerald-400/70' : 'text-amber-400'}`}>
                          {rt.authenticated ? 'Authenticated' : rt.authHint}
                        </p>
                      )}

                      {/* Configure button for non-hermes runtimes (hermes has inline config below) */}
                      {rt.id !== 'hermes' && (rt.installed || justInstalled) && !setupCompleted.has(rt.id) && (
                        <button
                          onClick={() => setSetupRuntime(rt.id as 'openclaw' | 'hermes' | 'claude' | 'codex')}
                          className="text-2xs mt-1.5 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                          Configure {rt.name}
                        </button>
                      )}

                      {/* Hermes inline quick config */}
                      {rt.id === 'hermes' && (rt.installed || justInstalled) && !hermesConfigSaved && (
                        <div className="mt-2.5 p-3.5 rounded-lg border border-border/20 bg-black/10 space-y-3">
                          <p className="text-[11px] text-muted-foreground/65 uppercase tracking-wider">Quick Setup</p>

                          {/* Provider + Model dropdowns */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            <select
                              value={hermesProvider}
                              onChange={(e) => {
                                const p = HERMES_PROVIDERS.find(pr => pr.id === e.target.value)
                                setHermesProvider(e.target.value)
                                setHermesModel(p?.models[0] || '')
                                const nextSupportsDeviceCode = Boolean(p && 'supportsDeviceCode' in p && p.supportsDeviceCode)
                                setHermesAuthMethod(nextSupportsDeviceCode ? 'device_code' : 'api_key')
                                setHermesOAuthOutput(null)
                                setHermesOAuthError(null)
                                setHermesOAuthUrl(null)
                                setHermesOAuthCode(null)
                              }}
                              aria-label="Select Hermes provider"
                              className="h-9 rounded border border-border/20 bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                            >
                              {HERMES_PROVIDERS.map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                              ))}
                            </select>
                            <select
                              value={hermesModel}
                              onChange={(e) => setHermesModel(e.target.value)}
                              aria-label="Select Hermes model"
                              className="h-9 rounded border border-border/20 bg-card px-2.5 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
                            >
                              {(HERMES_PROVIDERS.find(p => p.id === hermesProvider)?.models || []).map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>

                          {/* Authorization method */}
                          {supportsDeviceCode && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                aria-label="Use device code authentication"
                                onClick={() => setHermesAuthMethod('device_code')}
                                className={`h-9 rounded border px-2 text-xs font-medium transition-colors ${
                                  hermesAuthMethod === 'device_code'
                                    ? 'border-primary/40 bg-primary/15 text-primary'
                                    : 'border-border/20 bg-card text-muted-foreground hover:border-primary/20'
                                }`}
                              >
                                Device code (headless)
                              </button>
                              <button
                                type="button"
                                aria-label="Use API key authentication"
                                onClick={() => setHermesAuthMethod('api_key')}
                                className={`h-9 rounded border px-2 text-xs font-medium transition-colors ${
                                  hermesAuthMethod === 'api_key'
                                    ? 'border-primary/40 bg-primary/15 text-primary'
                                    : 'border-border/20 bg-card text-muted-foreground hover:border-primary/20'
                                }`}
                              >
                                API key
                              </button>
                            </div>
                          )}

                          {/* API Key or OAuth */}
                          {usesDeviceCode ? (
                            <div className="p-3 rounded-lg border border-border/15 bg-black/10 text-xs text-muted-foreground/65 space-y-2">
                              <p>OAuth uses device code flow:</p>
                              <div className="flex items-center gap-2 bg-black/20 rounded px-2.5 py-1.5 font-mono text-xs">
                                <span className="text-muted-foreground/50">$</span>
                                <span className="flex-1 text-foreground/80">hermes login</span>
                                <button
                                  type="button"
                                  aria-label="Start Hermes device code authentication"
                                  disabled={hermesOAuthBusy}
                                  onClick={async () => {
                                    setHermesOAuthBusy(true)
                                    setHermesOAuthOutput(null)
                                    setHermesOAuthError(null)
                                    setHermesOAuthUrl(null)
                                    setHermesOAuthCode(null)
                                    try {
                                      const hp = HERMES_PROVIDERS.find(p => p.id === hermesProvider)
                                      const res = await fetch('/api/hermes', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          action: 'run-oauth-model',
                                          model: hermesModel,
                                          provider: (hp && 'oauthHermesId' in hp ? hp.oauthHermesId : hp?.hermesId) || hermesProvider,
                                          authMethod: 'device_code',
                                        }),
                                      })
                                      const data = await res.json()
                                      if (typeof data.deviceUrl === 'string' && data.deviceUrl) setHermesOAuthUrl(data.deviceUrl)
                                      if (typeof data.userCode === 'string' && data.userCode) setHermesOAuthCode(data.userCode)
                                      if (res.ok && data.success) {
                                        setHermesOAuthOutput(data.output || 'Authentication complete. You can continue.')
                                      } else {
                                        setHermesOAuthError(data.error || 'OAuth command failed')
                                        if (data.output) setHermesOAuthOutput(data.output)
                                      }
                                    } catch (err) {
                                      setHermesOAuthError(err instanceof Error ? err.message : 'OAuth command failed')
                                    } finally {
                                      setHermesOAuthBusy(false)
                                    }
                                  }}
                                  className="text-[11px] px-2.5 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
                                >
                                  {hermesOAuthBusy ? 'Waiting...' : 'Start auth'}
                                </button>
                              </div>
                              <p className="text-xs text-muted-foreground/55 leading-relaxed">No API key needed. Start auth, open the link, paste the code, then return here while terminal waits for completion.</p>
                              {hermesOAuthUrl && (
                                <a
                                  href={hermesOAuthUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex text-[9px] text-primary/90 underline underline-offset-2 hover:text-primary"
                                >
                                  Open device login link
                                </a>
                              )}
                              {hermesOAuthCode && (
                                <div className="bg-black/20 rounded px-2 py-1.5">
                                  <p className="text-[9px] text-muted-foreground/50 mb-1">Device code</p>
                                  <code className="text-[10px] text-foreground font-mono tracking-wide">{hermesOAuthCode}</code>
                                </div>
                              )}
                              {hermesOAuthBusy && (
                                <p className="text-[9px] text-primary/80">Waiting for authentication confirmation...</p>
                              )}
                              {hermesOAuthOutput && (
                                <div className="relative">
                                  <pre
                                    ref={hermesOauthLogRef}
                                    onScroll={syncHermesOauthScrollState}
                                    className="max-h-24 overflow-y-auto rounded border border-border/20 bg-black/25 px-2.5 py-1.5 text-[10px] text-muted-foreground/80 whitespace-pre-wrap break-all"
                                    aria-label="Hermes OAuth terminal output"
                                  >
                                    {hermesOAuthOutput}
                                  </pre>
                                  {showHermesOauthJump && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!hermesOauthLogRef.current) return
                                        hermesOauthLogRef.current.scrollTop = hermesOauthLogRef.current.scrollHeight
                                        hermesOauthStickToBottomRef.current = true
                                        setShowHermesOauthJump(false)
                                      }}
                                      className="absolute bottom-1.5 right-1.5 rounded border border-primary/30 bg-background/90 px-2 py-0.5 text-[10px] text-primary hover:bg-background"
                                    >
                                      Jump to latest
                                    </button>
                                  )}
                                </div>
                              )}
                              {hermesOAuthError && <p className="text-[9px] text-red-400">{hermesOAuthError}</p>}
                            </div>
                          ) : (
                            <input
                              type="password"
                              value={hermesApiKey}
                              onChange={(e) => setHermesApiKey(e.target.value)}
                              placeholder={`${HERMES_PROVIDERS.find(p => p.id === hermesProvider)?.label || ''} API key`}
                              className="w-full h-7 rounded border border-border/20 bg-card px-2 text-[10px] text-foreground font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
                            />
                          )}

                          {/* Save button */}
                          <button
                            type="button"
                            disabled={hermesConfigBusy}
                            onClick={async () => {
                              setHermesConfigBusy(true)
                              try {
                                const hp = HERMES_PROVIDERS.find(p => p.id === hermesProvider)
                                const providerForConfig = usesDeviceCode
                                  ? (hp && 'oauthHermesId' in hp ? hp.oauthHermesId : hp?.hermesId) || hermesProvider
                                  : hp?.hermesId || hermesProvider
                                // Set provider + model
                                await fetch('/api/hermes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run-command', command: `hermes config set model.provider ${providerForConfig}` }) })
                                await fetch('/api/hermes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run-command', command: `hermes config set model.default ${hermesModel}` }) })
                                // Save API key if provided and auth method requires it
                                if (!usesDeviceCode && hermesApiKey.trim() && hp?.env) {
                                  await fetch('/api/hermes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-env', key: hp.env, value: hermesApiKey }) })
                                }
                                setHermesConfigSaved(true)
                              } catch { /* ignore */ }
                              setHermesConfigBusy(false)
                            }}
                            className="w-full h-9 rounded border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                          >
                            {hermesConfigBusy ? 'Saving...' : 'Apply Configuration'}
                          </button>

                          {/* OpenClaw migration option */}
                          {runtimes.find(r => r.id === 'openclaw')?.installed && (
                            <div className="pt-1.5 border-t border-border/10">
                              <button
                                type="button"
                                disabled={hermesMigrating}
                                onClick={async () => {
                                  setHermesMigrating(true)
                                  setHermesMigrateResult(null)
                                  try {
                                    const res = await fetch('/api/hermes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run-command', command: 'hermes claw migrate --preset user-data' }) })
                                    const data = await res.json()
                                    setHermesMigrateResult(data.success ? 'Migration complete' : (data.error || 'Migration failed'))
                                  } catch { setHermesMigrateResult('Migration failed') }
                                  setHermesMigrating(false)
                                }}
                                className="text-2xs text-amber-400/70 hover:text-amber-400 transition-colors"
                              >
                                {hermesMigrating ? 'Migrating...' : 'Migrate from OpenClaw'}
                              </button>
                              {hermesMigrateResult && (
                                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{hermesMigrateResult}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {hermesConfigSaved && rt.id === 'hermes' && (
                        <p className="text-2xs text-emerald-400/70 mt-1">Provider configured</p>
                      )}

                      {/* Install actions */}
                      {!rt.installed && !justInstalled && (
                        <div className="mt-2">
                          {installFailed ? (
                            <div className="space-y-1">
                              <p className="text-2xs text-red-400">Install failed: {job?.error || 'Unknown error'}</p>
                              <button
                                onClick={() => handleInstall(rt.id)}
                                className="text-2xs px-2 py-1 rounded border border-border/40 hover:border-border/60 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Retry
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleInstall(rt.id)}
                                className={`text-2xs px-2 py-1 rounded border ${mc.border} ${mc.bgBtn} ${mc.text} ${mc.hoverBg} transition-colors`}
                              >
                                Install
                              </button>
                              {isDocker && (
                                <button
                                  onClick={() => handleCopyCompose(rt.id)}
                                  className="text-2xs px-2 py-1 rounded border border-border/40 hover:border-border/60 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {copiedYaml === rt.id ? 'Copied!' : 'Sidecar YAML'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between border-t border-border/30 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:z-auto sm:mx-0 sm:mt-6 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-sm text-muted-foreground min-h-10 px-4">Back</Button>
        <Button onClick={onNext} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg} min-h-10 px-4`}>
          Continue
        </Button>
      </div>

      {setupRuntime && (
        <RuntimeSetupModal
          runtime={setupRuntime}
          onClose={() => setSetupRuntime(null)}
          onComplete={() => {
            setSetupCompleted(prev => new Set([...prev, setupRuntime]))
            setSetupRuntime(null)
            fetchRuntimes()
          }}
        />
      )}
    </>
  )
}
