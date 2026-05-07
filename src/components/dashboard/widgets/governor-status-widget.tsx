'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { DashboardData } from '../widget-primitives'

interface GovernorSummary {
  status: 'PASS' | 'WARN' | 'FAIL'
  risk_level: number
  next_action: string
  confidence: number
  timestamp: string
  repo_state: {
    branch_current: string | null
    working_tree_clean: boolean
  }
  error?: { message: string }
}

const STATUS_DOT: Record<string, string> = {
  PASS: 'bg-green-500',
  WARN: 'bg-amber-500',
  FAIL: 'bg-red-500',
}

const STATUS_TEXT: Record<string, string> = {
  PASS: 'text-green-400',
  WARN: 'text-amber-400',
  FAIL: 'text-red-400',
}

const RISK_TEXT: Record<number, string> = {
  0: 'text-green-400',
  1: 'text-amber-400',
  2: 'text-orange-400',
  3: 'text-red-400',
}

export function GovernorStatusWidget({ data }: { data: DashboardData }) {
  const { navigateToPanel } = data
  const [gov, setGov] = useState<GovernorSummary | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchGov = useCallback(async () => {
    try {
      const res = await fetch('/api/mission-control/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as GovernorSummary
      setGov(json)
      setFetchError(null)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch')
    }
  }, [])

  useEffect(() => { fetchGov() }, [fetchGov])
  useSmartPoll(fetchGov, 30000)

  if (fetchError) {
    return (
      <div className="rounded-xl border border-border bg-card/80 px-4 py-2.5 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">Governor</span>
        <span className="text-2xs text-red-400">{fetchError}</span>
      </div>
    )
  }

  if (!gov) {
    return (
      <div className="rounded-xl border border-border bg-card/80 px-4 py-2.5">
        <span className="text-2xs text-muted-foreground">Loading governor state…</span>
      </div>
    )
  }

  const riskClass = RISK_TEXT[gov.risk_level] ?? 'text-muted-foreground'
  const dotClass = STATUS_DOT[gov.status] ?? 'bg-red-500'
  const statusClass = STATUS_TEXT[gov.status] ?? 'text-red-400'
  const tsStr = gov.timestamp ? new Date(gov.timestamp).toLocaleTimeString() : '—'

  return (
    <div className="rounded-xl border border-border bg-card/80 px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-muted-foreground">
      <span className="text-xs font-semibold text-foreground/80">Governor</span>

      <span className="inline-flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
        <span className={`font-mono-tight font-semibold ${statusClass}`}>{gov.status}</span>
      </span>

      <span>
        Risk <span className={`font-mono-tight ${riskClass}`}>{gov.risk_level}/3</span>
      </span>

      <span>
        Action <span className="font-mono-tight text-foreground/70">{gov.next_action}</span>
      </span>

      {gov.repo_state?.branch_current && (
        <span>
          Branch <span className="font-mono-tight text-foreground/70">{gov.repo_state.branch_current}</span>
        </span>
      )}

      <span>
        Tree{' '}
        <span className={`font-mono-tight ${gov.repo_state?.working_tree_clean ? 'text-green-400' : 'text-red-400'}`}>
          {gov.repo_state?.working_tree_clean ? 'clean' : 'dirty'}
        </span>
      </span>

      <span>
        Confidence <span className="font-mono-tight text-foreground/70">{Math.round((gov.confidence ?? 0) * 100)}%</span>
      </span>

      <span className="text-muted-foreground/50 font-mono-tight">{tsStr}</span>

      <button
        type="button"
        onClick={() => navigateToPanel('mc-status')}
        className="ml-auto text-2xs text-muted-foreground/60 hover:text-foreground border border-border/50 rounded px-2 py-0.5 transition-colors"
      >
        Details →
      </button>
    </div>
  )
}
