'use client'

import { useCallback, useMemo, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface ApprovalTask {
  id: number
  title: string
  description?: string
  status: string
  priority: string
  assigned_to?: string
  metadata?: Record<string, unknown>
  latestApproval?: {
    action: 'approve' | 'reject'
    summary: string
    rationale?: string
    actor: string
    created_at: number
  } | null
}

export function ApprovalInboxPanel() {
  const [items, setItems] = useState<ApprovalTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<number | null>(null)

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals?limit=100')
      if (!res.ok) throw new Error('Failed to load approval inbox')
      const data = await res.json()
      setItems(data.approvals || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval inbox')
    } finally {
      setLoading(false)
    }
  }, [])

  useSmartPoll(fetchApprovals, 10000)

  const pendingCount = useMemo(() => items.length, [items])

  async function decide(task: ApprovalTask, action: 'approve' | 'reject') {
    setWorkingId(task.id)
    setError(null)
    try {
      const summary = action === 'approve'
        ? `Approved high-level action for "${task.title}"`
        : `Rejected high-level action for "${task.title}"`

      const res = await fetch(`/api/tasks/${task.id}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          summary,
          rationale: action === 'reject' ? 'Needs adjustment before approval.' : 'Approved to proceed.',
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Decision failed')
      await fetchApprovals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed')
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-foreground">Approval Inbox</h2>
          <p className="text-xs text-muted-foreground mt-1">One-click decisions for high-level and external actions.</p>
        </div>
        <div className="px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 text-xs font-semibold border border-amber-500/30">
          {pendingCount} pending
        </div>
      </div>

      {error && (
        <div className="m-4 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 text-sm">{error}</div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading approval queue...</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
            No approvals pending. Office is clear ✅
          </div>
        ) : (
          items.map((task) => (
            <div key={task.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{task.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Status: {task.status} • Priority: {task.priority} • Owner: {task.assigned_to || 'Unassigned'}
                  </div>
                </div>
                <span className="text-[10px] px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 uppercase tracking-wide">
                  needs your decision
                </span>
              </div>

              <div className="mt-3 rounded-md bg-surface-1/70 p-3 border border-border/60">
                <p className="text-xs text-muted-foreground mb-1">Human summary</p>
                <p className="text-sm text-foreground/90">
                  {summarizeForHuman(task)}
                </p>
              </div>

              {task.latestApproval && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Last decision: {task.latestApproval.action} by {task.latestApproval.actor} — {task.latestApproval.summary}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button
                  disabled={workingId === task.id}
                  onClick={() => decide(task, 'approve')}
                  className="px-4 py-2 rounded-md bg-green-600/20 text-green-300 border border-green-500/30 hover:bg-green-600/30 transition-smooth text-sm disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={workingId === task.id}
                  onClick={() => decide(task, 'reject')}
                  className="px-4 py-2 rounded-md bg-red-600/20 text-red-300 border border-red-500/30 hover:bg-red-600/30 transition-smooth text-sm disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function summarizeForHuman(task: ApprovalTask): string {
  const actionType = String(task.metadata?.actionType || '').replace(/[_-]/g, ' ')
  if (actionType) {
    return `This task wants to perform a ${actionType}. Approving lets the team continue this high-level action.`
  }

  if (task.description && task.description.trim()) {
    const sentence = task.description.trim().split('\n')[0]
    return sentence.length > 220 ? `${sentence.slice(0, 220)}…` : sentence
  }

  return 'Team requests permission to move this high-level task forward.'
}
