'use client'

import { useState } from 'react'
import type { OrchestratorControlActionResponse, OrchestratorControlState } from '@/types/mission-control'

const ACTIONS: Array<{ action: OrchestratorControlActionResponse['action']; label: string }> = [
  { action: 'wake', label: 'Wake Orchestrator' },
  { action: 'start', label: 'Start Workflow' },
  { action: 'pause', label: 'Pause' },
  { action: 'stop', label: 'Stop' },
  { action: 'restart', label: 'Restart Agents' },
]

export function OrchestratorControlButtons({
  orchestrator,
  onUpdated,
}: {
  orchestrator: OrchestratorControlState
  onUpdated: () => Promise<void> | void
}) {
  const [pendingAction, setPendingAction] = useState<OrchestratorControlActionResponse['action'] | null>(null)
  const [pendingToggle, setPendingToggle] = useState<string | null>(null)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string>('')

  async function runAction(action: OrchestratorControlActionResponse['action']) {
    setPendingAction(action)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(result.error || 'Command failed')
        return
      }
      setMessage(result.message || 'Updated')
      await onUpdated()
    } catch {
      setError('Network error while contacting orchestrator control')
    } finally {
      setPendingAction(null)
    }
  }

  async function toggleFeature(key: 'autonomousLoopEnabled' | 'autoSpawnEnabled' | 'debateEnabled' | 'selfHealEnabled', nextValue: boolean) {
    setPendingToggle(key)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_features', [key]: nextValue }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(result.error || result.message || 'Feature update failed')
        return
      }
      setMessage(result.message || 'Updated')
      await onUpdated()
    } catch {
      setError('Network error while updating autonomous controls')
    } finally {
      setPendingToggle(null)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Control Panel</h2>
          <p className="text-xs text-muted-foreground mt-1">
            State: <span className="text-foreground font-medium uppercase">{orchestrator.state}</span>
            {' '}· Active runs: <span className="text-foreground font-medium">{orchestrator.activeRuns}</span>
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Dispatch: {orchestrator.dispatchEnabled ? 'on' : 'off'}</div>
          <div>Scheduled: {orchestrator.scheduledRunsEnabled ? 'on' : 'off'}</div>
        </div>
      </div>

      <div className="panel-body space-y-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              onClick={() => runAction(action)}
              disabled={pendingAction !== null}
              className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs font-medium text-foreground transition-smooth hover:border-primary/40 hover:bg-secondary disabled:opacity-50"
            >
              {pendingAction === action ? 'Working...' : label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-foreground">Autonomous Loop Controls</h3>
              <p className="mt-1 text-2xs text-muted-foreground">
                Token-efficient automation toggles for spawning, debate, and safe local self-heal.
              </p>
            </div>
            <div className="text-right text-2xs text-muted-foreground">
              <div>Auto-spawned: <span className="text-foreground font-medium">{orchestrator.autoSpawnedAgents || 0}</span></div>
              <div>Debate pending: <span className="text-foreground font-medium">{orchestrator.debatePendingTasks || 0}</span></div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <FeatureToggle
              label="Autonomous Loop"
              enabled={Boolean(orchestrator.autonomousLoopEnabled)}
              pending={pendingToggle === 'autonomousLoopEnabled'}
              onToggle={() => toggleFeature('autonomousLoopEnabled', !orchestrator.autonomousLoopEnabled)}
            />
            <FeatureToggle
              label="Auto-Spawn Agents"
              enabled={Boolean(orchestrator.autoSpawnEnabled)}
              pending={pendingToggle === 'autoSpawnEnabled'}
              onToggle={() => toggleFeature('autoSpawnEnabled', !orchestrator.autoSpawnEnabled)}
            />
            <FeatureToggle
              label="Agent Debate"
              enabled={Boolean(orchestrator.debateEnabled)}
              pending={pendingToggle === 'debateEnabled'}
              onToggle={() => toggleFeature('debateEnabled', !orchestrator.debateEnabled)}
            />
            <FeatureToggle
              label="Repo Self-Heal"
              enabled={Boolean(orchestrator.selfHealEnabled)}
              pending={pendingToggle === 'selfHealEnabled'}
              onToggle={() => toggleFeature('selfHealEnabled', !orchestrator.selfHealEnabled)}
            />
          </div>
        </div>

        {(message || error || orchestrator.lastResult) && (
          <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs">
            {message && <p className="text-green-400">{message}</p>}
            {error && <p className="text-red-400">{error}</p>}
            {!message && !error && orchestrator.lastResult && (
              <p className="text-muted-foreground">Last dispatch: {orchestrator.lastResult}</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function FeatureToggle({
  label,
  enabled,
  pending,
  onToggle,
}: {
  label: string
  enabled: boolean
  pending: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      className={`rounded-lg border px-3 py-2 text-left transition-smooth disabled:opacity-50 ${
        enabled
          ? 'border-cyan-500/30 bg-cyan-500/10'
          : 'border-border bg-secondary/20 hover:bg-secondary/30'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-2xs ${enabled ? 'bg-cyan-500/20 text-cyan-300' : 'bg-secondary text-muted-foreground'}`}>
          {pending ? '...' : enabled ? 'on' : 'off'}
        </span>
      </div>
    </button>
  )
}
