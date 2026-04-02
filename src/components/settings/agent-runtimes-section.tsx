'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { RuntimeSetupModal } from '@/components/onboarding/runtime-setup-modal'

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
  showFeedback: (ok: boolean, text: string) => void
}

export function AgentRuntimesSection({ showFeedback }: Props) {
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([])
  const [isDocker, setIsDocker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeJobs, setActiveJobs] = useState<Record<string, InstallJob>>({})
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null)
  const [setupRuntime, setSetupRuntime] = useState<'openclaw' | 'hermes' | 'claude' | 'codex' | null>(null)

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
            if (data.job.status === 'success') {
              showFeedback(true, `${data.job.runtime} installed successfully`)
              fetchRuntimes()
            } else if (data.job.status === 'failed') {
              showFeedback(false, `${data.job.runtime} install failed`)
              fetchRuntimes()
            }
          }
        } catch {
          // ignore
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [activeJobs, fetchRuntimes, showFeedback])

  const handleInstall = async (runtimeId: string) => {
    try {
      const res = await fetch('/api/agent-runtimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', runtime: runtimeId, mode: 'local' }),
      })
      if (!res.ok) {
        showFeedback(false, 'Failed to start install')
        return
      }
      const data = await res.json()
      if (data.job) {
        setActiveJobs(prev => ({ ...prev, [runtimeId]: data.job }))
      }
    } catch {
      showFeedback(false, 'Failed to start install')
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
      showFeedback(true, 'Docker compose snippet copied')
    } catch {
      showFeedback(false, 'Failed to copy')
    }
  }

  const handleDetect = async (runtimeId: string) => {
    try {
      const res = await fetch('/api/agent-runtimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect', runtime: runtimeId }),
      })
      if (!res.ok) return
      await fetchRuntimes()
      showFeedback(true, 'Detection refreshed')
    } catch {
      showFeedback(false, 'Detection failed')
    }
  }

  if (loading) {
    return (
      <div className="p-4 rounded-lg border border-border/30 bg-surface-1/20">
        <h3 className="text-sm font-medium mb-3">Agent Runtimes</h3>
        <div className="flex items-center justify-center py-4"><Loader /></div>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-lg border border-border/30 bg-surface-1/20">
      <h3 className="text-sm font-medium mb-1">Agent Runtimes</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Install and manage agent runtimes for running AI agents.
      </p>

      {isDocker && (
        <div className="mb-3 p-2 rounded border border-void-cyan/20 bg-void-cyan/5 text-xs text-muted-foreground">
          Running in Docker — install directly or use sidecar services for production.
        </div>
      )}

      <div className="space-y-3">
        {runtimes.map((rt) => {
          const job = activeJobs[rt.id]
          const isInstalling = job?.status === 'running' || job?.status === 'pending'
          const installFailed = job?.status === 'failed'
          const justInstalled = job?.status === 'success'

          return (
            <div
              key={rt.id}
              className={`relative rounded-lg border overflow-hidden transition-all ${
                isInstalling
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : rt.installed || justInstalled
                    ? 'border-emerald-500/20 bg-surface-1/10'
                    : 'border-border/20 bg-surface-1/10'
              }`}
            >
              {/* Installing shimmer + progress */}
              {isInstalling && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent animate-[shimmer_2s_infinite]" style={{ backgroundSize: '200% 100%' }} />
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/20 overflow-hidden">
                    <div className="h-full bg-emerald-500/60 animate-[indeterminate_1.5s_infinite_ease-in-out]" />
                  </div>
                </div>
              )}

              <div className="relative p-3">
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
                        <p className="text-xs font-medium text-foreground">{rt.name}</p>
                        <p className="text-2xs text-emerald-400/70">Installing...</p>
                      </div>
                    </div>
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
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{rt.name}</span>
                        {rt.installed || justInstalled ? (
                          <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                            {rt.version ? `v${rt.version}` : 'Installed'}
                          </span>
                        ) : (
                          <span className="text-2xs px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground border border-border/20">
                            Not installed
                          </span>
                        )}
                        {rt.installed && (
                          <span className={`text-2xs px-1.5 py-0.5 rounded-full border ${
                            rt.running
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-muted/20 text-muted-foreground/60 border-border/20'
                          }`}>
                            {rt.running ? 'Running' : 'Stopped'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => handleDetect(rt.id)} className="text-2xs h-6 px-2">Refresh</Button>
                        {!rt.installed && !justInstalled && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => handleInstall(rt.id)} className="text-2xs h-6 px-2">Install</Button>
                            {isDocker && (
                              <Button variant="ghost" size="sm" onClick={() => handleCopyCompose(rt.id)} className="text-2xs h-6 px-2">Sidecar YAML</Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground/70">{rt.description}</p>

                    {rt.installed && rt.authRequired && (
                      <p className={`text-2xs mt-1 ${rt.authenticated ? 'text-emerald-400/70' : 'text-amber-400'}`}>
                        {rt.authenticated ? 'Authenticated' : rt.authHint}
                      </p>
                    )}

                    {(rt.installed || justInstalled) && (
                      <button
                        onClick={() => setSetupRuntime(rt.id as 'openclaw' | 'hermes' | 'claude' | 'codex')}
                        className="text-2xs mt-1.5 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        Configure {rt.name}
                      </button>
                    )}

                    {installFailed && (
                      <div className="mt-2 space-y-1">
                        <p className="text-2xs text-red-400">Install failed: {job?.error || 'Unknown error'}</p>
                        <Button variant="ghost" size="sm" onClick={() => handleInstall(rt.id)} className="text-2xs h-6 px-2">Retry</Button>
                      </div>
                    )}

                    {justInstalled && <p className="text-2xs text-emerald-400 mt-1">Installed successfully</p>}

                    {job?.output && !isInstalling && (
                      <div className="mt-2">
                        <button
                          onClick={() => setExpandedOutput(expandedOutput === rt.id ? null : rt.id)}
                          className="text-2xs text-muted-foreground/50 hover:text-muted-foreground underline"
                        >
                          {expandedOutput === rt.id ? 'Hide output' : 'Show output'}
                        </button>
                        {expandedOutput === rt.id && (
                          <pre className="mt-1 p-2 rounded bg-black/20 text-[10px] font-mono text-muted-foreground/60 max-h-32 overflow-auto whitespace-pre-wrap">
                            {job.output}
                          </pre>
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

      {/* Post-install setup modals */}
      {setupRuntime && (
        <RuntimeSetupModal
          runtime={setupRuntime}
          onClose={() => setSetupRuntime(null)}
          onComplete={() => {
            setSetupRuntime(null)
            fetchRuntimes()
            const names: Record<string, string> = { openclaw: 'OpenClaw', hermes: 'Hermes', claude: 'Claude Code', codex: 'Codex CLI' }
            showFeedback(true, `${names[setupRuntime] || setupRuntime} setup complete`)
          }}
        />
      )}
    </div>
  )
}
