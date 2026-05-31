'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type {
  SlackChannelsResponse,
  SlackChannelsErrorResponse,
} from '../api/slack-channels'
import {
  SLACK_USER_ID_RE,
  type ChannelConfig,
  type ChannelInput,
  type ChannelRole,
  type ChannelAccessMode,
} from '../lib/slack-channel-injection'

// Phase 2.4 Beat 5c.2 — Slack channel picker.
//
// Three-stage UI:
//   1. Mount → GET /api/fleet/agents/{name}/slack/channels.
//      The endpoint reads the bot token from Secrets Manager
//      (Beat 5b.3) and calls Slack `conversations.list`. It also
//      returns the agent's owner Slack ID (#501) for primary-channel
//      assignedUsers prefill.
//   2. Operator selects channels and, per channel, picks a role
//      (primary / active / monitor) + assignedUsers (#494/#501).
//      Selection state is local and only sent to the server on Save.
//   3. Save → PUT /api/fleet/agents/{name}/slack/channels (real
//      handler, ender-stack#283). On 200 a new task-def revision
//      deploys; on 400 (InvalidChannelList — bad format, or a primary
//      channel with no assignedUsers and no owner) the inline error
//      surfaces the server detail and the live config is untouched.
//
// Role taxonomy (#494, mirrors init-config.sh VALID_ROLES):
//   primary — agent's home channel; ambient response to owner +
//             assignedUsers (owner auto-injected downstream).
//   active  — shared team channel; ambient for assignedUsers when
//             accessMode='preferred', else mention-gated.
//   monitor — mention-only presence; assignedUsers ignored.
// When a role is set, requireMention is derived downstream by
// init-config — the legacy @-only/always toggle is shown only for
// role-less (legacy) channels.
//
// Recovery flows:
//   - SlackBotTokenNotFound (operator hasn't pasted credentials
//     yet) → no Retry button, just a hint pointing to the
//     credentials form above. The form's onSaved bumps
//     reloadKey, which auto-refreshes the picker.
//   - Transient errors (rate-limit, network, timeout) → Retry
//     button preserves the operator's selection state.
//   - Save 400 InvalidChannelList → inline server detail; operator
//     fixes the offending channel's role/assignedUsers and re-saves.

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
      /** #501: agent owner Slack ID for primary-channel prefill; undefined when unset. */
      ownerSlackId?: string
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

/** Per-channel selection state (#291, extended #494/#501). */
export interface SelectedChannelState {
  /**
   * When true: respond only on @bot mention (OpenClaw default).
   * Legacy-only — used and emitted ONLY when `role` is undefined.
   * When a role is set, requireMention is derived downstream by
   * init-config and is omitted from the PUT payload (#494).
   */
  requireMention: boolean
  /** #494 role taxonomy. undefined = legacy mention-gated mode. */
  role?: ChannelRole
  /**
   * #501 Slack user IDs allowed to drive the agent in this channel
   * (→ groupAllowFrom downstream). Validated against SLACK_USER_ID_RE
   * on entry; ignored downstream for `monitor`; the owner is
   * auto-prefilled on `primary`.
   */
  assignedUsers?: string[]
  /** #494 only meaningful for `active` (flips requireMention to false). */
  accessMode?: ChannelAccessMode
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
 * so per-channel requireMention state is preserved. #501: the prune
 * copies each value by reference, so the role/assignedUsers/accessMode
 * fields ride along untouched — no per-field handling needed here.
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
  // #501 (Greptile PR #87): the role=primary first-channel default
  // fires at most ONCE per context (mount / agent / reloadKey). Without
  // this latch, clearing the selection mid-edit and re-adding a channel
  // would silently re-default it to primary. The latch lets a genuine
  // new-agent first channel default to primary while a re-add after a
  // clear stays legacy (operator opts into a role explicitly).
  const firstDefaultAppliedRef = useRef(false)

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
    firstDefaultAppliedRef.current = false
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
              ownerSlackId: body.ownerSlackId,
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

  // #501: owner Slack ID (from the GET response) drives primary-channel
  // prefill + the client-side primary-assignment check. undefined when
  // the agent has no usable owner.
  const ownerSlackId =
    state.kind === 'success' ? state.ownerSlackId : undefined

  const toggleChannel = (id: string) => {
    // #501: the FIRST channel selected on a fresh picker defaults to the
    // owner-gated home channel — role=primary with the owner prefilled
    // into assignedUsers. This flips new agents off the legacy
    // workspace-open mention-gated shape (the #494 bug). The latch
    // (Greptile PR #87) ensures this fires once per context: after the
    // operator clears the selection mid-edit, a re-add stays legacy so
    // they opt into a role explicitly rather than silently re-priming.
    const applyPrimaryDefault =
      selected.size === 0 &&
      !selected.has(id) &&
      !firstDefaultAppliedRef.current
    if (applyPrimaryDefault) firstDefaultAppliedRef.current = true
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(id)) {
        next.delete(id)
        return next
      }
      if (applyPrimaryDefault) {
        next.set(id, {
          requireMention: true,
          role: 'primary',
          assignedUsers: ownerSlackId ? [ownerSlackId] : [],
        })
      } else {
        next.set(id, { requireMention: true })
      }
      return next
    })
  }

  /**
   * Per-channel toggle (#291). Flip whether the agent waits for a
   * mention before replying in this channel. Only meaningful for a
   * role-less (legacy) selected channel — call site hides it once a
   * role is set, since init-config derives requireMention from role.
   */
  const toggleRequireMention = (id: string) => {
    setSelected((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(id, { ...cur, requireMention: !cur.requireMention })
      return next
    })
  }

  /**
   * #501: set (or clear) a channel's role. assignedUsers + accessMode are
   * PRESERVED across every transition (Greptile PR #87 + Claude audit), so
   * toggling roles never silently discards the operator's work — e.g.
   * active(preferred) → monitor → active restores `preferred` instead of
   * resetting to `exclusive`. The PUT body builder omits the fields that
   * don't apply to the chosen role (assignedUsers for monitor; accessMode
   * for everything but active; both for legacy), so carrying them in state
   * is wire-safe.
   *   - undefined → legacy mention-gated (role cleared; fields kept in state).
   *   - primary → prefill the owner into assignedUsers (dedup).
   *   - active  → default accessMode to 'exclusive' only if none was set.
   */
  const setChannelRole = (id: string, role: ChannelRole | undefined) => {
    setSelected((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      const updated: SelectedChannelState = {
        requireMention: cur.requireMention,
        role,
        assignedUsers: cur.assignedUsers ?? [],
        accessMode: cur.accessMode,
      }
      if (role === 'primary') {
        const users = updated.assignedUsers ?? []
        if (ownerSlackId && !users.includes(ownerSlackId)) {
          updated.assignedUsers = [...users, ownerSlackId]
        }
      } else if (role === 'active') {
        updated.accessMode = cur.accessMode ?? 'exclusive'
      }
      next.set(id, updated)
      return next
    })
  }

  /** #501: append a (caller-validated) Slack user ID to a channel's allowlist. */
  const addAssignedUser = (id: string, userId: string) => {
    setSelected((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const users = cur.assignedUsers ?? []
      if (users.includes(userId)) return prev
      const next = new Map(prev)
      next.set(id, { ...cur, assignedUsers: [...users, userId] })
      return next
    })
  }

  /** #501: remove a Slack user ID from a channel's allowlist. */
  const removeAssignedUser = (id: string, userId: string) => {
    setSelected((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(id, {
        ...cur,
        assignedUsers: (cur.assignedUsers ?? []).filter((u) => u !== userId),
      })
      return next
    })
  }

  /** #501: set accessMode — only meaningful (and call-site-gated) for role=active. */
  const setAccessMode = (id: string, mode: ChannelAccessMode) => {
    setSelected((prev) => {
      const cur = prev.get(id)
      if (!cur || cur.role !== 'active') return prev
      const next = new Map(prev)
      next.set(id, { ...cur, accessMode: mode })
      return next
    })
  }

  // Save → PUT /api/fleet/agents/{name}/slack/channels (the real
  // channels-only update handler, ender-stack#283). It reads the live
  // task-def, re-injects OPENCLAW_SLACK_CONFIG_JSON onto the init
  // container, registers a new revision + UpdateService — tokens stay
  // untouched. Server is the source of truth for validation
  // (validateChannelInputs + validatePrimaryAssignment); the picker
  // pre-validates only for UX and surfaces a 400 InvalidChannelList
  // inline.
  const handleSave = async () => {
    if (state.kind !== 'success') return
    if (selected.size === 0) return

    setSaveState({ kind: 'submitting' })
    saveAbortRef.current?.abort()
    const controller = new AbortController()
    saveAbortRef.current = controller
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)

    try {
      const resp = await fetch(
        `/api/fleet/agents/${encodeURIComponent(agentName)}/slack/channels`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            // Per-channel ChannelInput entries. Legacy (no role) →
            // {id, requireMention} (#291). Role form (#494) → {id, role,
            // assignedUsers?, accessMode?}; requireMention is OMITTED
            // (init-config derives it), assignedUsers is dropped for
            // monitor, accessMode only rides on active.
            channels: Array.from(selected.entries()).map(
              ([id, s]): ChannelInput => {
                if (!s.role) {
                  return { id, requireMention: s.requireMention }
                }
                const entry: ChannelConfig = { id, role: s.role }
                if (s.role !== 'monitor') {
                  const users = (s.assignedUsers ?? []).filter((u) =>
                    SLACK_USER_ID_RE.test(u),
                  )
                  if (users.length > 0) entry.assignedUsers = users
                }
                if (s.role === 'active' && s.accessMode) {
                  entry.accessMode = s.accessMode
                }
                return entry
              },
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

  // #501: client-side mirror of the server's validatePrimaryAssignment.
  // A primary channel with no (valid) assignedUsers AND no agent owner
  // would degrade to mention-gated downstream — block Save with the
  // same message the server returns, so the operator fixes it before
  // the round-trip. A valid owner satisfies the requirement (init-config
  // auto-injects it), so the block only fires when ownerSlackId is unset.
  const primaryError = useMemo(() => {
    const hasOwner = !!ownerSlackId && SLACK_USER_ID_RE.test(ownerSlackId)
    if (hasOwner) return null
    for (const [id, s] of selected) {
      if (s.role !== 'primary') continue
      const valid = (s.assignedUsers ?? []).filter((u) =>
        SLACK_USER_ID_RE.test(u),
      )
      if (valid.length === 0) {
        return `Channel "${id}" has role "primary" but no assignedUsers, and the agent has no usable owner Slack ID. Add at least one assigned user, or set the agent owner.`
      }
    }
    return null
  }, [selected, ownerSlackId])

  const overCap = selected.size > MAX_CHANNELS_PER_AGENT
  const saveDisabled =
    state.kind !== 'success' ||
    selected.size === 0 ||
    overCap ||
    primaryError !== null ||
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Selected: {selected.size}
            {overCap ? (
              <span className="text-destructive ml-1">
                · over {MAX_CHANNELS_PER_AGENT}-channel cap
              </span>
            ) : null}
          </span>
          <Button
            variant="outline"
            size="sm"
            // Bump retryKey, NOT reloadKey, so the operator's
            // current selection survives the refetch (matches the
            // transient-error retry behavior). This pulls a fresh
            // channel list from Slack — useful when new channels
            // were created in the workspace after the picker
            // first opened.
            onClick={() => setRetryKey((k) => k + 1)}
            data-testid="slack-channel-picker-refresh"
            title="Refresh channel list from Slack"
          >
            ↻ Refresh
          </Button>
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
          ownerSlackId={ownerSlackId}
          onToggle={toggleChannel}
          onToggleRequireMention={toggleRequireMention}
          onSetRole={setChannelRole}
          onAddAssignedUser={addAssignedUser}
          onRemoveAssignedUser={removeAssignedUser}
          onSetAccessMode={setAccessMode}
        />
      )}

      {primaryError ? (
        <div
          className="p-2 rounded-md bg-destructive/10 text-destructive text-xs"
          data-testid="slack-channel-picker-primary-error"
        >
          {primaryError}
        </div>
      ) : null}

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
 * Search + multi-select control (ender-stack#290, role config #501).
 * Replaces the flat checkbox grid that didn't scale past ~20 channels.
 *
 * UX shape:
 *   - Selected channels render as per-channel config rows above the
 *     input — each with a role picker (primary/active/monitor), an
 *     assignedUsers entry (role-gated), an accessMode picker (active
 *     only), and the legacy @-only/always toggle (role-less only).
 *   - Typeahead input filters by case-insensitive substring on
 *     `name`. Empty query shows the full list.
 *   - Filtered list is virtualization-light (capped height +
 *     overflow-y) — workspaces this large should hit cursor
 *     pagination first (separate gap).
 *   - Clicking a list row toggles selection (add or remove);
 *     clicking a row's × removes that selection.
 */
function SlackChannelMultiSelect({
  channels,
  selected,
  ownerSlackId,
  onToggle,
  onToggleRequireMention,
  onSetRole,
  onAddAssignedUser,
  onRemoveAssignedUser,
  onSetAccessMode,
}: {
  channels: SlackChannel[]
  selected: Map<string, SelectedChannelState>
  ownerSlackId?: string
  onToggle: (id: string) => void
  onToggleRequireMention: (id: string) => void
  onSetRole: (id: string, role: ChannelRole | undefined) => void
  onAddAssignedUser: (id: string, userId: string) => void
  onRemoveAssignedUser: (id: string, userId: string) => void
  onSetAccessMode: (id: string, mode: ChannelAccessMode) => void
}) {
  const [query, setQuery] = useState('')

  const channelsById = useMemo(() => {
    const m = new Map<string, SlackChannel>()
    for (const c of channels) m.set(c.id, c)
    return m
  }, [channels])

  const selectedChannels = useMemo(() => {
    const arr: Array<{ channel: SlackChannel; st: SelectedChannelState }> = []
    for (const [id, st] of selected) {
      const c = channelsById.get(id)
      if (c) arr.push({ channel: c, st })
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
          className="space-y-2"
          data-testid="slack-channel-picker-selected"
        >
          {selectedChannels.map(({ channel, st }) => (
            <ChannelConfigRow
              key={channel.id}
              channel={channel}
              st={st}
              ownerSlackId={ownerSlackId}
              onRemove={() => onToggle(channel.id)}
              onToggleRequireMention={() => onToggleRequireMention(channel.id)}
              onSetRole={(role) => onSetRole(channel.id, role)}
              onAddAssignedUser={(u) => onAddAssignedUser(channel.id, u)}
              onRemoveAssignedUser={(u) => onRemoveAssignedUser(channel.id, u)}
              onSetAccessMode={(m) => onSetAccessMode(channel.id, m)}
            />
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

const ROLE_OPTIONS: Array<{ value: ChannelRole; label: string }> = [
  { value: 'primary', label: 'primary — home channel (owner auto-injected)' },
  { value: 'active', label: 'active — shared team (mention-gated unless preferred)' },
  { value: 'monitor', label: 'monitor — mention-only (assignedUsers ignored)' },
]

const SELECT_CLASS =
  'h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground'

/**
 * Per-channel config row (#501). Hosts the role picker + the
 * role-dependent controls for one selected channel:
 *   - role select (primary/active/monitor + a legacy "mention-gated" option)
 *   - assignedUsers free-text entry (shown for primary/active; the owner
 *     chip is marked; entries are validated against SLACK_USER_ID_RE on
 *     add so invalid IDs never enter state — #501 MVP, not a users.list picker)
 *   - accessMode select (active only)
 *   - legacy @-only/always toggle (role-less only; requireMention is
 *     derived downstream once a role is set)
 */
function ChannelConfigRow({
  channel,
  st,
  ownerSlackId,
  onRemove,
  onToggleRequireMention,
  onSetRole,
  onAddAssignedUser,
  onRemoveAssignedUser,
  onSetAccessMode,
}: {
  channel: SlackChannel
  st: SelectedChannelState
  ownerSlackId?: string
  onRemove: () => void
  onToggleRequireMention: () => void
  onSetRole: (role: ChannelRole | undefined) => void
  onAddAssignedUser: (userId: string) => void
  onRemoveAssignedUser: (userId: string) => void
  onSetAccessMode: (mode: ChannelAccessMode) => void
}) {
  const [userInput, setUserInput] = useState('')
  const [userError, setUserError] = useState<string | null>(null)

  const role = st.role
  const showAssignedUsers = role === 'primary' || role === 'active'
  const assignedUsers = st.assignedUsers ?? []

  const handleAddUser = () => {
    const v = userInput.trim()
    if (!v) return
    if (!SLACK_USER_ID_RE.test(v)) {
      setUserError(
        `"${v.slice(0, 30)}" isn't a valid Slack user ID (U + 8–12 alphanumerics)`,
      )
      return
    }
    if (assignedUsers.includes(v)) {
      setUserError(`${v} is already assigned`)
      return
    }
    onAddAssignedUser(v)
    setUserInput('')
    setUserError(null)
  }

  return (
    <div
      className="rounded-md border border-border bg-secondary/50 p-2 space-y-2"
      data-testid={`slack-channel-config-row-${channel.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">
          {channel.isPrivate ? '🔒 ' : '# '}
          {channel.name}
        </span>
        <button
          type="button"
          aria-label={`Remove ${channel.name}`}
          onClick={onRemove}
          data-testid={`slack-channel-pill-remove-${channel.id}`}
          className="text-primary/70 hover:text-primary text-sm leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">
          Role
          <select
            value={role ?? ''}
            onChange={(e) =>
              onSetRole(
                e.target.value === ''
                  ? undefined
                  : (e.target.value as ChannelRole),
              )
            }
            data-testid={`slack-channel-role-${channel.id}`}
            aria-label={`Role for ${channel.name}`}
            className={`${SELECT_CLASS} ml-1`}
          >
            <option value="">(mention-gated — legacy)</option>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {role === 'active' ? (
          <label className="text-xs text-muted-foreground">
            Access
            <select
              value={st.accessMode ?? 'exclusive'}
              onChange={(e) =>
                onSetAccessMode(e.target.value as ChannelAccessMode)
              }
              data-testid={`slack-channel-access-mode-${channel.id}`}
              aria-label={`Access mode for ${channel.name}`}
              className={`${SELECT_CLASS} ml-1`}
            >
              <option value="exclusive">exclusive — mention-gated</option>
              <option value="preferred">preferred — ambient</option>
            </select>
          </label>
        ) : null}

        {role === undefined ? (
          <button
            type="button"
            onClick={onToggleRequireMention}
            data-testid={`slack-channel-pill-mode-${channel.id}`}
            aria-label={`Reply mode for ${channel.name}: ${st.requireMention ? 'mention only' : 'always reply'}. Click to toggle.`}
            title={
              st.requireMention
                ? 'Reply only when @mentioned. Click to switch to always-reply.'
                : 'Always reply in this channel. Click to switch to mention-only.'
            }
            className={`rounded-sm px-1 text-xs ${
              st.requireMention
                ? 'bg-primary/20 text-primary'
                : 'bg-amber-500/20 text-amber-700'
            }`}
          >
            {st.requireMention ? '@-only' : 'always'}
          </button>
        ) : null}
      </div>

      {showAssignedUsers ? (
        <div
          className="space-y-1"
          data-testid={`slack-channel-assigned-users-${channel.id}`}
        >
          {assignedUsers.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {assignedUsers.map((u) => (
                <span
                  key={u}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5 font-mono"
                  data-testid={`slack-channel-assigned-user-${channel.id}-${u}`}
                >
                  {u}
                  {u === ownerSlackId ? (
                    <span className="text-muted-foreground">(owner)</span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Remove ${u}`}
                    onClick={() => onRemoveAssignedUser(u)}
                    className="text-primary/70 hover:text-primary"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={userInput}
              onChange={(e) => {
                setUserInput(e.target.value)
                setUserError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddUser()
                }
              }}
              placeholder="U0123456789"
              aria-label={`Add assigned user for ${channel.name}`}
              data-testid={`slack-channel-assigned-users-input-${channel.id}`}
              className="flex-1 text-xs rounded-md border border-border bg-background px-2 py-1 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddUser}
              data-testid={`slack-channel-assigned-users-add-${channel.id}`}
            >
              Add
            </Button>
          </div>
          {userError ? (
            <div
              className="text-xs text-destructive"
              data-testid={`slack-channel-assigned-users-error-${channel.id}`}
            >
              {userError}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
