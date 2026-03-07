'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMissionControl } from '@/store'

interface PendingRequest {
  id: number
  email: string
  displayName: string | null
  avatarUrl: string | null
  providerUserId: string | null
  attemptCount: number
  requestedAt: number
  lastAttemptAt: number
}

interface ApprovalHistoryEntry extends PendingRequest {
  status: 'approved' | 'rejected'
  reviewedBy: string | null
  reviewedAt: number | null
  note: string | null
  expiresAt: number | null
}

const statusStyles: Record<'approved' | 'rejected', string> = {
  approved: 'text-emerald-300 border-emerald-300/60 bg-emerald-500/10',
  rejected: 'text-red-300 border-red-300/60 bg-red-500/10',
}

const formatTimestamp = (value: number | null | undefined) => {
  if (!value) return '—'
  return new Date(value * 1000).toLocaleString()
}

export function OAuthApprovalsPanel() {
  const { currentUser } = useMissionControl()
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [history, setHistory] = useState<ApprovalHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/oauth-approvals', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to load OAuth approvals')
        return
      }
      setPending(Array.isArray(data?.pending) ? data.pending : [])
      setHistory(Array.isArray(data?.history) ? data.history : [])
    } catch (err) {
      setError('Failed to load OAuth approvals')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchData()
  }

  const pendingCount = pending.length
  const approvalsCount = history.filter((entry) => entry.status === 'approved').length
  const rejectsCount = history.filter((entry) => entry.status === 'rejected').length

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-semibold text-foreground mb-2">Access Denied</div>
        <p className="text-sm text-muted-foreground">OAuth approvals are limited to admin users.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">OAuth approvals</h2>
          <p className="text-sm text-muted-foreground">Track pending Google sign-in approvals and recent decisions.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {pendingCount} pending · {approvalsCount} approved · {rejectsCount} rejected
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="h-9 px-3 rounded-md border border-border text-xs font-semibold text-foreground hover:border-primary hover:text-primary transition-smooth disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-4 rounded-xl border border-border bg-secondary/50 text-sm text-muted-foreground">Loading approvals…</div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-sm text-red-200">{error}</div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Pending requests</h3>
            <p className="text-xs text-muted-foreground">Awaiting admin review before granting access.</p>
          </div>
          <p className="text-xs text-muted-foreground">Approve or reject from the Users panel.</p>
        </div>
        <div className="border border-border rounded-xl overflow-hidden">
          {pending.length === 0 && !loading ? (
            <div className="p-4 text-sm text-muted-foreground">No pending Google approvals.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-xs text-muted-foreground uppercase tracking-wide bg-secondary/20">
                    <th className="px-3 py-2">Identity</th>
                    <th className="px-3 py-2">Attempts</th>
                    <th className="px-3 py-2">Requested</th>
                    <th className="px-3 py-2">Last attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((request) => (
                    <tr key={request.id} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{request.displayName || request.email}</div>
                        <div className="text-xs text-muted-foreground">{request.email}</div>
                        {request.providerUserId && (
                          <div className="text-[11px] text-muted-foreground">ID {request.providerUserId}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[13px] text-muted-foreground">{request.attemptCount}</td>
                      <td className="px-3 py-2 text-[13px] text-muted-foreground">{formatTimestamp(request.requestedAt)}</td>
                      <td className="px-3 py-2 text-[13px] text-muted-foreground">{formatTimestamp(request.lastAttemptAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Recent history</h3>
          <p className="text-xs text-muted-foreground">Approvals and rejections with reviewer metadata.</p>
        </div>
        <div className="border border-border rounded-xl overflow-hidden">
          {history.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No approvals or rejections recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-xs text-muted-foreground uppercase tracking-wide bg-secondary/20">
                    <th className="px-3 py-2">Identity</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Reviewed by</th>
                    <th className="px-3 py-2">Reviewed at</th>
                    <th className="px-3 py-2">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{entry.displayName || entry.email}</div>
                        <div className="text-xs text-muted-foreground">{entry.email}</div>
                        {entry.providerUserId && (
                          <div className="text-[11px] text-muted-foreground">ID {entry.providerUserId}</div>
                        )}
                        {entry.note && (
                          <div className="text-[11px] text-muted-foreground italic">&quot;{entry.note}&quot;</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${statusStyles[entry.status]}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{entry.reviewedBy || '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatTimestamp(entry.reviewedAt)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{entry.expiresAt ? formatTimestamp(entry.expiresAt) : 'Not issued'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
