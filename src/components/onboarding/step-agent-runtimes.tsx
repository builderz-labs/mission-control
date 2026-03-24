'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

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
    }, 2000)

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
        <div className="flex items-center justify-between pt-4 border-t border-border/30">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
          <Button onClick={onNext} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg}`}>Continue</Button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">Agent Runtimes</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Install agent runtimes to run AI agents. You can skip this and install later from Settings.
        </p>

        {isDocker && (
          <div className="mb-3 p-2.5 rounded-lg border border-void-cyan/20 bg-void-cyan/5 text-xs text-muted-foreground">
            Running in Docker — install directly or use sidecar services for production.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {runtimes.map((rt) => {
            const job = activeJobs[rt.id]
            const isInstalling = job?.status === 'running' || job?.status === 'pending'
            const installFailed = job?.status === 'failed'
            const justInstalled = job?.status === 'success'

            return (
              <div
                key={rt.id}
                className={`relative p-4 rounded-lg border text-left transition-all ${
                  rt.installed || justInstalled
                    ? `border-emerald-500/30 bg-emerald-500/5`
                    : 'border-border/30 bg-surface-1/30'
                }`}
              >
                {/* Status badge */}
                {(rt.installed || justInstalled) && (
                  <span className="absolute -top-2 right-2 text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Detected
                  </span>
                )}

                <p className={`text-sm font-medium mb-1 ${rt.installed || justInstalled ? 'text-emerald-400' : 'text-foreground'}`}>
                  {rt.name}
                </p>
                <p className="text-xs text-muted-foreground mb-2">{rt.description}</p>

                {rt.version && (
                  <p className="text-2xs text-muted-foreground/60 mb-1">v{rt.version}</p>
                )}

                {/* Auth status for runtimes that need it */}
                {rt.installed && rt.authRequired && (
                  <p className={`text-2xs mb-1 ${rt.authenticated ? 'text-emerald-400/70' : 'text-amber-400'}`}>
                    {rt.authenticated ? 'Authenticated' : rt.authHint}
                  </p>
                )}

                {/* Install actions */}
                {!rt.installed && !justInstalled && (
                  <div className="mt-2">
                    {isInstalling ? (
                      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                        <Loader /> Installing...
                      </div>
                    ) : installFailed ? (
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
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onNext} size="sm" className={`${mc.bgBtn} ${mc.text} border ${mc.border} ${mc.hoverBg}`}>
          Continue
        </Button>
      </div>
    </>
  )
}
