'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface RuntimeStatus {
  id: string
  name: string
  installed: boolean
  version?: string | null
  authRequired?: boolean
  authHint?: string
  authenticated?: boolean
}

interface Props {
  agentCount: number
  taskCount: number
  onNavigate: (panel: string) => void
}

export function EmptyStateLaunchpad({ agentCount, taskCount, onNavigate }: Props) {
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Try the agent-runtimes API first, fall back to capabilities endpoint
    fetch('/api/agent-runtimes')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.runtimes) {
          setRuntimes(d.runtimes)
          return
        }
        // Fallback: use capabilities endpoint for detection
        return fetch('/api/status?action=capabilities')
          .then(r => r.ok ? r.json() : {})
          .then((caps: Record<string, unknown>) => {
            const detected: RuntimeStatus[] = []
            if (caps.openclawHome) detected.push({ id: 'openclaw', name: 'OpenClaw', installed: true })
            if (caps.hermesInstalled) detected.push({ id: 'hermes', name: 'Hermes Agent', installed: true })
            if (caps.claudeHome) detected.push({ id: 'claude', name: 'Claude Code', installed: true })
            setRuntimes(detected)
          })
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const installed = runtimes.filter(r => r.installed)
  const hasRuntimes = installed.length > 0
  const hasAgents = agentCount > 0
  const hasTasks = taskCount > 0

  // Hide once all steps complete
  if (hasAgents && hasTasks) return null
  // Don't flash before data loads
  if (!loaded) return null

  const completedCount = (hasRuntimes ? 1 : 0) + (hasAgents ? 1 : 0) + (hasTasks ? 1 : 0)

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Launch Sequence</h2>
        <p className="text-sm text-muted-foreground">
          Complete each step to bring your station online.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Step 1: Runtimes */}
        <StepCard
          step={1}
          title="Agent Runtimes"
          done={hasRuntimes}
          active={!hasRuntimes}
          doneContent={
            <div className="space-y-1">
              {installed.map(r => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-400/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    {r.name}
                    {r.version && <span className="text-muted-foreground/40 text-2xs">v{r.version}</span>}
                  </div>
                  {r.authRequired && !r.authenticated && (
                    <span className="text-2xs text-amber-400">{r.authHint || 'Not authenticated'}</span>
                  )}
                </div>
              ))}
              {installed.length < runtimes.length && (
                <button onClick={() => onNavigate('settings')} className="text-2xs text-primary/70 hover:text-primary mt-1.5 underline">
                  + Install more runtimes
                </button>
              )}
            </div>
          }
          pendingContent={
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Install a runtime to run agents on this machine.
              </p>
              <Button
                size="sm"
                className="text-xs w-full bg-void-amber/20 text-void-amber border border-void-amber/30 hover:bg-void-amber/30"
                onClick={() => onNavigate('settings')}
              >
                Install Runtimes
              </Button>
            </>
          }
        />

        {/* Step 2: Agent */}
        <StepCard
          step={2}
          title="Dock an Agent"
          done={hasAgents}
          active={hasRuntimes && !hasAgents}
          doneContent={
            <>
              <p className="text-xs text-emerald-400/80 mb-1">Agent registered</p>
              <button
                className="text-2xs text-muted-foreground hover:text-foreground"
                onClick={() => onNavigate('agents')}
              >
                View fleet →
              </button>
            </>
          }
          pendingContent={
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Register your first agent. Choose a template and configure its capabilities.
              </p>
              <Button
                size="sm"
                className="text-xs w-full bg-void-amber/20 text-void-amber border border-void-amber/30 hover:bg-void-amber/30"
                disabled={!hasRuntimes}
                onClick={() => onNavigate('agents')}
              >
                Create Agent
              </Button>
            </>
          }
        />

        {/* Step 3: Task */}
        <StepCard
          step={3}
          title="Dispatch a Task"
          done={hasTasks}
          active={hasAgents && !hasTasks}
          doneContent={
            <>
              <p className="text-xs text-emerald-400/80 mb-1">Tasks in queue</p>
              <button
                className="text-2xs text-muted-foreground hover:text-foreground"
                onClick={() => onNavigate('tasks')}
              >
                Open task board →
              </button>
            </>
          }
          pendingContent={
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Create a task and assign it to your agent.
              </p>
              <Button
                size="sm"
                className="text-xs w-full bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30"
                disabled={!hasAgents}
                onClick={() => onNavigate('tasks')}
              >
                Create Task
              </Button>
            </>
          }
        />
      </div>

      {/* Animated progress bar */}
      <div className="mt-5 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-border/20 overflow-hidden relative">
          {completedCount < 3 && (
            <div className="absolute inset-0 bg-gradient-to-r from-void-amber/10 to-void-cyan/10 animate-pulse" />
          )}
          <div
            className="h-full rounded-full relative overflow-hidden transition-all duration-1000 ease-out"
            style={{
              width: `${(completedCount / 3) * 100}%`,
              background: completedCount === 3
                ? 'linear-gradient(90deg, rgb(16 185 129) 0%, rgb(52 211 153) 100%)'
                : 'linear-gradient(90deg, var(--void-amber) 0%, var(--void-cyan) 100%)',
            }}
          >
            <div className="absolute inset-0 shimmer-bar" />
          </div>
        </div>
        <span className={`text-2xs tabular-nums font-mono transition-colors duration-500 ${
          completedCount === 3 ? 'text-emerald-400' : 'text-muted-foreground/60'
        }`}>
          {completedCount}/3
        </span>
      </div>
    </div>
  )
}

function StepCard({ step, title, done, active, doneContent, pendingContent }: {
  step: number
  title: string
  done: boolean
  active: boolean
  doneContent: React.ReactNode
  pendingContent: React.ReactNode
}) {
  return (
    <div className={`p-4 rounded-lg border transition-all ${
      done
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : active
          ? 'border-void-amber/30 bg-void-amber/5'
          : 'border-border/40 bg-surface-1/20 opacity-50'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
          done
            ? 'bg-emerald-500/20 text-emerald-400'
            : active
              ? 'bg-void-amber/20 text-void-amber'
              : 'bg-muted/30 text-muted-foreground'
        }`}>
          {done ? '✓' : `0${step}`}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      {done ? doneContent : pendingContent}
    </div>
  )
}
