'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'

interface ExecApprovalRequest {
  id: string
  sessionId: string
  agentName?: string
  toolName: string
  toolArgs: Record<string, any>
  command?: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  expiresAt?: number
  status: 'pending' | 'approved' | 'denied' | 'expired'
}

type FilterTab = 'all' | 'pending' | 'resolved'

const RISK_BORDER: Record<ExecApprovalRequest['risk'], string> = {
  low: 'border-l-green-500',
  medium: 'border-l-yellow-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-500',
}

const RISK_BADGE: Record<ExecApprovalRequest['risk'], { bg: string; text: string }> = {
  low: { bg: 'bg-green-500/20', text: 'text-green-400' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  critical: { bg: 'bg-red-500/20', text: 'text-red-400' },
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ExecApprovalPanel() {
  const [approvals, setApprovals] = useState<ExecApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [respondingIds, setRespondingIds] = useState<Record<string, string>>({})
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/exec-approvals')
      if (!res.ok) return
      const data = await res.json()
      setApprovals(data.approvals || [])
    } catch {
      // silent — gateway may be offline
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchApprovals()
    intervalRef.current = setInterval(fetchApprovals, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchApprovals])

  const handleAction = async (id: string, action: 'approve' | 'deny' | 'always_allow') => {
    setRespondingIds((prev) => ({ ...prev, [id]: action }))

    // Optimistic update
    const newStatus = action === 'deny' ? 'denied' : 'approved'
    setApprovals((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus as ExecApprovalRequest['status'] } : a))
    )

    try {
      const res = await fetch('/api/exec-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      if (!res.ok) {
        // Revert optimistic update on failure
        setApprovals((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'pending' } : a))
        )
      }
    } catch {
      setApprovals((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'pending' } : a))
      )
    } finally {
      setRespondingIds((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const pendingCount = approvals.filter((a) => a.status === 'pending').length

  const filtered = approvals.filter((a) => {
    if (filter === 'pending') return a.status === 'pending'
    if (filter === 'resolved') return a.status !== 'pending'
    return true
  })

  // Mark expired approvals client-side
  const now = Date.now()
  const displayApprovals = filtered.map((a) => {
    if (a.status === 'pending' && a.expiresAt && a.expiresAt < now) {
      return { ...a, status: 'expired' as const }
    }
    return a
  })

  return (
    <div className="m-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Exec Approvals</h2>
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400 animate-pulse">
              {pendingCount} pending
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setLoading(true); fetchApprovals() }}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(['all', 'pending', 'resolved'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 text-sm capitalize transition-colors ${
              filter === tab
                ? 'text-foreground border-b-2 border-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Approval list */}
      {displayApprovals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {filter === 'pending'
            ? 'No pending approvals. Execution requests from agents will appear here.'
            : 'No approvals to display.'}
        </div>
      ) : (
        <div className="space-y-3">
          {displayApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              respondingAction={respondingIds[approval.id]}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ApprovalCard({
  approval,
  respondingAction,
  onAction,
}: {
  approval: ExecApprovalRequest
  respondingAction?: string
  onAction: (id: string, action: 'approve' | 'deny' | 'always_allow') => void
}) {
  const riskBorder = RISK_BORDER[approval.risk]
  const riskBadge = RISK_BADGE[approval.risk]
  const isPending = approval.status === 'pending'
  const isExpired = approval.status === 'expired'

  return (
    <div className={`rounded-lg border border-border bg-card p-4 border-l-4 ${riskBorder}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">
            {approval.agentName || approval.sessionId}
          </span>
          <span className="font-mono text-xs bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">
            {approval.toolName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${riskBadge.bg} ${riskBadge.text}`}>
            {approval.risk}
          </span>
          <span className="text-xs text-muted-foreground">
            {timeAgo(approval.createdAt)}
          </span>
        </div>
      </div>

      {/* Tool args */}
      {approval.toolArgs && Object.keys(approval.toolArgs).length > 0 && (
        <pre className="bg-secondary rounded p-2 text-xs font-mono overflow-auto max-h-32 text-foreground mb-2">
          {JSON.stringify(approval.toolArgs, null, 2)}
        </pre>
      )}

      {/* Command block */}
      {approval.command && (
        <pre className="bg-secondary rounded p-2 text-xs font-mono overflow-auto max-h-20 text-foreground mb-2 border border-border">
          <code>$ {approval.command}</code>
        </pre>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 mt-3">
        {isPending ? (
          <>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={!!respondingAction}
              onClick={() => onAction(approval.id, 'approve')}
            >
              {respondingAction === 'approve' ? 'Approving...' : 'Approve'}
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={!!respondingAction}
              onClick={() => onAction(approval.id, 'deny')}
            >
              {respondingAction === 'deny' ? 'Denying...' : 'Deny'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!!respondingAction}
              onClick={() => onAction(approval.id, 'always_allow')}
            >
              {respondingAction === 'always_allow' ? 'Saving...' : 'Always Allow'}
            </Button>
          </>
        ) : isExpired ? (
          <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Expired
          </span>
        ) : (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              approval.status === 'approved'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {approval.status === 'approved' ? 'Approved' : 'Denied'}
          </span>
        )}
      </div>
    </div>
  )
}
