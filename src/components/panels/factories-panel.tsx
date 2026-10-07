'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { RevenueOpportunityPanel } from '@/components/panels/revenue-opportunity-panel'
import type { FactoryDefinition, FactorySnapshot } from '@/lib/factories/types'

interface FactoryInstanceView {
  id: number
  instance_id: string
  module_id: string
  adapter_id: string
  native_id: string
  root_path: string | null
  latest_snapshot: FactorySnapshot | null
}

interface FactoryApproval {
  id: number
  request_id: string
  instance_id: string
  gate_id: string
  title: string
  state: string
  expected_revision: string | null
}

interface FactoryPayload {
  definitions: FactoryDefinition[]
  instances: FactoryInstanceView[]
  approvals: FactoryApproval[]
}

function statusTone(status?: string | null) {
  if (status === 'ready' || status === 'completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  if (status === 'blocked' || status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-400'
  if (status === 'running') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-500'
  return 'border-border bg-muted/30 text-muted-foreground'
}

function freshnessTone(state?: string | null) {
  if (state === 'fresh') return 'text-emerald-500'
  if (state === 'error') return 'text-red-400'
  return 'text-amber-500'
}

export function FactoriesPanel() {
  const [data, setData] = useState<FactoryPayload>({ definitions: [], instances: [], approvals: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const payload = await apiFetch<FactoryPayload>('/api/factories')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Factory data load failed')
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/factories', { method: 'POST' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Factory refresh failed')
    } finally {
      setBusy(false)
    }
  }, [load])

  useEffect(() => {
    void load()
  }, [load])

  const openApprovalCount = data.approvals.filter((a) => ['OPEN', 'DECISION_RECORDED', 'APPLYING'].includes(a.state)).length
  const blockedCount = data.instances.filter((i) => i.latest_snapshot?.lifecycle.status === 'blocked').length
  const failedChecks = useMemo(
    () => data.instances.reduce((sum, i) => sum + (i.latest_snapshot?.checks.filter((check) => !check.ok).length || 0), 0),
    [data.instances],
  )

  return (
    <div className="p-5 space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">AI Control Tower</div>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">Factories</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Native Factory를 Source of Truth로 유지합니다. Product gate는 사람의 결정과 native 재검증을 거친 경우에만 적용됩니다.
            </p>
          </div>
          <Button onClick={refreshAll} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh Factories'}</Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Instances', data.instances.length],
            ['Approval gates', openApprovalCount],
            ['Blocked', blockedCount],
            ['Failed checks', failedChecks],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-background/50 px-4 py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <RevenueOpportunityPanel />

      {data.instances.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="text-base font-medium text-foreground">Factory instance가 아직 없습니다.</div>
          <p className="mt-2 text-sm text-muted-foreground">Refresh Factories를 누르면 configured adapter가 native source를 탐색합니다.</p>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.instances.map((instance) => {
            const snapshot = instance.latest_snapshot
            const checks = snapshot?.checks || []
            const pass = checks.filter((check) => check.ok).length
            const openGates = snapshot?.gates.filter((gate) => gate.state === 'open') || []
            const pendingReviews = snapshot?.review_queues.filter((review) => review.status.toUpperCase() === 'PENDING') || []
            return (
              <section key={instance.instance_id} className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">{instance.module_id}</div>
                      <h2 className="mt-1 text-lg font-semibold text-foreground">{instance.native_id}</h2>
                    </div>
                    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${statusTone(snapshot?.lifecycle.status)}`}>
                      {snapshot?.lifecycle.status || 'not synced'}
                    </span>
                  </div>
                </div>

                <div className="space-y-4 p-5">
                  <div className={`grid grid-cols-2 gap-3 ${snapshot?.work_context ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Native stage</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{snapshot?.lifecycle.native_stage || '—'}</div>
                    </div>
                    {snapshot?.work_context ? (
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Primary work target</div>
                        <div className="mt-1 text-sm font-medium text-foreground">
                          {snapshot.work_context.primary_work_item
                            ? `${snapshot.work_context.primary_work_item.target_id} · ${snapshot.work_context.primary_work_item.expected_native_state || snapshot.work_context.primary_work_item.action_kind}`
                            : 'No pending work'}
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Process stage</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{snapshot?.lifecycle.process_stage_id || 'Unknown'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Quality readiness</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{checks.length ? `${pass}/${checks.length}` : '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Freshness</div>
                      <div className={`mt-1 text-sm font-medium ${freshnessTone(snapshot?.freshness.state)}`}>
                        {snapshot?.freshness.state || '—'}
                      </div>
                    </div>
                  </div>

                  {snapshot?.compatibility.warnings?.length ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3">
                      {snapshot.compatibility.warnings.map((warning) => (
                        <div key={warning} className="text-xs leading-5 text-amber-500">{warning}</div>
                      ))}
                    </div>
                  ) : null}

                  <div>
                    <div className="text-xs font-semibold text-foreground">Human gates</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {openGates.length === 0
                        ? <span className="text-xs text-muted-foreground">None</span>
                        : openGates.map((gate) => (
                          <span key={gate.id} className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-500">
                            {gate.id}
                          </span>
                        ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-foreground">Blockers</div>
                    <div className="mt-2 space-y-1.5">
                      {checks.filter((check) => !check.ok).length === 0
                        ? <div className="text-xs text-muted-foreground">No failed checks</div>
                        : checks.filter((check) => !check.ok).map((check) => (
                          <div key={check.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted/25 px-3 py-2">
                            <span className="text-xs font-medium text-foreground">{check.id}</span>
                            <span className="text-right text-xs text-muted-foreground">{check.detail || 'failed'}</span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-foreground">Independent reviews</div>
                    <div className="mt-2 space-y-1.5">
                      {pendingReviews.length === 0
                        ? <div className="text-xs text-muted-foreground">No pending review</div>
                        : pendingReviews.map((review) => (
                          <div key={review.kind} className="rounded-lg bg-muted/25 px-3 py-2">
                            <div className="text-xs font-medium text-foreground">{review.kind}</div>
                            {review.last_error && <div className="mt-1 text-xs leading-5 text-muted-foreground">{review.last_error}</div>}
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                    Revision: <span className="font-mono">{snapshot?.source.revision?.slice(0, 12) || '—'}</span>
                    {' · '}Adapter: {instance.adapter_id}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
