'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import type {
  BulkRedeployResponse,
  BulkRedeployErrorResponse,
} from '../api/bulk-redeploy'

/**
 * Bulk-redeploy modal (#516). Rolls force-new-deployment across many
 * agent-harness ECS services in one operator action — the UI counterpart to
 * `POST /api/fleet/bulk-redeploy`. Portaled to <body> like the create/delete
 * forms; Esc / backdrop / Cancel close it (ignored mid-submit).
 *
 * Two filter modes are exposed here:
 *   - **All harnesses** — rolls every Component=agent-harness service.
 *   - **Explicit selection** — checkbox subset of the agent rows.
 * (The API also supports `by-tag`; it has no useful per-agent tag to key on
 * yet, so it's intentionally not surfaced in the UI — see #516 follow-up.)
 *
 * Confirmation is **server-driven**: the handler returns 400
 * `ConfirmationRequired { count, expected }` when the resolved target count
 * exceeds 5. We surface that count + require the operator to type the exact
 * `REDEPLOY-N-AGENTS` token, then resubmit. Using the server's count avoids
 * the UI guessing at "all" cardinality (which it can't know precisely without
 * the tag-filtered discovery the handler performs).
 *
 * After a 202 we show the per-service result summary and call `onDone` so the
 * parent refreshes; the existing 5s Fleet poll then reflects each rollout.
 */

export interface BulkRedeployAgent {
  /** Full ECS service name — the value sent in explicit filter.services. */
  serviceName: string
  /** Friendly agent name for display. */
  displayName: string
}

interface BulkRedeployFormProps {
  open: boolean
  agents: BulkRedeployAgent[]
  onClose: () => void
  onDone: () => void
}

type Mode = 'all' | 'explicit'

export function BulkRedeployForm({
  open,
  agents,
  onClose,
  onDone,
}: BulkRedeployFormProps) {
  const [mode, setMode] = useState<Mode>('all')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Server-driven confirm gate: set when the API returns ConfirmationRequired.
  const [pendingConfirm, setPendingConfirm] = useState<{
    count: number
    expected: string
  } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [result, setResult] = useState<BulkRedeployResponse | null>(null)

  // Reset everything whenever the modal (re)opens.
  useEffect(() => {
    if (open) {
      setMode('all')
      setSelected({})
      setSubmitting(false)
      setError(null)
      setPendingConfirm(null)
      setConfirmText('')
      setResult(null)
    }
  }, [open])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    },
    [onClose, submitting],
  )

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  if (!open) return null

  const selectedNames = agents
    .filter((a) => selected[a.serviceName])
    .map((a) => a.serviceName)

  const explicitInvalid = mode === 'explicit' && selectedNames.length === 0

  const submit = async () => {
    if (submitting) return
    // When the confirm gate is armed, the typed token must match.
    if (pendingConfirm && confirmText !== pendingConfirm.expected) return
    setSubmitting(true)
    setError(null)
    try {
      const filter =
        mode === 'all'
          ? { mode: 'all' as const }
          : { mode: 'explicit' as const, services: selectedNames }
      const resp = await fetch('/api/fleet/bulk-redeploy', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter,
          ...(pendingConfirm ? { confirm: confirmText } : {}),
        }),
      })
      const body = (await resp.json()) as
        | BulkRedeployResponse
        | BulkRedeployErrorResponse
      if (!resp.ok) {
        const ebody = body as BulkRedeployErrorResponse
        if (
          ebody.error === 'ConfirmationRequired' &&
          ebody.expected &&
          typeof ebody.count === 'number'
        ) {
          // Transition into the confirm sub-state. The operator now sees the
          // resolved count and must type the token.
          setPendingConfirm({ count: ebody.count, expected: ebody.expected })
          setConfirmText('')
          setSubmitting(false)
          return
        }
        const offenders = ebody.services?.length
          ? ` (${ebody.services.join(', ')})`
          : ''
        setError(`${ebody.error}${offenders}`)
        setSubmitting(false)
        return
      }
      setResult(body as BulkRedeployResponse)
      // Clear submitting so the success screen's Esc / backdrop / ✕ dismissal
      // paths (all gated on !submitting) work, not just the Done button.
      setSubmitting(false)
      onDone()
    } catch {
      setError('NetworkError')
      setSubmitting(false)
    }
  }

  const confirmArmed = !pendingConfirm || confirmText === pendingConfirm.expected
  const submitDisabled = submitting || explicitInvalid || !confirmArmed

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !submitting && onClose()}
      data-testid="bulk-redeploy-modal"
    >
      <div
        className="bg-background border rounded-lg shadow-lg w-full max-w-lg m-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">Bulk redeploy</h2>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {result ? (
          <div data-testid="bulk-redeploy-success">
            <p className="text-sm text-green-700 mb-3">
              Redeploy issued for {result.count} agent
              {result.count === 1 ? '' : 's'}.
            </p>
            <div className="text-xs text-muted-foreground mb-4 max-h-48 overflow-y-auto">
              <ul className="space-y-0.5">
                {result.results.map((r) => (
                  <li key={r.service}>
                    <code>{r.service}</code>{' '}
                    {r.ok ? (
                      <span className="text-green-700">rolling</span>
                    ) : (
                      <span className="text-destructive">
                        failed: {r.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Rollout progress shows in the Fleet table (auto-refreshes every
              few seconds while deployments are in flight).
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : pendingConfirm ? (
          <div data-testid="bulk-redeploy-confirm">
            <p className="text-sm text-muted-foreground mb-2">
              This will force a new deployment on{' '}
              <strong>{pendingConfirm.count}</strong> agent
              {pendingConfirm.count === 1 ? '' : 's'}. Type{' '}
              <code className="font-mono">{pendingConfirm.expected}</code> to
              confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4 font-mono text-sm"
              autoFocus
              data-testid="bulk-redeploy-confirm-input"
            />
            {error ? (
              <div className="text-sm text-destructive mb-3">
                <code>{error}</code>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => !submitting && onClose()}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={submitDisabled}
                data-testid="bulk-redeploy-confirm-button"
              >
                {submitting ? 'Redeploying…' : 'Confirm redeploy'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Force a fresh deployment (same task def, no scale change) across
              agent harnesses — e.g. after merging a fix + image push.
            </p>

            <div className="space-y-2 mb-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="bulk-mode"
                  checked={mode === 'all'}
                  onChange={() => setMode('all')}
                  data-testid="bulk-mode-all"
                />
                All agent harnesses
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="bulk-mode"
                  checked={mode === 'explicit'}
                  onChange={() => setMode('explicit')}
                  data-testid="bulk-mode-explicit"
                />
                Select specific agents
              </label>
            </div>

            {mode === 'explicit' ? (
              <div className="border rounded p-2 mb-4 max-h-56 overflow-y-auto">
                {agents.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No agents available.
                  </div>
                ) : (
                  agents.map((a) => (
                    <label
                      key={a.serviceName}
                      className="flex items-center gap-2 text-sm py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={!!selected[a.serviceName]}
                        onChange={(e) =>
                          setSelected((s) => ({
                            ...s,
                            [a.serviceName]: e.target.checked,
                          }))
                        }
                        data-testid={`bulk-select-${a.serviceName}`}
                      />
                      <span className="font-mono">{a.displayName}</span>
                    </label>
                  ))
                )}
              </div>
            ) : (
              <p className="text-sm mb-4">
                Targets <strong>{agents.length}</strong> agent
                {agents.length === 1 ? '' : 's'} currently shown in the Fleet
                table. The server re-resolves the exact set at submit time.
              </p>
            )}

            {error ? (
              <div
                className="text-sm text-destructive mb-3"
                data-testid="bulk-redeploy-error"
              >
                <code>{error}</code>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => !submitting && onClose()}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={submitDisabled}
                data-testid="bulk-redeploy-submit"
              >
                {submitting
                  ? 'Redeploying…'
                  : mode === 'explicit'
                    ? `Redeploy ${selectedNames.length} selected`
                    : 'Redeploy all'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
