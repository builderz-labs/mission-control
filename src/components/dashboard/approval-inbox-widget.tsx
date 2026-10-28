'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useNavigateToPanel } from '@/lib/navigation'
import { type JsonValue, type Task, useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

type TaskApprovalDecision = 'approved' | 'changes_requested' | 'held'
type FactoryDecision = 'approve' | 'revise' | 'hold'

interface FactoryApprovalView {
  id: number
  request_id: string
  instance_id: string
  gate_id: string
  title: string
  description: string | null
  state: 'OPEN' | 'DECISION_RECORDED' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'STALE'
  decision: string | null
  expected_revision: string | null
  native_stage: string | null
  freshness: string | null
  can_apply: boolean
  block_reason: string | null
}

interface FactoryInstanceSummary {
  latest_snapshot: {
    lifecycle: { status: string }
  } | null
}

interface LearningOverview {
  summary?: { active_candidates?: number; evidence?: number }
  analysis?: { factory_rollups?: Array<{ reflection_eligible?: boolean }> }
  candidate_signals?: Array<{ candidate_ready?: boolean }>
}

function metadataRecord(value: JsonValue | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {}
  return { ...(value as Record<string, unknown>) }
}

function readMeta(task: Task, key: string): string | null {
  const value = metadataRecord(task.metadata)[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function domainLabel(task: Task): string {
  return readMeta(task, 'domain') || task.tags?.find((tag) => ['marketing', 'development', 'operations'].includes(tag)) || 'work'
}

function attentionRank(task: Task): number {
  if (task.priority === 'critical' || task.priority === 'urgent') return 0
  if (task.priority === 'high') return 1
  return 2
}

function isHumanAttention(task: Task): boolean {
  if (readMeta(task, 'workflow') === 'shufuro.content_publish') return false
  if (task.status === 'awaiting_owner' || task.status === 'review' || task.status === 'quality_review') return true
  if (readMeta(task, 'human_approval') !== null) return false
  return readMeta(task, 'human_required') === 'true' || readMeta(task, 'approval_type') !== null
}

export function ApprovalInboxWidget() {
  const { tasks, updateTask, setSelectedTask } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [factoryApprovals, setFactoryApprovals] = useState<FactoryApprovalView[]>([])
  const [factoryInstances, setFactoryInstances] = useState<FactoryInstanceSummary[]>([])
  const [learningOverview, setLearningOverview] = useState<LearningOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishEvidenceInputs, setPublishEvidenceInputs] = useState<Record<string, { channel: string; post_id: string; post_url: string }>>({})

  const taskApprovals = useMemo(
    () => tasks
      .filter(isHumanAttention)
      .sort((a, b) => attentionRank(a) - attentionRank(b)
        || (a.due_date ?? Number.MAX_SAFE_INTEGER) - (b.due_date ?? Number.MAX_SAFE_INTEGER)
        || b.updated_at - a.updated_at)
      .slice(0, 6),
    [tasks],
  )

  const loadFactoryApprovals = useCallback(async () => {
    const [approvalResult, factoryResult, learningResult] = await Promise.allSettled([
      apiFetch<{ approvals?: FactoryApprovalView[] }>(
        '/api/factory-approvals?state=OPEN,DECISION_RECORDED,APPLYING',
      ),
      apiFetch<{ instances?: FactoryInstanceSummary[] }>('/api/factories'),
      apiFetch<LearningOverview>('/api/learning?limit=1'),
    ])

    if (approvalResult.status === 'fulfilled') setFactoryApprovals(approvalResult.value.approvals || [])
    if (factoryResult.status === 'fulfilled') setFactoryInstances(factoryResult.value.instances || [])
    if (learningResult.status === 'fulfilled') setLearningOverview(learningResult.value)
  }, [])

  useEffect(() => {
    void loadFactoryApprovals()
    const timer = window.setInterval(() => { void loadFactoryApprovals() }, 15_000)
    return () => window.clearInterval(timer)
  }, [loadFactoryApprovals])

  async function decideTask(task: Task, decision: TaskApprovalDecision) {
    setBusyKey(`task:${task.id}`)
    setError(null)

    const currentMetadata = metadataRecord(task.metadata)
    const now = Math.floor(Date.now() / 1000)
    const metadata = {
      ...currentMetadata,
      human_approval: decision,
      human_approval_at: now,
      human_approval_source: 'ai-ops-hub',
    }
    const status: Task['status'] = decision === 'held'
      ? 'backlog'
      : task.assigned_to ? 'assigned' : 'in_progress'

    try {
      const body = await apiFetch<{ task?: Task }>(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, metadata }),
      })
      updateTask(task.id, body?.task ?? { ...task, status, metadata: metadata as unknown as JsonValue })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval update failed')
    } finally {
      setBusyKey(null)
    }
  }

  async function decideFactory(approval: FactoryApprovalView, decision: FactoryDecision) {
    if (!approval.expected_revision) {
      setError('Factory revision이 없어 승인할 수 없습니다. Factories에서 새로고침하세요.')
      return
    }
    setBusyKey(`factory:${approval.id}`)
    setError(null)
    try {
      const publishInput = publishEvidenceInputs[approval.request_id]
      const publish_evidence = approval.gate_id.startsWith('publish:') && decision === 'approve'
        ? {
            provider: 'manual',
            channel: publishInput?.channel?.trim(),
            ...(publishInput?.post_id?.trim() ? { post_id: publishInput.post_id.trim() } : {}),
            ...(publishInput?.post_url?.trim() ? { post_url: publishInput.post_url.trim() } : {}),
            published_at: new Date().toISOString(),
            verification_state: 'verified',
            evidence_ref: `manual:${approval.gate_id}:${Date.now()}`,
          }
        : undefined
      await apiFetch(`/api/factory-approvals/${encodeURIComponent(approval.request_id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          note: 'Decision recorded from AI Ops Hub Approval Inbox.',
          expected_revision: approval.expected_revision,
          ...(publish_evidence ? { publish_evidence } : {}),
        }),
      })
      if (decision === 'approve') {
        await apiFetch('/api/factory-approvals/process', { method: 'POST', body: '{}' })
      }
      await loadFactoryApprovals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Factory approval update failed')
    } finally {
      setBusyKey(null)
    }
  }

  function openTask(task: Task) {
    setSelectedTask(task)
    navigateToPanel('tasks')
  }

  const total = factoryApprovals.length + taskApprovals.length
  const runningCount = tasks.filter((task) => task.status === 'in_progress').length
    + factoryInstances.filter((instance) => instance.latest_snapshot?.lifecycle.status === 'running').length
    + factoryApprovals.filter((approval) => approval.state === 'DECISION_RECORDED' || approval.state === 'APPLYING').length
  const blockedCount = tasks.filter((task) => task.status === 'failed').length
    + factoryInstances.filter((instance) => instance.latest_snapshot?.lifecycle.status === 'blocked').length
  const candidateReadyCount = learningOverview?.candidate_signals?.filter((signal) => signal.candidate_ready).length || 0
  const reflectionEligibleCount = learningOverview?.analysis?.factory_rollups?.filter((rollup) => rollup.reflection_eligible).length || 0
  const learningEvidenceCount = learningOverview?.summary?.evidence || 0

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border bg-gradient-to-r from-amber-500/10 via-card to-card">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.65)]" />
            <h2 className="text-base font-semibold text-foreground">NEEDS YOUR DECISION</h2>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">{total}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Approval Inbox · Factory 승인은 native Source of Truth 적용이 확인된 뒤에만 완료됩니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigateToPanel('factories')}>Factories</Button>
      </div>

      <div className="grid gap-2 border-b border-border px-5 py-3 sm:grid-cols-3">
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
          <div className="text-[11px] font-semibold tracking-wide text-cyan-500">RUNNING</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{runningCount}</div>
          <div className="text-[11px] text-muted-foreground">tasks · factory jobs</div>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <div className="text-[11px] font-semibold tracking-wide text-red-400">BLOCKED</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{blockedCount}</div>
          <div className="text-[11px] text-muted-foreground">failed work · native blockers</div>
        </div>
        <button
          type="button"
          onClick={() => navigateToPanel('learning')}
          className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-left hover:bg-violet-500/10 transition-colors"
        >
          <div className="text-[11px] font-semibold tracking-wide text-violet-400">LEARNING</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{candidateReadyCount}</div>
          <div className="text-[11px] text-muted-foreground">
            candidate-ready · reflection {reflectionEligibleCount} · typed evidence {learningEvidenceCount}
          </div>
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
      )}

      {total === 0 ? (
        <div className="px-5 py-9 text-center">
          <div className="text-sm font-medium text-foreground">지금 승인할 일이 없습니다.</div>
          <div className="mt-1 text-xs text-muted-foreground">새 Factory gate 또는 REVIEW 작업이 생기면 여기에 표시됩니다.</div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {factoryApprovals.map((approval) => {
            const busy = busyKey === `factory:${approval.id}`
            const pendingApply = approval.state === 'DECISION_RECORDED' || approval.state === 'APPLYING'
            const publishInput = publishEvidenceInputs[approval.request_id]
            const publishEvidenceReady = Boolean(publishInput?.channel.trim() && (publishInput.post_id.trim() || publishInput.post_url.trim()))
            return (
              <article key={approval.request_id} className="px-5 py-4 bg-amber-500/[0.025] hover:bg-muted/30 transition-colors">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <button type="button" onClick={() => navigateToPanel('factories')} className="min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-violet-500/10 px-2 py-1 font-medium text-violet-400">Factory Gate</span>
                      <span className="text-muted-foreground">{approval.instance_id}</span>
                      {approval.native_stage && <span className="font-mono text-muted-foreground">{approval.native_stage}</span>}
                      <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-500">
                        {approval.state.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <h3 className="mt-2 truncate text-sm font-semibold text-foreground">{approval.title}</h3>
                    <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground">
                      {approval.block_reason || approval.description || `Native gate ${approval.gate_id} requires a decision.`}
                    </p>
                  </button>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => navigateToPanel('factories')}>보기</Button>
                    {pendingApply ? (
                      <Button size="sm" disabled>Native 적용 대기</Button>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => decideFactory(approval, 'hold')}>보류</Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => decideFactory(approval, 'revise')}>수정 요청</Button>
                        <Button
                          size="sm"
                          disabled={busy || !approval.can_apply || (approval.gate_id.startsWith('publish:') && !publishEvidenceReady)}
                          title={!approval.can_apply ? approval.block_reason || '현재 native gate 적용 조건을 충족하지 않습니다.' : undefined}
                          onClick={() => decideFactory(approval, 'approve')}
                        >
                          {busy ? '처리 중…' : '승인'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {approval.gate_id.startsWith('publish:') && !pendingApply && (
                  <div className="mt-3 grid gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 sm:grid-cols-3">
                    <p className="text-xs text-amber-600 sm:col-span-3">After you publish manually, enter the channel and external post ID or canonical URL. Control Tower records this evidence; it does not publish.</p>
                    <label className="text-xs text-muted-foreground">Channel
                      <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" placeholder="instagram, x, tiktok…"
                        value={publishEvidenceInputs[approval.request_id]?.channel || ''}
                        onChange={(event) => setPublishEvidenceInputs((current) => ({ ...current, [approval.request_id]: { channel: event.target.value, post_id: current[approval.request_id]?.post_id || '', post_url: current[approval.request_id]?.post_url || '' } }))} />
                    </label>
                    <label className="text-xs text-muted-foreground">External post ID
                      <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" placeholder="Post ID (or provide URL)"
                        value={publishEvidenceInputs[approval.request_id]?.post_id || ''}
                        onChange={(event) => setPublishEvidenceInputs((current) => ({ ...current, [approval.request_id]: { channel: current[approval.request_id]?.channel || '', post_id: event.target.value, post_url: current[approval.request_id]?.post_url || '' } }))} />
                    </label>
                    <label className="text-xs text-muted-foreground">Canonical post URL
                      <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" placeholder="https://… (or provide post ID)"
                        value={publishEvidenceInputs[approval.request_id]?.post_url || ''}
                        onChange={(event) => setPublishEvidenceInputs((current) => ({ ...current, [approval.request_id]: { channel: current[approval.request_id]?.channel || '', post_id: current[approval.request_id]?.post_id || '', post_url: event.target.value } }))} />
                    </label>
                  </div>
                )}
              </article>
            )
          })}

          {taskApprovals.map((task) => {
            const domain = domainLabel(task)
            const sourceRef = readMeta(task, 'source_ref')
            const nextAction = readMeta(task, 'next_action')
            const selectedFormat = readMeta(task, 'selected_format')
            const busy = busyKey === `task:${task.id}`

            return (
              <article key={`task:${task.id}`} className="px-5 py-4 hover:bg-muted/30 transition-colors">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <button type="button" onClick={() => openTask(task)} className="min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary capitalize">{domain}</span>
                      {task.project_name && <span className="text-muted-foreground">{task.project_name}</span>}
                      {sourceRef && <span className="font-mono text-muted-foreground">{sourceRef}</span>}
                      {selectedFormat && <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">{selectedFormat}</span>}
                      <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-500">
                        {task.status.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <h3 className="mt-2 truncate text-sm font-semibold text-foreground">{task.title}</h3>
                    <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground">
                      {nextAction ? `Next: ${nextAction}` : task.description || '검수 후 승인, 수정 요청 또는 보류를 선택하세요.'}
                    </p>
                  </button>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => openTask(task)}>보기</Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => decideTask(task, 'held')}>보류</Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => decideTask(task, 'changes_requested')}>수정 요청</Button>
                    <Button size="sm" disabled={busy} onClick={() => decideTask(task, 'approved')}>{busy ? '처리 중…' : '승인'}</Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
