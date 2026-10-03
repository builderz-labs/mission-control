'use client'

import { useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useNavigateToPanel } from '@/lib/navigation'
import { type JsonValue, type Task, useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

type ApprovalDecision = 'approved' | 'changes_requested' | 'held'

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
  if (task.status === 'awaiting_owner' || task.status === 'review' || task.status === 'quality_review') return true
  if (readMeta(task, 'human_approval') !== null) return false
  return readMeta(task, 'human_required') === 'true' || readMeta(task, 'approval_type') !== null
}

export function ApprovalInboxWidget() {
  const { tasks, updateTask, setSelectedTask } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const approvals = useMemo(
    () => tasks
      .filter(isHumanAttention)
      .sort((a, b) => attentionRank(a) - attentionRank(b)
        || (a.due_date ?? Number.MAX_SAFE_INTEGER) - (b.due_date ?? Number.MAX_SAFE_INTEGER)
        || b.updated_at - a.updated_at)
      .slice(0, 6),
    [tasks],
  )

  async function decide(task: Task, decision: ApprovalDecision) {
    setBusyId(task.id)
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
      setBusyId(null)
    }
  }

  function openTask(task: Task) {
    setSelectedTask(task)
    navigateToPanel('tasks')
  }

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border bg-gradient-to-r from-amber-500/10 via-card to-card">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.65)]" />
            <h2 className="text-base font-semibold text-foreground">Approval Inbox</h2>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
              {approvals.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            지금 내가 결정해야 하는 일. 승인 후에는 Runner가 다음 단계로 넘깁니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigateToPanel('tasks')}>
          전체 작업
        </Button>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {approvals.length === 0 ? (
        <div className="px-5 py-9 text-center">
          <div className="text-sm font-medium text-foreground">지금 승인할 일이 없습니다.</div>
          <div className="mt-1 text-xs text-muted-foreground">
            새 REVIEW / awaiting_owner 작업이 생기면 여기에 먼저 표시됩니다.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {approvals.map((task) => {
            const domain = domainLabel(task)
            const sourceRef = readMeta(task, 'source_ref')
            const nextAction = readMeta(task, 'next_action')
            const selectedFormat = readMeta(task, 'selected_format')
            const isBusy = busyId === task.id

            return (
              <article key={task.id} className="px-5 py-4 hover:bg-muted/30 transition-colors">
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
                    <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => openTask(task)}>보기</Button>
                    <Button variant="outline" size="sm" disabled={isBusy} onClick={() => decide(task, 'held')}>보류</Button>
                    <Button variant="outline" size="sm" disabled={isBusy} onClick={() => decide(task, 'changes_requested')}>수정 요청</Button>
                    <Button size="sm" disabled={isBusy} onClick={() => decide(task, 'approved')}>
                      {isBusy ? '처리 중…' : '승인'}
                    </Button>
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
