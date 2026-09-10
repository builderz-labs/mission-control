'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { usePermissionMode } from '@/components/chat/use-permission-mode'
import { useMissionControl, type ExecApprovalRequest } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { apiFetch, ApiError } from '@/lib/api-client'
import { formatRemaining, MetaRow, RISK_BADGE, RISK_BORDER } from './exec-approval-ui'

export function ExecApprovalOverlay() {
  const { execApprovals, updateExecApproval } = useMissionControl()
  const { sendMessage } = useWebSocket()
  const permission = usePermissionMode()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const pending = execApprovals.filter(a => a.status === 'pending')
  const active = pending[0]
  const activeId = active?.id

  // Tick every second to update expiry countdown
  useEffect(() => {
    if (!activeId) return
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [activeId])

  // Auto-expire client-side
  useEffect(() => {
    if (!active?.expiresAt) return
    if (active.expiresAt < Date.now()) {
      updateExecApproval(active.id, { status: 'expired' })
    }
  }, [active, updateExecApproval])

  const handleDecision = useCallback(async (decision: 'allow-once' | 'allow-always' | 'deny') => {
    if (!active || busy) return
    setBusy(true)
    setError(null)

    // Try WebSocket RPC first
    const sent = sendMessage({
      type: 'req',
      method: 'exec.approval.resolve',
      id: `ea-${Date.now()}`,
      params: { id: active.id, decision },
    })

    if (!sent) {
      // Fallback to HTTP
      try {
        const action = decision === 'deny' ? 'deny' : decision === 'allow-always' ? 'always_allow' : 'approve'
        const res = await apiFetch<Response>('/api/exec-approvals', {
          method: 'POST',
          body: JSON.stringify({ id: active.id, action }),
          raw: true,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error || 'Failed to send decision')
          setBusy(false)
          return
        }
      } catch (requestError) {
        if (requestError instanceof ApiError && requestError.code !== 'NETWORK_ERROR') {
          const payload = requestError.payload
          const detail = payload && typeof payload === 'object' && 'error' in payload
            && typeof payload.error === 'string' ? payload.error : null
          setError(detail || requestError.message || 'Failed to send decision')
        } else {
          setError('Failed to reach gateway')
        }
        setBusy(false)
        return
      }
    }

    // Optimistic update
    const newStatus = decision === 'deny' ? 'denied' : 'approved'
    updateExecApproval(active.id, { status: newStatus as ExecApprovalRequest['status'] })
    setBusy(false)
  }, [active, busy, sendMessage, updateExecApproval])

  useEffect(() => {
    if (permission.mode !== 'bypass' || !active || busy || error) return
    void handleDecision('allow-once')
  }, [permission.mode, active, busy, error, handleDecision])

  if (!active) return null

  const remainingMs = active.expiresAt ? active.expiresAt - Date.now() : null
  const remainingText = remainingMs !== null
    ? (remainingMs > 0 ? `expires in ${formatRemaining(remainingMs)}` : 'expired')
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
      role="dialog"
      aria-live="polite"
      aria-label="Execution approval required"
    >
      <div className={`w-[min(540px,95vw)] bg-card border border-border rounded-lg p-5 shadow-2xl border-l-4 ${RISK_BORDER[active.risk]}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Exec approval needed</div>
            {remainingText && (
              <div className="text-xs text-muted-foreground mt-0.5">{remainingText}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${RISK_BADGE[active.risk]}`}>
              {active.risk}
            </span>
            {pending.length > 1 && (
              <span className="text-xs font-medium text-muted-foreground bg-secondary rounded-full px-2 py-0.5">
                {pending.length} pending
              </span>
            )}
          </div>
        </div>

        {/* Command */}
        {active.command && (
          <pre className="bg-secondary rounded p-3 text-xs font-mono overflow-auto max-h-24 text-foreground mb-3 border border-border">
            <code>$ {active.command}</code>
          </pre>
        )}

        {/* Tool args (if no command) */}
        {!active.command && active.toolArgs && Object.keys(active.toolArgs).length > 0 && (
          <pre className="bg-secondary rounded p-3 text-xs font-mono overflow-auto max-h-32 text-foreground mb-3">
            {JSON.stringify(active.toolArgs, null, 2)}
          </pre>
        )}

        {/* Metadata */}
        <div className="mb-3">
          <MetaRow label="Agent" value={active.agentName} />
          <MetaRow label="Session" value={active.sessionId} />
          <MetaRow label="Tool" value={active.toolName} />
          <MetaRow label="CWD" value={active.cwd} />
          <MetaRow label="Host" value={active.host} />
          <MetaRow label="Resolved" value={active.resolvedPath} />
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs text-red-400 mb-3">{error}</div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
            disabled={busy}
            onClick={() => handleDecision('allow-once')}
          >
            {busy ? 'Sending...' : 'Allow once'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => handleDecision('allow-always')}
          >
            Always allow
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={busy}
            onClick={() => handleDecision('deny')}
          >
            Deny
          </Button>
        </div>
      </div>
    </div>
  )
}
