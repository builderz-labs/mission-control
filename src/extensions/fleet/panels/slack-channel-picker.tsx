'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

/** Per-channel selection state (#291). */
export interface SelectedChannelState {
  /** When true: respond only on @bot mention (OpenClaw default). */
  requireMention: boolean
}

/**
 * Pure helper: prune a selection map to the intersection with
 * the given channel list. Returns the same Map ref when no
 * pruning is needed so React skips a re-render.
 *
 * Round-1 audits on PR #55 (claude-bot + greptile, ender-stack#283):
 * extracted from the inline fetch-success setState branch so the
 * filter logic is unit-testable. The inline call site is
 * defensive code today (no operator-reachable path bumps
 * retryKey while selections are non-empty), but lives in the
 * pipeline so future refresh paths inherit the safety.
 *
 * #291: extended from Set<string> to Map<string, SelectedChannelState>
 * so per-channel requireMention state is preserved.
 */
export function pruneSelectedToChannels(
  selected: Map<string, SelectedChannelState>,
  channels: Array<{ id: string } | string>,
): Map<string, SelectedChannelState> {
  const validIds = new Set(
    channels.map((c) => (typeof c === 'string' ? c : c.id)),
  )
  const filtered = new Map<string, SelectedChannelState>()
  for (const [id, state] of selected) {
    if (validIds.has(id)) filtered.set(id, state)
  }
  return filtered.size === selected.size ? selected : filtered
}

export function SlackChannelPicker({ agentName, reloadKey }: Props) {
  const [state, setState] = useState<FetchState>({ kind: 'idle' })
  const [selected, setSelected] = useState<
    Map<string, SelectedChannelState>
  >(new Map())
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
    setSelected(new Map())
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
            // Round-5 audit on PR #51 (#283 cleanup item):
            // ghost-selection filter. The picker preserves
            // `selected` across transient-error retries (correct
            // UX). But if the retry yields a different channel
            // list (a channel was deleted or un-invited between
            // fetch + retry), `selected` retains IDs no longer
            // in `state.channels`. Pre-#283 this was benign
            // because PUT returned 501; post-#283 the stale IDs
            // would PUT to the server. Filter to the
            // intersection at the success boundary.
            setSelected((prev) => pruneSelectedToChannels(prev, body.channels))
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
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, { requireMention: true })
      return next
    })
  }

  /**
   * Per-channel toggle (#291). Flip whether the agent waits for a
   * mention before replying in this channel. Only meaningful when
   * the channel is selected — call site gates on that.
   */
  const toggleRequireMention = (id: string) => {
    setSelected((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(id, { requireMention: !cur.requireMention })
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
            // #291: emit object form so per-channel requireMention
            // round-trips to the agent's openclaw.json.
            channels: Array.from(selected.entries()).map(
              ([id, s]) => ({ id, requireMention: s.requireMention }),
            ),
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
        <SlackChannelMultiSelect
          // Round-1 audit on PR #57 (claude-bot P3): force remount
          // on context switch so the local search query state
          // doesn't survive an agent change or credentials refresh.
          // Without this, an operator who saved a query like
          // "alpha" then switched agents would see a partially
          // filtered list with no obvious cause.
          key={`${agentName}:${reloadKey}`}
          channels={state.channels}
          selected={selected}
          onToggle={toggleChannel}
          onToggleRequireMention={toggleRequireMention}
        />
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

/**
 * Search + multi-select control (ender-stack#290). Replaces the
 * flat checkbox grid that didn't scale past ~20 channels.
 *
 * UX shape:
 *   - Selected channels render as removable pills above the input
 *   - Typeahead input filters by case-insensitive substring on
 *     `name`. Empty query shows the full list.
 *   - Filtered list is virtualization-light (capped height +
 *     overflow-y) — workspaces this large should hit cursor
 *     pagination first (separate gap).
 *   - Clicking a list row toggles selection (add or remove);
 *     clicking a pill's × removes that selection.
 */
function SlackChannelMultiSelect({
  channels,
  selected,
  onToggle,
  onToggleRequireMention,
}: {
  channels: SlackChannel[]
  selected: Map<string, SelectedChannelState>
  onToggle: (id: string) => void
  onToggleRequireMention: (id: string) => void
}) {
  const [query, setQuery] = useState('')

  const channelsById = useMemo(() => {
    const m = new Map<string, SlackChannel>()
    for (const c of channels) m.set(c.id, c)
    return m
  }, [channels])

  const selectedChannels = useMemo(() => {
    const arr: Array<SlackChannel & { requireMention: boolean }> = []
    for (const [id, st] of selected) {
      const c = channelsById.get(id)
      if (c) arr.push({ ...c, requireMention: st.requireMention })
    }
    return arr
  }, [channelsById, selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((c) => c.name.toLowerCase().includes(q))
  }, [channels, query])

  return (
    <div className="space-y-2" data-testid="slack-channel-picker-list">
      {selectedChannels.length > 0 ? (
        <div
          className="flex flex-wrap gap-1"
          data-testid="slack-channel-picker-pills"
        >
          {selectedChannels.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5"
              data-testid={`slack-channel-pill-${c.id}`}
            >
              <span className="font-mono">
                {c.isPrivate ? '🔒 ' : '# '}
                {c.name}
              </span>
              <button
                type="button"
                onClick={() => onToggleRequireMention(c.id)}
                data-testid={`slack-channel-pill-mode-${c.id}`}
                aria-label={`Reply mode for ${c.name}: ${c.requireMention ? 'mention only' : 'always reply'}. Click to toggle.`}
                title={
                  c.requireMention
                    ? 'Reply only when @mentioned. Click to switch to always-reply.'
                    : 'Always reply in this channel. Click to switch to mention-only.'
                }
                className={`rounded-sm px-1 ${
                  c.requireMention
                    ? 'bg-primary/20 text-primary'
                    : 'bg-amber-500/20 text-amber-700'
                }`}
              >
                {c.requireMention ? '@-only' : 'always'}
              </button>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => onToggle(c.id)}
                data-testid={`slack-channel-pill-remove-${c.id}`}
                className="text-primary/70 hover:text-primary"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search channels…"
        aria-label="Search channels"
        role="combobox"
        aria-expanded={filtered.length > 0}
        aria-controls="slack-channel-filtered-list"
        data-testid="slack-channel-picker-search"
        className="w-full text-sm rounded-md border border-border bg-background px-2 py-1"
      />

      <div
        id="slack-channel-filtered-list"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Channels"
        className="max-h-64 overflow-y-auto border border-border rounded-md bg-secondary divide-y divide-border"
        data-testid="slack-channel-picker-filtered-list"
      >
        {filtered.length === 0 ? (
          <div
            className="text-xs text-muted-foreground p-2"
            data-testid="slack-channel-picker-no-matches"
          >
            No channels match &ldquo;{query.trim()}&rdquo;.
          </div>
        ) : (
          filtered.map((c) => {
            const isSelected = selected.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                role="option"
                aria-selected={isSelected}
                data-testid={`slack-channel-row-${c.id}`}
                className={`w-full flex items-center gap-2 text-xs text-left px-2 py-1 hover:bg-background/50 ${
                  isSelected ? 'bg-primary/5' : ''
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block w-3 h-3 border rounded-sm ${
                    isSelected
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground'
                  }`}
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
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
