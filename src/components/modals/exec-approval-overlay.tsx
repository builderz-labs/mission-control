'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl, type ExecApprovalRequest } from '@/store'
import { useWebSocket } from '@/lib/websocket'

const RISK_BORDER: Record<ExecApprovalRequest['risk'], string> = {
  low: 'border-l-green-500',
  medium: 'border-l-yellow-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-500',
}

const RISK_BADGE: Record<ExecApprovalRequest['risk'], string> = {
  low: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
}

function formatRemaining(ms: number): string {
  const remaining = Math.max(0, ms)
  const totalSeconds = Math.floor(remaining / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h`
}

function MetaRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground truncate ml-4 max-w-[300px]">{value}</span>
    </div>
  )
}

export function ExecApprovalOverlay() {
  const { execApprovals, updateExecApproval } = useMissionControl()
  const { sendMessage } = useWebSocket()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const pending = execApprovals.filter(a => a.status === 'pending')
  const active = pending[0]

  // Tick every second to update expiry countdown
  useEffect(() => {
    if (!active) return
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [active?.id])

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
        const res = await fetch('/api/exec-approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: active.id, action }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error || 'Failed to send decision')
          setBusy(false)
          return
        }
      } catch {
        setError('Failed to reach gateway')
        setBusy(false)
        return
      }
    }

    // Optimistic update
    const newStatus = decision === 'deny' ? 'denied' : 'approved'
    updateExecApproval(active.id, { status: newStatus as ExecApprovalRequest['status'] })
    setBusy(false)
  }, [active, busy, sendMessage, updateExecApproval])

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
