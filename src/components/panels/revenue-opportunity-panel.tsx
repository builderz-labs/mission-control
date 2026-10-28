'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

interface RevenueSignal {
  signal_id: string
  source_id: string
  title: string
  body_excerpt: string
  portfolio_bucket: string
  domain_hint: string | null
  pain_terms: string
  status: string
}

interface RevenueOpportunity {
  opportunity_id: string
  title: string
  status: string
  evidence_confidence: string
  evidence_count: number
  evidence_gate: { pass: boolean; missing: string[] }
}

interface Payload {
  summary: {
    signals: number
    new_signals: number
    promoted_signals: number
    opportunities: number
    research: number
  }
  signals: RevenueSignal[]
  opportunities: RevenueOpportunity[]
  sources: Array<{ id: string; name: string; state: string }>
}

export function RevenueOpportunityPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<Payload>('/api/revenue-opportunities?limit=10'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revenue Factory load failed')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const runScan = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/revenue-opportunities', {
        method: 'POST',
        body: JSON.stringify({ action: 'scan', query_count: 6, per_query: 4 }),
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Market scan failed')
    } finally {
      setBusy(false)
    }
  }, [load])

  const research = useCallback(async (signalId: string) => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/revenue-opportunities', {
        method: 'POST',
        body: JSON.stringify({ action: 'promote_signal', signal_id: signalId }),
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signal promotion failed')
    } finally {
      setBusy(false)
    }
  }, [load])

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Revenue Opportunity Factory</div>
          <h2 className="mt-2 text-xl font-semibold text-foreground">Market Scanner</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            공개 무료 source에서 raw signal만 수집합니다. Signal은 Opportunity가 아니며 Evidence Gate 전에는 BUILD로 갈 수 없습니다.
          </p>
        </div>
        <Button onClick={runScan} disabled={busy}>{busy ? 'Scanning…' : 'Run Market Scan'}</Button>
      </div>

      {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Signals', data?.summary.signals ?? 0],
          ['New', data?.summary.new_signals ?? 0],
          ['Promoted', data?.summary.promoted_signals ?? 0],
          ['Opportunities', data?.summary.opportunities ?? 0],
          ['Research', data?.summary.research ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-background/50 px-3 py-3">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold text-foreground">Recent raw signals</div>
          <div className="space-y-2">
            {(data?.signals || []).slice(0, 6).map((signal) => {
              let painTerms: string[] = []
              try { painTerms = JSON.parse(signal.pain_terms) as string[] } catch { painTerms = [] }
              return (
                <div key={signal.signal_id} className="rounded-xl border border-border bg-background/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {signal.source_id} · {signal.portfolio_bucket.replaceAll('_', ' ')}
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground">{signal.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{signal.body_excerpt || signal.domain_hint || 'No excerpt'}</div>
                      {painTerms.length > 0 && <div className="mt-2 text-[11px] text-amber-500">{painTerms.join(' · ')}</div>}
                    </div>
                    {signal.status === 'NEW' ? (
                      <Button onClick={() => research(signal.signal_id)} disabled={busy}>Research</Button>
                    ) : (
                      <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">{signal.status}</span>
                    )}
                  </div>
                </div>
              )
            })}
            {(!data?.signals || data.signals.length === 0) && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                아직 signal이 없습니다. Run Market Scan으로 첫 공개-source 스캔을 실행하세요.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-foreground">Research queue</div>
          <div className="space-y-2">
            {(data?.opportunities || []).slice(0, 6).map((item) => (
              <div key={item.opportunity_id} className="rounded-xl border border-border bg-background/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground">{item.opportunity_id}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{item.title}</div>
                    <div className="mt-2 text-xs text-muted-foreground">Evidence {item.evidence_count} · confidence {item.evidence_confidence}</div>
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-[10px] ${item.evidence_gate.pass ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-amber-500/30 bg-amber-500/10 text-amber-500'}`}>
                    {item.evidence_gate.pass ? 'GATE PASS' : 'RESEARCH'}
                  </span>
                </div>
                {!item.evidence_gate.pass && item.evidence_gate.missing.length > 0 && (
                  <div className="mt-2 text-[11px] leading-5 text-muted-foreground">Missing: {item.evidence_gate.missing.slice(0, 3).join(' · ')}</div>
                )}
              </div>
            ))}
            {(!data?.opportunities || data.opportunities.length === 0) && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                Research로 승격된 Opportunity가 아직 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 text-[11px] text-muted-foreground">
        Live free sources: {(data?.sources || []).filter((source) => source.state === 'LIVE_FREE').map((source) => source.name).join(' · ') || '—'}
        {' · '}Paid API: $0
      </div>
    </section>
  )
}
