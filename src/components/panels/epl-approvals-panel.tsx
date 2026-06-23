'use client'

/**
 * EPL Agent Cockpit — Approvals (Phase 2).
 *
 * Renders Atlas's pending gated-dispatch runs (mc_cockpit.json
 * `pending_approvals[]`, via /api/epl/approvals) and lets an operator approve /
 * reject. The decision POSTs to /api/epl/approvals/[id], which relays to Atlas's
 * dispatch/approve (server-side, shared key) — the SAME resolve path the Slack
 * gate uses, so MC and Slack share one source of truth (no double-gate drift).
 *
 * 🔒 The whole surface is gated behind COCKPIT_APPROVALS_ENABLED (default OFF):
 * the panel only registers when the flag is on (see src/plugins/epl-panels.ts),
 * and both API routes 404 when off. Inert in prod until armed.
 */

import { useCallback, useEffect, useState } from 'react'
import { cockpitApprovalsEnabled } from '@/lib/cockpit-flags'

interface PendingApproval {
  id: string
  agent: string
  kind: string
  summary: string
  requested_at: string
  cost_cap_usd: number
  impact: string
  reversible: boolean
}

interface ApprovalsResponse {
  source: 'live' | 'empty'
  generated_at: string
  pending: PendingApproval[]
  pending_count: number
}

const IMPACT_CLASS: Record<string, string> = {
  low: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  high: 'bg-rose-500/15 text-rose-200 border-rose-500/30',
}

export function EplApprovalsPanel() {
  const enabled = cockpitApprovalsEnabled()
  const [data, setData] = useState<ApprovalsResponse | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/epl/approvals', { cache: 'no-store' })
      if (!res.ok) {
        setError(`approvals unavailable (${res.status})`)
        return
      }
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  const resolve = useCallback(
    async (id: string, decision: 'approve' | 'reject') => {
      setBusy(id)
      setError(null)
      try {
        const res = await fetch(`/api/epl/approvals/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || body.ok === false) {
          setError(body.error || `resolve failed (${res.status})`)
        } else {
          await load() // re-pull — the resolved item clears on the next export
        }
      } catch (e) {
        setError(String(e))
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const pending = data?.pending ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">✅ Approvals</h1>
        <span className="text-muted-foreground">
          {pending.length} pending{data?.source === 'empty' ? ' · waiting on Atlas export' : ''}
        </span>
        <button onClick={load} className="ml-auto text-xs underline text-muted-foreground hover:text-foreground">refresh</button>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {!data ? (
        <div className="p-8 text-sm text-muted-foreground">Loading approvals…</div>
      ) : pending.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {data.source === 'empty'
            ? 'No cockpit export yet — Atlas writes pending_approvals[] into /atlas-data/mc_cockpit.json.'
            : 'Nothing waiting. Gated dispatch runs land here for approve / reject.'}
        </div>
      ) : (
        <section className="space-y-2">
          {pending.map((p) => (
            <div key={p.id} className="flex items-center gap-3 bg-card rounded-2xl border border-border px-4 py-3">
              <span className="text-sm font-medium text-foreground capitalize">{p.agent}</span>
              <span className="text-sm text-muted-foreground truncate flex-1" title={p.summary}>
                {p.summary || p.kind}
              </span>
              {p.cost_cap_usd > 0 && (
                <span className="text-[11px] text-muted-foreground">≤ ${p.cost_cap_usd.toFixed(2)}</span>
              )}
              {!p.reversible && (
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/15 text-rose-200">irreversible</span>
              )}
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${IMPACT_CLASS[p.impact] || IMPACT_CLASS.medium}`}>{p.impact}</span>
              <button
                onClick={() => resolve(p.id, 'approve')}
                disabled={busy === p.id}
                className="text-xs px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white"
              >
                {busy === p.id ? '…' : 'Approve'}
              </button>
              <button
                onClick={() => resolve(p.id, 'reject')}
                disabled={busy === p.id}
                className="text-xs px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white"
              >
                Reject
              </button>
            </div>
          ))}
        </section>
      )}

      <footer className="text-xs text-muted-foreground pt-2">
        Source: <code>/api/epl/approvals</code> → Atlas <code>/dispatch/approve</code>. Resolving here also clears the Slack prompt (one source of truth).
      </footer>
    </div>
  )
}
