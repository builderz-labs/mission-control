'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

interface RuntimeSetupModalProps {
  runtime: 'openclaw' | 'hermes' | 'claude' | 'codex'
  onClose: () => void
  onComplete: () => void
}

export function RuntimeSetupModal({ runtime, onClose, onComplete }: RuntimeSetupModalProps) {
  const SetupComponent = {
    openclaw: OpenClawSetup,
    hermes: HermesSetup,
    claude: ClaudeSetup,
    codex: CodexSetup,
  }[runtime]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-card border border-border rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl shadow-black/30">
        <SetupComponent onClose={onClose} onComplete={onComplete} />
      </div>
    </div>
  )
}

// ─── OpenClaw Setup ──────────────────────────────────────────────────────

function OpenClawSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'onboard' | 'verify' | 'done'>('onboard')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [healthStatus, setHealthStatus] = useState<any>(null)

  const runOnboard = useCallback(async () => {
    setRunning(true)
    setError(null)
    setOutput('')
    try {
      const res = await fetch('/api/agent-runtimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', runtime: 'openclaw', mode: 'local' }),
      })
      // The onboard command runs as part of post-install in agent-runtimes.ts
      // Let's use the doctor endpoint to check health instead
      const doctorRes = await fetch('/api/openclaw/doctor')
      if (doctorRes.ok) {
        const data = await doctorRes.json()
        setHealthStatus(data)
        if (data.healthy) {
          setStep('done')
        } else {
          setStep('verify')
          setOutput(data.issues?.join('\n') || 'Some issues detected')
        }
      } else {
        setStep('verify')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setRunning(false)
    }
  }, [])

  const runDoctorFix = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/openclaw/doctor', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          setStep('done')
          setOutput('All issues resolved')
        } else {
          setOutput(data.output || 'Fix attempt completed with warnings')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Doctor fix failed')
    } finally {
      setRunning(false)
    }
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/doctor')
      if (res.ok) {
        const data = await res.json()
        setHealthStatus(data)
        if (data.healthy) setStep('done')
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => { checkHealth() }, [checkHealth])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up OpenClaw</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure the gateway and verify connectivity</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['onboard', 'verify', 'done'] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              step === s ? 'bg-primary text-primary-foreground' :
              (['onboard', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/20 text-green-400' :
              'bg-secondary text-muted-foreground'
            }`}>
              {(['onboard', 'verify', 'done'].indexOf(step) > i) ? (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
              ) : i + 1}
            </div>
            {i < 2 && <div className={`w-8 h-px ${(['onboard', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/40' : 'bg-border/30'}`} />}
          </div>
        ))}
      </div>

      {step === 'onboard' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-lg">1</span>
              <div>
                <p className="text-sm font-medium">Health Check</p>
                <p className="text-xs text-muted-foreground">Run OpenClaw doctor to check gateway configuration and connectivity.</p>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {healthStatus?.healthy && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 text-xs text-green-400">
              OpenClaw is healthy and properly configured.
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            <Button size="sm" onClick={runOnboard} disabled={running}>
              {running ? 'Checking...' : 'Run Health Check'}
            </Button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-2">
            <p className="text-sm font-medium text-amber-400">Issues Detected</p>
            {healthStatus?.issues?.map((issue: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground">- {issue}</p>
            ))}
            {output && <pre className="text-xs text-muted-foreground/70 whitespace-pre-wrap mt-2">{output}</pre>}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip for now</Button>
            <Button size="sm" onClick={runDoctorFix} disabled={running}>
              {running ? 'Fixing...' : 'Auto-Fix Issues'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">OpenClaw is ready</p>
            <p className="text-xs text-muted-foreground">Gateway is configured and healthy. Agents can now connect.</p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Hermes Setup ────────────────────────────────────────────────────────

function HermesSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'hook' | 'provider' | 'identity' | 'gateway' | 'ready'>('hook')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hermesStatus, setHermesStatus] = useState<any>(null)
  const [providerKey, setProviderKey] = useState('')
  const [providerType, setProviderType] = useState<'anthropic' | 'openai' | 'openrouter' | 'nous' | 'google' | 'xai'>('anthropic')
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6')
  const [customModel, setCustomModel] = useState('')
  const [authMethod, setAuthMethod] = useState<'api_key' | 'device_code'>('api_key')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthOutput, setOauthOutput] = useState<string | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [oauthUrl, setOauthUrl] = useState<string | null>(null)
  const [oauthCode, setOauthCode] = useState<string | null>(null)
  const [providerSaved, setProviderSaved] = useState(false)
  const [soulContent, setSoulContent] = useState('')
  const oauthOutputRef = useRef<HTMLPreElement | null>(null)
  const oauthStickToBottomRef = useRef(true)
  const [showOauthJump, setShowOauthJump] = useState(false)

  const syncOauthScrollState = useCallback(() => {
    const el = oauthOutputRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 12
    oauthStickToBottomRef.current = atBottom
    setShowOauthJump(!atBottom)
  }, [])

  useEffect(() => {
    const el = oauthOutputRef.current
    if (!el || !oauthOutput) return
    if (oauthStickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      setShowOauthJump(false)
      return
    }
    syncOauthScrollState()
  }, [oauthOutput, syncOauthScrollState])

  const resetOAuthState = useCallback(() => {
    setOauthBusy(false)
    setOauthOutput(null)
    setOauthError(null)
    setOauthUrl(null)
    setOauthCode(null)
    oauthStickToBottomRef.current = true
    setShowOauthJump(false)
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes')
      if (res.ok) {
        const data = await res.json()
        setHermesStatus(data)
        if (data.hookInstalled && step === 'hook') {
          setStep('provider')
        }
      }
    } catch {
      // ignore
    }
  }, [step])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  useEffect(() => {
    if (providerType !== 'openai' && authMethod !== 'api_key') {
      setAuthMethod('api_key')
    }
  }, [providerType, authMethod])

  useEffect(() => {
    if (step !== 'provider') resetOAuthState()
  }, [step, resetOAuthState])

  useEffect(() => {
    if (authMethod !== 'device_code') resetOAuthState()
  }, [authMethod, resetOAuthState])

  const installHook = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install-hook' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to install hook')
      }
      await fetchStatus()
      setStep('provider')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install hook')
    } finally {
      setRunning(false)
    }
  }, [fetchStatus])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up Hermes</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Connect Hermes agent to Mission Control</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      {(() => {
        const steps = ['hook', 'provider', 'identity', 'gateway', 'ready'] as const
        const currentIdx = steps.indexOf(step)
        const labels = ['Hook', 'Provider', 'Identity', 'Gateway', 'Ready']
        return (
          <div className="flex items-center gap-1.5 mb-6">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                  step === s ? 'bg-primary text-primary-foreground' :
                  currentIdx > i ? 'bg-green-500/20 text-green-400' :
                  'bg-secondary text-muted-foreground/50'
                }`}>
                  {currentIdx > i ? (
                    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
                  ) : i + 1}
                </div>
                <span className={`text-[10px] ${step === s ? 'text-foreground' : 'text-muted-foreground/40'}`}>{labels[i]}</span>
                {i < steps.length - 1 && <div className={`w-4 h-px ${currentIdx > i ? 'bg-green-500/40' : 'bg-border/20'}`} />}
              </div>
            ))}
          </div>
        )
      })()}

      {step === 'hook' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20 space-y-3">
            <p className="text-sm font-medium">Install Mission Control Hook</p>
            <p className="text-xs text-muted-foreground">
              This installs a hook in <code className="text-[11px] bg-black/20 px-1 rounded">~/.hermes/hooks/mission-control/</code> that
              reports agent activity, session events, and status updates to Mission Control.
            </p>
            <div className="text-xs text-muted-foreground/60 space-y-1">
              <p>The hook will:</p>
              <ul className="list-disc list-inside pl-2 space-y-0.5">
                <li>Register Hermes agents automatically on start</li>
                <li>Report session lifecycle events</li>
                <li>Enable task dispatching from Mission Control</li>
              </ul>
            </div>
          </div>

          {hermesStatus && !hermesStatus.hookInstalled && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-400">
              Hook is not installed yet.
            </div>
          )}

          {hermesStatus?.hookInstalled && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 text-xs text-green-400">
              Hook is already installed.
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            {hermesStatus?.hookInstalled ? (
              <Button size="sm" onClick={() => setStep('provider')}>Next</Button>
            ) : (
              <Button size="sm" onClick={installHook} disabled={running}>
                {running ? 'Installing...' : 'Install Hook'}
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 'provider' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">Configure LLM Provider</p>
            <p className="text-xs text-muted-foreground">Hermes needs an API key to talk to an LLM. Choose your provider:</p>
          </div>

          {(() => {
            const PROVIDERS = [
              { id: 'anthropic', label: 'Anthropic', hint: 'Claude', env: 'ANTHROPIC_API_KEY', hermesProvider: 'anthropic', models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-5'] },
              { id: 'openai', label: 'OpenAI', hint: 'GPT / o-series / Codex', env: 'OPENAI_API_KEY', hermesProvider: 'openai-codex', oauthHermesProvider: 'openai-codex', supportsDeviceCode: true, models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o4-mini', 'codex-mini-latest', 'gpt-5.3-codex'] },
              { id: 'openrouter', label: 'OpenRouter', hint: '200+ models', env: 'OPENROUTER_API_KEY', hermesProvider: 'openrouter', models: ['anthropic/claude-sonnet-4-6', 'openai/gpt-4.1', 'google/gemini-2.5-pro', 'meta-llama/llama-4-maverick', 'deepseek/deepseek-r1'] },
              { id: 'google', label: 'Google AI', hint: 'Gemini', env: 'GOOGLE_API_KEY', hermesProvider: 'google', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
              { id: 'nous', label: 'Nous Portal', hint: 'Free tier', env: 'NOUS_API_KEY', hermesProvider: 'nous', models: ['hermes-3-llama-3.1-70b', 'hermes-3-llama-3.1-8b', 'deephermes-3-llama-3.3-70b'] },
              { id: 'xai', label: 'xAI', hint: 'Grok', env: 'XAI_API_KEY', hermesProvider: 'xai', models: ['grok-3', 'grok-3-mini', 'grok-2'] },
            ] as const
            const currentProvider = PROVIDERS.find(p => p.id === providerType)
            const providerModels = currentProvider?.models || []
            const supportsDeviceCode = Boolean(currentProvider && 'supportsDeviceCode' in currentProvider && currentProvider.supportsDeviceCode)
            const usesDeviceCode = supportsDeviceCode && authMethod === 'device_code'
            const hermesProviderName = (usesDeviceCode
              ? (currentProvider && 'oauthHermesProvider' in currentProvider ? currentProvider.oauthHermesProvider : currentProvider?.hermesProvider)
              : currentProvider?.hermesProvider) || 'anthropic'

            return (<>
          {/* Provider cards */}
          <div className="grid grid-cols-3 gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProviderType(p.id)
                  setSelectedModel(p.models[0] || '')
                  setCustomModel('')
                  const nextSupportsDeviceCode = Boolean('supportsDeviceCode' in p && p.supportsDeviceCode)
                  setAuthMethod(nextSupportsDeviceCode ? 'device_code' : 'api_key')
                  resetOAuthState()
                }}
                className={`px-3 py-2.5 rounded-lg border text-left text-sm min-h-11 transition-colors ${
                  providerType === p.id
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border/20 bg-secondary/10 text-muted-foreground hover:border-border/40'
                }`}
              >
                <span className="font-medium text-[11px]">{p.label}</span>
                <span className="block text-[10px] text-muted-foreground/50">{p.hint}</span>
              </button>
            ))}
          </div>

          {/* Model grid */}
          <div>
            <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider block mb-1.5">Model</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {providerModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setSelectedModel(m); setCustomModel('') }}
                  className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                    selectedModel === m && !customModel
                      ? 'bg-primary/15 border border-primary/30 text-foreground'
                      : 'bg-black/15 border border-border/10 text-muted-foreground/60 hover:text-foreground hover:border-border/30'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customModel}
              onChange={(e) => { setCustomModel(e.target.value); if (e.target.value) setSelectedModel(e.target.value) }}
              placeholder="Custom model..."
              className="w-full h-6 rounded border border-border/20 bg-black/10 px-2 text-[10px] text-foreground font-mono placeholder:text-muted-foreground/20 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Apply config */}
          <div className="p-2.5 rounded-lg border border-border/15 bg-secondary/5 text-xs space-y-1.5">
            <CopyableCommand command={`hermes config set model.provider ${hermesProviderName}`} label="Provider" runnable />
            <CopyableCommand command={`hermes config set model.default ${customModel || selectedModel}`} label="Model" runnable />
          </div>

          {/* Authorization method */}
          {supportsDeviceCode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <button
                type="button"
                aria-label="Use device code authentication"
                onClick={() => {
                  setAuthMethod('device_code')
                  resetOAuthState()
                }}
                className={`h-7 rounded border text-[10px] transition-colors ${
                  authMethod === 'device_code'
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border/20 bg-card text-muted-foreground hover:border-primary/20'
                }`}
              >
                Device code (headless)
              </button>
              <button
                type="button"
                aria-label="Use API key authentication"
                onClick={() => {
                  setAuthMethod('api_key')
                  resetOAuthState()
                }}
                className={`h-7 rounded border text-[10px] transition-colors ${
                  authMethod === 'api_key'
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border/20 bg-card text-muted-foreground hover:border-primary/20'
                }`}
              >
                API key
              </button>
            </div>
          )}

          {usesDeviceCode ? (
            <div className="p-2.5 rounded-lg border border-border/15 bg-secondary/5 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Device authentication</p>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Start Hermes device code authentication"
                  className="h-6 px-2 text-[10px]"
                  disabled={oauthBusy}
                  onClick={async () => {
                    setOauthBusy(true)
                    setOauthOutput(null)
                    setOauthError(null)
                    setOauthUrl(null)
                    setOauthCode(null)
                    try {
                      const providerForOAuth = (currentProvider && 'oauthHermesProvider' in currentProvider ? currentProvider.oauthHermesProvider : currentProvider?.hermesProvider) || providerType
                      const res = await fetch('/api/hermes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'run-oauth-model', provider: providerForOAuth, model: customModel || selectedModel, authMethod: 'device_code' }),
                      })
                      const data = await res.json().catch(() => ({}))
                      if (typeof data.deviceUrl === 'string' && data.deviceUrl) setOauthUrl(data.deviceUrl)
                      if (typeof data.userCode === 'string' && data.userCode) setOauthCode(data.userCode)
                      if (res.ok && data.success) {
                        setOauthOutput(data.output || 'Authentication complete. You can continue.')
                      } else {
                        setOauthError(data.error || 'OAuth command failed')
                        if (data.output) setOauthOutput(data.output)
                      }
                    } catch (err) {
                      setOauthError(err instanceof Error ? err.message : 'OAuth command failed')
                    } finally {
                      setOauthBusy(false)
                    }
                  }}
                >
                  {oauthBusy ? 'Waiting...' : 'Start auth'}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/40">No API key needed. Start auth, open the link, paste the code, then return here while terminal waits for completion.</p>
              {oauthUrl && (
                <a
                  href={oauthUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-[10px] text-primary/90 underline underline-offset-2 hover:text-primary"
                >
                  Open device login link
                </a>
              )}
              {oauthCode && (
                <div className="bg-black/20 rounded px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground/60 mb-1">Device code</p>
                  <code className="text-[10px] text-foreground font-mono tracking-wide">{oauthCode}</code>
                </div>
              )}
              {oauthBusy && <p className="text-[10px] text-primary/80">Waiting for authentication confirmation...</p>}
              {oauthOutput && (
                <div className="relative">
                  <pre
                    ref={oauthOutputRef}
                    onScroll={syncOauthScrollState}
                    className="max-h-24 overflow-y-auto rounded border border-border/20 bg-black/25 px-2.5 py-1.5 text-[10px] text-muted-foreground/80 whitespace-pre-wrap break-all"
                    aria-label="OAuth terminal output"
                  >
                    {oauthOutput}
                  </pre>
                  {showOauthJump && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!oauthOutputRef.current) return
                        oauthOutputRef.current.scrollTop = oauthOutputRef.current.scrollHeight
                        oauthStickToBottomRef.current = true
                        setShowOauthJump(false)
                      }}
                      className="absolute bottom-1.5 right-1.5 rounded border border-primary/30 bg-background/90 px-2 py-0.5 text-[10px] text-primary hover:bg-background"
                    >
                      Jump to latest
                    </button>
                  )}
                </div>
              )}
              {oauthError && <p className="text-[10px] text-red-400">{oauthError}</p>}
            </div>
          ) : (
            <div>
              <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider block mb-1">
                {currentProvider?.label} API Key
              </label>
              <input
                type="password"
                value={providerKey}
                onChange={(e) => setProviderKey(e.target.value)}
                placeholder={`sk-...`}
                className="w-full h-9 rounded border border-border/30 bg-surface-1 px-2.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono"
              />
              <p className="text-[10px] text-muted-foreground/30 mt-0.5">
                Saved to ~/.hermes/.env
              </p>
            </div>
          )}
          </>)
          })()}

          {providerSaved && authMethod !== 'device_code' && (
            <div className="p-2.5 rounded-lg border border-green-500/20 bg-green-500/5 text-xs text-green-400">
              Provider key saved successfully.
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('hook')}>Back</Button>
            <Button variant="ghost" size="sm" onClick={() => setStep('identity')}>Skip</Button>
            <Button
              size="sm"
              disabled={running}
              onClick={async () => {
                setRunning(true)
                setError(null)
                try {
                  const envMap: Record<string, string> = {
                    anthropic: 'ANTHROPIC_API_KEY',
                    openai: 'OPENAI_API_KEY',
                    openrouter: 'OPENROUTER_API_KEY',
                    nous: 'NOUS_API_KEY',
                    google: 'GOOGLE_API_KEY',
                    xai: 'XAI_API_KEY',
                  }
                  if (authMethod !== 'device_code' && providerKey.trim()) {
                    const res = await fetch('/api/hermes', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'set-env', key: envMap[providerType], value: providerKey }),
                    })
                    if (res.ok) {
                      setProviderSaved(true)
                    } else {
                      const data = await res.json().catch(() => ({}))
                      throw new Error(data.error || 'Failed to save')
                    }
                  }
                  setStep('identity')
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to save provider key')
                } finally {
                  setRunning(false)
                }
              }}
            >
              {running ? 'Saving...' : (authMethod !== 'device_code' && providerKey.trim()) ? 'Save & Continue' : 'Continue'}
            </Button>
          </div>
        </div>
      )}

      {step === 'identity' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">Agent Identity (Optional)</p>
            <p className="text-xs text-muted-foreground">
              Customize how Hermes communicates. This is saved as <code className="text-[11px] bg-black/20 px-1 rounded">~/.hermes/SOUL.md</code>
            </p>
          </div>

          <textarea
            value={soulContent}
            onChange={(e) => setSoulContent(e.target.value)}
            placeholder="Example: You are a concise technical expert who communicates clearly and directly. You focus on actionable solutions."
            rows={4}
            className="w-full rounded border border-border/40 bg-surface-1 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />

          <p className="text-[10px] text-muted-foreground/40">
            Leave blank to use the default personality. You can change this anytime.
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('provider')}>Back</Button>
            <Button
              size="sm"
              onClick={async () => {
                if (soulContent.trim()) {
                  try {
                    await fetch('/api/hermes', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'set-soul', content: soulContent }),
                    })
                  } catch {
                    // non-critical
                  }
                }
                setStep('gateway')
              }}
            >
              {soulContent.trim() ? 'Save & Continue' : 'Skip'}
            </Button>
          </div>
        </div>
      )}

      {step === 'gateway' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">Gateway & Channels</p>
            <p className="text-xs text-muted-foreground">
              The gateway lets you talk to Hermes from Telegram, Discord, Slack, WhatsApp, and Signal.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <StatusCard label="Gateway" ok={hermesStatus?.gatewayRunning} subtitle={hermesStatus?.gatewayRunning ? 'Running' : 'Not started'} />
            <StatusCard label="Sessions" value={hermesStatus?.activeSessions || 0} ok={true} />
          </div>

          <div className="p-3 rounded-lg border border-border/20 bg-secondary/10 text-xs space-y-2.5">
            <p className="font-medium text-foreground/80">Set up messaging channels:</p>

            <div className="space-y-2.5">
              <CopyableCommand command="hermes status" label="Check status" runnable />
              <CopyableCommand command="hermes doctor" label="Diagnose" runnable />
              <p className="text-[10px] text-muted-foreground/50 mt-2">
                The messaging gateway requires an interactive terminal to configure platforms (Telegram, Discord, Slack, WhatsApp, Signal).
                Run in a terminal:
              </p>
              <div className="bg-black/20 rounded px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground/60 space-y-0.5">
                <p>$ hermes gateway setup  <span className="text-muted-foreground/30"># configure platforms</span></p>
                <p>$ hermes gateway run    <span className="text-muted-foreground/30"># start in foreground (Docker, no systemd)</span></p>
                <p>$ hermes gateway start  <span className="text-muted-foreground/30"># install as service (bare metal, requires systemd)</span></p>
              </div>
            </div>

            <div className="mt-2 pt-2 border-t border-border/10">
              <p className="text-muted-foreground/50 text-[10px]">
                Supported: Telegram, Discord, Slack, WhatsApp, Signal, Email.
                Each platform needs a bot token — run gateway setup for guided configuration.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('identity')}>Back</Button>
            <Button size="sm" onClick={() => { fetchStatus(); setStep('ready') }}>
              {hermesStatus?.gatewayRunning ? 'Continue' : 'Skip for now'}
            </Button>
          </div>
        </div>
      )}

      {step === 'ready' && (
        <div className="space-y-4">
          <div className="p-5 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-3">
            <div className="text-3xl">+</div>
            <p className="text-sm font-semibold text-green-400">Hermes is ready</p>
            <p className="text-xs text-muted-foreground">
              Hook installed{providerSaved ? ', provider configured' : ''}{soulContent.trim() ? ', identity set' : ''}.
              {hermesStatus?.cronJobCount > 0 && ` ${hermesStatus.cronJobCount} cron jobs detected.`}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border/20 bg-secondary/10 text-xs space-y-3">
            <p className="font-medium text-foreground/80">Quick commands:</p>
            <CopyableCommand command="hermes status" label="Check status" runnable />
            <CopyableCommand command="hermes doctor" label="Diagnose" runnable />
            <CopyableCommand command="hermes version" label="Version" runnable />
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}

    </div>
  )
}

function CopyableCommand({ command, label, runnable = false, onOutput }: {
  command: string
  label: string
  runnable?: boolean
  onOutput?: (output: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const outputStickToBottomRef = useRef(true)
  const [showOutputJump, setShowOutputJump] = useState(false)

  const syncOutputScrollState = useCallback(() => {
    const el = outputRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 12
    outputStickToBottomRef.current = atBottom
    setShowOutputJump(!atBottom)
  }, [])

  useEffect(() => {
    const el = outputRef.current
    if (!el || !output) return
    if (outputStickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      setShowOutputJump(false)
      return
    }
    syncOutputScrollState()
  }, [output, syncOutputScrollState])

  const handleRun = async () => {
    setRunning(true)
    setOutput(null)
    setError(null)
    outputStickToBottomRef.current = true
    setShowOutputJump(false)
    try {
      const res = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-command', command }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setOutput(data.output || 'Done')
        onOutput?.(data.output || '')
      } else {
        setError(data.error || 'Command failed')
        if (data.output) setOutput(data.output)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run command')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-black/20 rounded px-2.5 py-1.5 font-mono text-[11px] flex items-center justify-between gap-2">
          <div>
            <span className="text-muted-foreground/50">$ </span>
            <span className="text-foreground/80">{command}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {runnable && (
              <button
                type="button"
                onClick={handleRun}
                disabled={running}
                className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
              >
                {running ? 'Running...' : 'Run'}
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(command)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground/50 w-32 shrink-0">{label}</span>
      </div>
      {output && (
        <div className="relative">
          <div
            ref={outputRef}
            onScroll={syncOutputScrollState}
            className="max-h-16 overflow-y-auto rounded border border-border/20 bg-black/30 px-2 py-1.5 ml-0"
            aria-label={`${label} command output`}
          >
            <pre className="font-mono text-[10px] text-muted-foreground/70 whitespace-pre-wrap break-all">{output}</pre>
          </div>
          {showOutputJump && (
            <button
              type="button"
              onClick={() => {
                if (!outputRef.current) return
                outputRef.current.scrollTop = outputRef.current.scrollHeight
                outputStickToBottomRef.current = true
                setShowOutputJump(false)
              }}
              className="absolute bottom-1.5 right-1.5 rounded border border-primary/30 bg-background/90 px-2 py-0.5 text-[10px] text-primary hover:bg-background"
            >
              Jump to latest
            </button>
          )}
        </div>
      )}
      {error && <p className="text-[10px] text-red-400 ml-0">{error}</p>}
    </div>
  )
}

// ─── Claude Code Setup ──────────────────────────────────────────────────

function ClaudeSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'check' | 'auth' | 'done'>('check')
  const [checking, setChecking] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const res = await fetch('/api/agent-runtimes')
      if (res.ok) {
        const data = await res.json()
        const claude = (data.runtimes || []).find((r: any) => r.id === 'claude')
        if (claude) {
          setAuthenticated(claude.authenticated)
          setVersion(claude.version)
          if (claude.authenticated) setStep('done')
          else setStep('auth')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { checkAuth() }, [checkAuth])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up Claude Code</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Authenticate the Anthropic CLI agent</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['check', 'auth', 'done'] as const).map((s, i) => {
          const labels = ['Check', 'Authenticate', 'Ready']
          const currentIdx = (['check', 'auth', 'done'] as const).indexOf(step)
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s ? 'bg-primary text-primary-foreground' :
                currentIdx > i ? 'bg-green-500/20 text-green-400' :
                'bg-secondary text-muted-foreground'
              }`}>
                {currentIdx > i ? (
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
                ) : i + 1}
              </div>
              <span className={`text-[10px] ${step === s ? 'text-foreground' : 'text-muted-foreground/40'}`}>{labels[i]}</span>
              {i < 2 && <div className={`w-4 h-px ${currentIdx > i ? 'bg-green-500/40' : 'bg-border/20'}`} />}
            </div>
          )
        })}
      </div>

      {step === 'check' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
            <p className="text-sm font-medium">Checking authentication status...</p>
            <p className="text-xs text-muted-foreground mt-1">Verifying Claude Code credentials.</p>
          </div>
          {checking && <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" /> Checking...</div>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {step === 'auth' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
            <p className="text-sm font-medium text-amber-400">Authentication Required</p>
            <p className="text-xs text-muted-foreground">
              Claude Code {version ? `(v${version})` : ''} is installed but not authenticated.
            </p>
            <div className="p-3 rounded bg-black/20 border border-border/20">
              <p className="text-xs text-muted-foreground mb-1.5">Run this command in your terminal:</p>
              <code className="block font-mono text-sm text-foreground select-all">claude login</code>
            </div>
            <p className="text-xs text-muted-foreground">
              This opens a browser for OAuth login with your Anthropic account, or you can set <code className="text-[11px] bg-black/20 px-1 rounded">ANTHROPIC_API_KEY</code> in your environment.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            <Button size="sm" onClick={checkAuth} disabled={checking}>
              {checking ? 'Checking...' : 'I\'ve logged in — verify'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">Claude Code is ready</p>
            <p className="text-xs text-muted-foreground">Authenticated and available for agent tasks.</p>
            {version && <p className="text-2xs text-muted-foreground/60">v{version}</p>}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Codex CLI Setup ────────────────────────────────────────────────────

function CodexSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'check' | 'auth' | 'done'>('check')
  const [checking, setChecking] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const res = await fetch('/api/agent-runtimes')
      if (res.ok) {
        const data = await res.json()
        const codex = (data.runtimes || []).find((r: any) => r.id === 'codex')
        if (codex) {
          setAuthenticated(codex.authenticated)
          setVersion(codex.version)
          if (codex.authenticated) setStep('done')
          else setStep('auth')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { checkAuth() }, [checkAuth])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up Codex CLI</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Authenticate the OpenAI CLI agent</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['check', 'auth', 'done'] as const).map((s, i) => {
          const labels = ['Check', 'Authenticate', 'Ready']
          const currentIdx = (['check', 'auth', 'done'] as const).indexOf(step)
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s ? 'bg-primary text-primary-foreground' :
                currentIdx > i ? 'bg-green-500/20 text-green-400' :
                'bg-secondary text-muted-foreground'
              }`}>
                {currentIdx > i ? (
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
                ) : i + 1}
              </div>
              <span className={`text-[10px] ${step === s ? 'text-foreground' : 'text-muted-foreground/40'}`}>{labels[i]}</span>
              {i < 2 && <div className={`w-4 h-px ${currentIdx > i ? 'bg-green-500/40' : 'bg-border/20'}`} />}
            </div>
          )
        })}
      </div>

      {step === 'check' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
            <p className="text-sm font-medium">Checking authentication status...</p>
            <p className="text-xs text-muted-foreground mt-1">Verifying Codex CLI credentials.</p>
          </div>
          {checking && <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" /> Checking...</div>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {step === 'auth' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
            <p className="text-sm font-medium text-amber-400">Authentication Required</p>
            <p className="text-xs text-muted-foreground">
              Codex CLI {version ? `(v${version})` : ''} is installed but not authenticated.
            </p>
            <div className="p-3 rounded bg-black/20 border border-border/20">
              <p className="text-xs text-muted-foreground mb-1.5">Run this command in your terminal:</p>
              <code className="block font-mono text-sm text-foreground select-all">codex auth</code>
            </div>
            <p className="text-xs text-muted-foreground">
              This authenticates with your OpenAI account, or you can set <code className="text-[11px] bg-black/20 px-1 rounded">OPENAI_API_KEY</code> in your environment.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            <Button size="sm" onClick={checkAuth} disabled={checking}>
              {checking ? 'Checking...' : 'I\'ve authenticated — verify'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">Codex CLI is ready</p>
            <p className="text-xs text-muted-foreground">Authenticated and available for agent tasks.</p>
            {version && <p className="text-2xs text-muted-foreground/60">v{version}</p>}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusCard({ label, ok, value, subtitle }: { label: string; ok?: boolean; value?: number; subtitle?: string }) {
  return (
    <div className={`p-2.5 rounded-lg border text-xs ${
      ok ? 'border-green-500/20 bg-green-500/5' : 'border-border/20 bg-secondary/10'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        {value !== undefined ? (
          <span className="font-mono text-foreground">{value}</span>
        ) : (
          <span className={ok ? 'text-green-400' : 'text-muted-foreground/40'}>
            {ok ? '+' : '-'}
          </span>
        )}
      </div>
      {subtitle && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{subtitle}</p>}
    </div>
  )
}
