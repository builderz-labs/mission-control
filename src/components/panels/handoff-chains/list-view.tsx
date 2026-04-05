'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { ChainCard } from './chain-card'
import { RecentRunsSection } from './recent-runs-section'
import type { HandoffChainParsed, HandoffChainRunWithName } from './types'

interface ListViewProps {
  onNew: () => void
  onEdit: (chain: HandoffChainParsed) => void
}

export function ListView({ onNew, onEdit }: ListViewProps): React.JSX.Element {
  const [chains, setChains] = useState<HandoffChainParsed[]>([])
  const [runs, setRuns] = useState<HandoffChainRunWithName[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<number | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchChains = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const [cRes, rRes] = await Promise.all([
        fetch('/api/handoff-chains', { signal: AbortSignal.timeout(8000) }),
        fetch('/api/handoff-chains/runs?limit=5', { signal: AbortSignal.timeout(8000) }),
      ])
      const cData = await cRes.json() as { success?: boolean; data?: HandoffChainParsed[]; error?: string }
      const rData = await rRes.json() as { success?: boolean; data?: HandoffChainRunWithName[]; error?: string }

      if (!cRes.ok) { setError(cData.error ?? 'Failed to load chains'); return }
      setChains(cData.data ?? [])
      setRuns(rData.data ?? [])
    } catch {
      setError('Network error — could not load handoff chains')
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 30s; initial fetch fires on mount
  useSmartPoll(fetchChains, 30_000)

  const showToast = (ok: boolean, text: string): void => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 3000)
  }

  const handleRun = async (chain: HandoffChainParsed): Promise<void> => {
    const inputData = window.prompt(`Input data for "${chain.name}" (leave blank if none)`)
    if (inputData === null) return // user cancelled

    setRunning(chain.id)
    try {
      const res = await fetch(`/api/handoff-chains/${chain.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_data: inputData || null }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json() as { success?: boolean; data?: { id: number }; error?: string }
      if (res.ok) {
        showToast(true, `Run #${data.data?.id ?? '?'} started`)
        void fetchChains()
      } else {
        showToast(false, data.error ?? 'Failed to start run')
      }
    } catch {
      showToast(false, 'Network error')
    } finally {
      setRunning(null)
    }
  }

  const handleDelete = async (chain: HandoffChainParsed): Promise<void> => {
    if (!window.confirm(`Delete chain "${chain.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/handoff-chains/${chain.id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        showToast(true, 'Chain deleted')
        void fetchChains()
      } else {
        const data = await res.json() as { error?: string }
        showToast(false, data.error ?? 'Delete failed')
      }
    } catch {
      showToast(false, 'Network error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <span className="animate-pulse">Loading handoff chains…</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs px-2 py-1.5 rounded bg-red-500/10 text-red-400">{error}</div>
      )}

      {toast && (
        <div className={`text-xs px-2 py-1 rounded ${toast.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {toast.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{chains.length} chain{chains.length !== 1 ? 's' : ''}</span>
        <Button onClick={onNew} variant="link" size="xs">New Chain</Button>
      </div>

      {chains.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-1">No handoff chains yet</p>
          <p className="text-xs text-muted-foreground">Create a chain to compose sequential multi-agent workflows</p>
        </div>
      ) : (
        <div className="space-y-2">
          {chains.map(chain => (
            <ChainCard
              key={chain.id}
              chain={chain}
              running={running === chain.id}
              onRun={handleRun}
              onEdit={onEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <RecentRunsSection runs={runs} />
    </div>
  )
}
