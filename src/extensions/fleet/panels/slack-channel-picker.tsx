'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type {
  SlackChannelsResponse,
  SlackChannelsErrorResponse,
} from '../api/slack-channels'

// Phase 2.4 Beat 5c.2 — Slack channel picker.
//
// Three-stage UI:
//   1. Mount → GET /api/fleet/agents/{name}/slack/channels.
//      The endpoint reads the bot token from Secrets Manager
//      (Beat 5b.3) and calls Slack `conversations.list`.
//   2. Operator toggles channel checkboxes; selection state
//      is local and only sent to the server on Save.
//   3. Save → PUT /api/fleet/agents/{name}/slack/channels.
//      Today this is a 501 stub (auth-gated); the real
//      channels-only update path is tracked as
//      ender-stack#283. The picker surfaces the 501 with the
//      operator-actionable hint pointing at that issue.
//
// Recovery flows:
//   - SlackBotTokenNotFound (operator hasn't pasted credentials
//     yet) → no Retry button, just a hint pointing to the
//     credentials form above. The form's onSaved bumps
//     reloadKey, which auto-refreshes the picker.
//   - Transient errors (rate-limit, network, timeout) → Retry
//     button preserves the operator's checkbox state.
//   - Real PUT 501 (channels-update endpoint not yet wired) →
//     ender-stack#283 hint inline; operator path is to wait
//     for the real handler to ship.

const FETCH_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 30_000
// Mirror server-side cap from slack-credentials.ts.
const MAX_CHANNELS_PER_AGENT = 50

interface Props {
  agentName: string
  /**
   * Triggers a fresh fetch when bumped (e.g., after the
   * credentials form successfully saves). Caller increments
   * to invalidate the stale 404 SlackBotTokenNotFound state.
   */
  reloadKey: number
}

interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
  numMembers?: number
}

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'success'
      channels: SlackChannel[]
      truncated: boolean
    }
  | {
      kind: 'error'
      status: number
      body: SlackChannelsErrorResponse
    }

type SaveState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'saved' }
  | {
      kind: 'error'
      status: number
      body: SlackChannelsErrorResponse
    }

export function SlackChannelPicker({ agentName, reloadKey }: Props) {
  const [state, setState] = useState<FetchState>({ kind: 'idle' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [retryKey, setRetryKey] = useState(0)
  const fetchAbortRef = useRef<AbortController | null>(null)
  const saveAbortRef = useRef<AbortController | null>(null)
  // Round-2 audit on PR #51: unmount guard for handleSave's catch
  // block. Pre-fix, the catch called setSaveState unconditionally,
  // which fires on an unmounted component when the unmount-cleanup
  // effect aborts the controller. React 18+ swallows it silently
  // but the inconsistency with the credentials-form's mountedRef
  // pattern was real.
  const mountedRef = useRef(true)

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      fetchAbortRef.current?.abort()
      saveAbortRef.current?.abort()
    }
  }, [])

  // Reset operator's selections only on a true context-switch:
  // agent change, or credentials-form bumped reloadKey (token
  // material changed → channel list shape may differ). NOT on
  // retryKey bumps, which fire after transient errors where
  // preserving the prior picks is the obvious operator
  // expectation.
  useEffect(() => {
    setSelected(new Set())
  }, [agentName, reloadKey])

  // Fetch channels when agentName / reloadKey / retryKey changes.
  useEffect(() => {
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    let timedOut = false
    let cleanupAborted = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, FETCH_TIMEOUT_MS)

    setState({ kind: 'loading' })
    setSaveState({ kind: 'idle' })
    // Round-1 audit on PR #51: only reset `selected` when the
    // operator switches agents OR the credentials form fires
    // reloadKey (fresh credential paste — channel list shape may
    // change). On a retryKey bump (transient error retry) keep
    // the operator's prior selections so they don't lose work.

    void (async () => {
      try {
        const resp = await fetch(
          `/api/fleet/agents/${encodeURIComponent(agentName)}/slack/channels`,
          { signal: controller.signal },
        )
        clearTimeout(timeout)
        if (resp.ok) {
          const body = (await resp.json()) as SlackChannelsResponse
          if (!cleanupAborted) {
            setState({
              kind: 'success',
              channels: body.channels,
              truncated: body.truncated,
            })
          }
          return
        }
        let body: SlackChannelsErrorResponse
        try {
          body = (await resp.json()) as SlackChannelsErrorResponse
        } catch {
          body = { error: `HTTP ${resp.status}` }
        }
        if (!cleanupAborted) {
          setState({ kind: 'error', status: resp.status, body })
        }
      } catch (err) {
        clearTimeout(timeout)
        if (cleanupAborted) return
        if (timedOut) {
          setState({
            kind: 'error',
            status: 0,
            body: {
              error: 'Timeout',
              detail: `Channel-list request timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
            },
          })
          return
        }
        setState({
          kind: 'error',
          status: 0,
          body: {
            error: 'NetworkError',
            detail: (err as Error).message,
          },
        })
      }
    })()

    return () => {
      cleanupAborted = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [agentName, reloadKey, retryKey])

  const toggleChannel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Save — placeholder. Channels-only update is not yet a
  // server endpoint; the credentials POST handler requires
  // all three tokens. For Beat 5c.2 v1 we render the picker
  // UI and surface "save channels" as a no-op + follow-up
  // marker. A subsequent PR will either (a) extend the POST
  // handler to accept channels-only updates by re-reading the
  // existing tokens from SM, or (b) add a dedicated
  // PUT /slack/channels endpoint.
  //
  // For now: clicking Save sends an explicit save-call to a
  // future channels-update path. The endpoint returns 501 today
  // (we surface the 501 detail to the operator). Tracked as
  // ender-stack#283.
  const handleSave = async () => {
    if (state.kind !== 'success') return
    if (selected.size === 0) return

    setSaveState({ kind: 'submitting' })
    saveAbortRef.current?.abort()
    const controller = new AbortController()
    saveAbortRef.current = controller
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)

    try {
      // Hit the channels-update endpoint that doesn't yet
      // exist server-side. Server returns 501; UI surfaces it
      // with a follow-up hint pointing at ender-stack#283.
      const resp = await fetch(
        `/api/fleet/agents/${encodeURIComponent(agentName)}/slack/channels`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            channels: Array.from(selected),
          }),
          signal: controller.signal,
        },
      )
      clearTimeout(timeout)
      if (!mountedRef.current) return
      if (resp.ok) {
        setSaveState({ kind: 'saved' })
        return
      }
      let body: SlackChannelsErrorResponse
      try {
        body = (await resp.json()) as SlackChannelsErrorResponse
      } catch {
        body = { error: `HTTP ${resp.status}` }
      }
      setSaveState({ kind: 'error', status: resp.status, body })
    } catch (err) {
      clearTimeout(timeout)
      if (!mountedRef.current) return
      if (controller.signal.aborted) {
        setSaveState({
          kind: 'error',
          status: 0,
          body: {
            error: 'RequestAborted',
            detail: 'Channel-save request timed out or was cancelled',
          },
        })
        return
      }
      setSaveState({
        kind: 'error',
        status: 0,
        body: { error: 'NetworkError', detail: (err as Error).message },
      })
    }
  }

  const overCap = selected.size > MAX_CHANNELS_PER_AGENT
  const saveDisabled =
    state.kind !== 'success' ||
    selected.size === 0 ||
    overCap ||
    saveState.kind === 'submitting'

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <div
        className="text-sm text-muted-foreground"
        data-testid="slack-channel-picker-loading"
      >
        Loading channels…
      </div>
    )
  }

  if (state.kind === 'error') {
    const isBotTokenMissing = state.body.error === 'SlackBotTokenNotFound'
    return (
      <div
        className="p-3 rounded-md bg-destructive/10 text-destructive text-sm space-y-2"
        data-testid="slack-channel-picker-error"
      >
        <div className="font-semibold">
          {state.body.error}
          {state.status > 0 ? ` (HTTP ${state.status})` : ''}
        </div>
        {state.body.detail ? (
          <div>
            <code className="text-xs">{state.body.detail}</code>
          </div>
        ) : null}
        {isBotTokenMissing ? (
          <div className="text-xs">
            Save credentials in the form above first; the picker
            will refresh automatically.
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetryKey((k) => k + 1)}
            data-testid="slack-channel-picker-retry"
          >
            Retry
          </Button>
        )}
      </div>
    )
  }

  return (
    <div data-testid="slack-channel-picker" className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          Channels ({state.channels.length})
        </h4>
        <div className="text-xs text-muted-foreground">
          Selected: {selected.size}
          {overCap ? (
            <span className="text-destructive ml-1">
              · over {MAX_CHANNELS_PER_AGENT}-channel cap
            </span>
          ) : null}
        </div>
      </div>

      {state.truncated ? (
        <div
          className="text-xs text-amber-700"
          data-testid="slack-channel-picker-truncated"
        >
          Showing first 100 channels — your workspace has more. Edit
          via Slack admin if a target channel is missing.
        </div>
      ) : null}

      {state.channels.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No channels available. The bot may not be invited to any
          channels yet — invite it from Slack first.
        </div>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-64 overflow-y-auto border border-border rounded-md p-2 bg-secondary"
          data-testid="slack-channel-picker-list"
        >
          {state.channels.map((c) => {
            const isSelected = selected.has(c.id)
            return (
              <label
                key={c.id}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-background/50 rounded px-1 py-0.5"
                data-testid={`slack-channel-row-${c.id}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleChannel(c.id)}
                  data-testid={`slack-channel-checkbox-${c.id}`}
                />
                <span className="font-mono">
                  {c.isPrivate ? '🔒 ' : '# '}
                  {c.name}
                </span>
                {typeof c.numMembers === 'number' ? (
                  <span className="text-muted-foreground">
                    ({c.numMembers})
                  </span>
                ) : null}
              </label>
            )
          })}
        </div>
      )}

      {saveState.kind === 'error' ? (
        <div
          className="p-2 rounded-md bg-destructive/10 text-destructive text-xs"
          data-testid="slack-channel-picker-save-error"
        >
          <div className="font-semibold">
            {saveState.body.error}
            {saveState.status > 0 ? ` (HTTP ${saveState.status})` : ''}
          </div>
          {saveState.body.detail ? (
            <div className="mt-1">
              <code>{saveState.body.detail}</code>
            </div>
          ) : null}
          {/*
            TODO(ender-stack#283): when the real PUT handler
            ships, remove this entire 501 branch. The
            corresponding test in slack-channel-picker.test.tsx
            (`Save button surfaces 501 with ender-stack#283
            hint`) and the slack-channels.ts PUT stub need to
            move in the same PR.
          */}
          {saveState.status === 501 ? (
            <div className="mt-1">
              Channels-update endpoint isn&apos;t implemented yet —
              tracked as ender-stack#283.
            </div>
          ) : null}
        </div>
      ) : null}

      {saveState.kind === 'saved' ? (
        <div
          className="text-xs text-green-700"
          data-testid="slack-channel-picker-saved"
        >
          ✓ Channel selection saved.
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          onClick={() => void handleSave()}
          disabled={saveDisabled}
          data-testid="slack-channel-picker-save"
        >
          {saveState.kind === 'submitting' ? 'Saving…' : 'Save channels'}
        </Button>
      </div>
    </div>
  )
}
