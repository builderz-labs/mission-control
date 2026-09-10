'use client'

import { useCallback, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { MacCleanupJobs } from './mac-cleanup-jobs'
import { MacCleanupMeters } from './mac-cleanup-meters'
import type { MacCleanupSnapshot, TriggerResult } from './mac-cleanup-types'

export function MacCleanupMonitor() {
  const [snapshot, setSnapshot] = useState<MacCleanupSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const data = await apiFetch<MacCleanupSnapshot>('/api/system-monitor/automations', {
        signal: controller.signal,
      })
      if (!controller.signal.aborted) {
        setSnapshot(data)
        setError(null)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load Mac cleanup automations')
      }
    }
  }, [])

  useSmartPoll(fetchData, 5000)

  const run = useCallback(async (id: string, mode: 'audit' | 'dry-run' | 'auto') => {
    setBusyId(id)
    setFlash(null)
    try {
      const result = await apiFetch<TriggerResult>('/api/system-monitor/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, mode }),
      })
      const extra = result.ok || !result.stderr ? '' : ` ${result.stderr}`
      setFlash(`${result.decision.reason}${extra}`)
      await fetchData()
    } catch (err: unknown) {
      setFlash(err instanceof Error ? err.message : 'Cleanup request failed')
    } finally {
      setBusyId(null)
    }
  }, [fetchData])

  if (!snapshot) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {error ? `Error: ${error}` : 'Loading Mac cleanup automations...'}
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Mac cleanup automations</h3>
          <p className="text-xs text-muted-foreground">
            Reclaims idle caches for CPU, RAM, and disk. Active agent projects are never touched.
          </p>
        </div>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          watch {snapshot.watch.enabled ? 'on' : 'off'}
        </span>
      </div>

      {!snapshot.available ? (
        <p className="text-sm text-muted-foreground">This host is not macOS; LaunchAgents are not available.</p>
      ) : (
        <>
          <MacCleanupMeters
            breaches={snapshot.breaches}
            npmActive={snapshot.metrics.npmActive}
            pnpmActive={snapshot.metrics.pnpmActive}
          />
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Recommendation</p>
            <p className="text-sm">{snapshot.recommendation.reason}</p>
            {snapshot.protectedProjects.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Protecting {snapshot.protectedProjects.length} live trees
                {snapshot.protectedProjects.filter((path) => path.includes('/Dev/')).slice(0, 6).map((path) => path.split('/').pop()).filter(Boolean).length
                  ? `: ${snapshot.protectedProjects.filter((path) => path.includes('/Dev/')).map((path) => path.split('/').pop()).filter(Boolean).slice(0, 6).join(', ')}`
                  : ''}
              </p>
            )}
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          {flash && <p className="text-xs text-muted-foreground">{flash}</p>}
          <MacCleanupJobs automations={snapshot.automations} busyId={busyId} onRun={run} />
          <ul className="space-y-1">
            {snapshot.findings.map((finding) => (
              <li key={finding} className="text-xs text-muted-foreground">{finding}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
