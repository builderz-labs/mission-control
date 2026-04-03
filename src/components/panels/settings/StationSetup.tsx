'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SecurityScanCard } from '@/components/onboarding/security-scan-card'
import { clearOnboardingDismissedThisSession, clearOnboardingReplayFromStart } from '@/lib/onboarding-session'
import { useMissionControl } from '@/store'

interface HermesStatus {
  installed: boolean
  gatewayRunning: boolean
  hookInstalled: boolean
  activeSessions: number
  cronJobCount?: number
  memoryEntries?: number
}

interface StationSetupProps {
  hermesStatus: HermesStatus | null
  onFeedback: (ok: boolean, text: string) => void
  onRefetchHermes: () => void
}

export function StationSetup({ hermesStatus, onFeedback, onRefetchHermes }: StationSetupProps) {
  const { setShowOnboarding } = useMissionControl()
  const [showSecurityScan, setShowSecurityScan] = useState(false)
  const [mcBackupRunning, setMcBackupRunning] = useState(false)
  const [gwBackupRunning, setGwBackupRunning] = useState(false)
  const [replayingOnboarding, setReplayingOnboarding] = useState(false)
  const [hermesHookAction, setHermesHookAction] = useState(false)

  const handleMcBackup = async () => {
    setMcBackupRunning(true)
    try {
      const res = await fetch('/api/backup', { method: 'POST', signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      if (res.ok) {
        onFeedback(true, `MC backup created (${(data.backup?.size / 1024).toFixed(0)} KB)`)
      } else {
        onFeedback(false, data.error || 'MC backup failed')
      }
    } catch {
      onFeedback(false, 'Network error')
    } finally {
      setMcBackupRunning(false)
    }
  }

  const handleGwBackup = async () => {
    setGwBackupRunning(true)
    try {
      const res = await fetch('/api/backup?target=gateway', { method: 'POST', signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      if (res.ok) {
        onFeedback(true, `Gateway backup created: ${data.output}`)
      } else {
        onFeedback(false, data.error || 'Gateway backup failed')
      }
    } catch {
      onFeedback(false, 'Network error')
    } finally {
      setGwBackupRunning(false)
    }
  }

  const handleReplayOnboarding = async () => {
    setReplayingOnboarding(true)
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
        signal: AbortSignal.timeout(8000),
      })
      clearOnboardingDismissedThisSession()
      clearOnboardingReplayFromStart()
      setShowOnboarding(true)
      onFeedback(true, 'Onboarding reset — wizard will appear on next page load')
    } catch {
      onFeedback(false, 'Failed to reset onboarding')
    } finally {
      setReplayingOnboarding(false)
    }
  }

  const handleHermesHookAction = async () => {
    if (!hermesStatus) return
    setHermesHookAction(true)
    const action = hermesStatus.hookInstalled ? 'uninstall-hook' : 'install-hook'
    try {
      const res = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        onFeedback(true, data.message || `Hook ${action === 'install-hook' ? 'installed' : 'uninstalled'}`)
        onRefetchHermes()
      } else {
        onFeedback(false, data.error || 'Hook operation failed')
      }
    } catch {
      onFeedback(false, 'Network error')
    } finally {
      setHermesHookAction(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Security Scan */}
      <div className="flex items-center gap-3 p-3 bg-surface-1/50 border border-border/30 rounded-lg">
        <div className="flex-1">
          <p className="text-xs font-medium">Security</p>
          <p className="text-2xs text-muted-foreground">Scan your station security posture</p>
        </div>
        <Button
          variant="outline"
          size="xs"
          className="text-2xs"
          onClick={() => setShowSecurityScan(v => !v)}
        >
          {showSecurityScan ? 'Hide Scan' : 'Security Scan'}
        </Button>
      </div>
      {showSecurityScan && (
        <div className="p-4 bg-surface-1/30 border border-border/30 rounded-lg">
          <SecurityScanCard />
        </div>
      )}

      {/* Backup Actions */}
      <div className="flex items-center gap-3 p-3 bg-surface-1/50 border border-border/30 rounded-lg">
        <div className="flex-1">
          <p className="text-xs font-medium">Backups</p>
          <p className="text-2xs text-muted-foreground">Create on-demand backups of MC database or gateway state</p>
        </div>
        <Button variant="outline" size="xs" className="text-2xs" disabled={mcBackupRunning} onClick={handleMcBackup}>
          {mcBackupRunning ? 'Backing up...' : 'Backup MC Database'}
        </Button>
        <Button variant="outline" size="xs" className="text-2xs" disabled={gwBackupRunning} onClick={handleGwBackup}>
          {gwBackupRunning ? 'Backing up...' : 'Backup Gateway State'}
        </Button>
      </div>

      {/* Replay Onboarding */}
      <div className="flex items-center gap-3 p-3 bg-surface-1/50 border border-border/30 rounded-lg">
        <div className="flex-1">
          <p className="text-xs font-medium">Onboarding</p>
          <p className="text-2xs text-muted-foreground">Replay the setup wizard and reset the dashboard checklist</p>
        </div>
        <Button variant="outline" size="xs" className="text-2xs" disabled={replayingOnboarding} onClick={handleReplayOnboarding}>
          {replayingOnboarding ? 'Resetting...' : 'Replay Onboarding'}
        </Button>
      </div>

      {/* Hermes Agent Integration */}
      {hermesStatus?.installed && (
        <div className="p-3 bg-surface-1/50 border border-border/30 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium">Hermes Agent</p>
                <span className={`text-2xs px-1.5 py-0.5 rounded ${
                  hermesStatus.gatewayRunning
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {hermesStatus.gatewayRunning ? 'Gateway running' : 'Gateway offline'}
                </span>
                {hermesStatus.activeSessions > 0 && (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
                    {hermesStatus.activeSessions} active
                  </span>
                )}
                {(hermesStatus.cronJobCount ?? 0) > 0 && (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                    {hermesStatus.cronJobCount} cron
                  </span>
                )}
                {(hermesStatus.memoryEntries ?? 0) > 0 && (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                    {hermesStatus.memoryEntries} mem
                  </span>
                )}
              </div>
              <p className="text-2xs text-muted-foreground mt-0.5">
                {hermesStatus.hookInstalled
                  ? 'MC hook installed — receiving telemetry from hermes-agent'
                  : 'Install the MC hook for richer telemetry (agent status, session events)'}
              </p>
            </div>
            <Button
              variant="outline"
              size="xs"
              className="text-2xs"
              disabled={hermesHookAction}
              onClick={handleHermesHookAction}
            >
              {hermesHookAction
                ? 'Working...'
                : hermesStatus.hookInstalled
                  ? 'Uninstall Hook'
                  : 'Install MC Hook'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
