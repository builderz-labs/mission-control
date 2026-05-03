'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import type { FleetServiceSummary } from '../api/services'
import { SlackManifestDisplay } from './slack-manifest-display'
import { SlackCredentialsForm } from './slack-credentials-form'
import { SlackChannelPicker } from './slack-channel-picker'

// Phase 2.4 Beat 5c.1 — Agent detail side-panel.
//
// Opens when the operator clicks the agent's name in the fleet table.
// Slides in from the right via createPortal (same z-index strategy as
// create-agent-form / delete-agent-form modals — keeps the panel
// stacking-context-independent of the table's parent panel chain).
//
// Sections:
//   1. Agent identity — name, ARN, status, counts, launch type
//   2. Connect to Slack — manifest display (Beat 5c.1)
//
// Beat 5c.2 will extend with:
//   3. Slack credentials form (POST /slack/credentials)
//   4. Slack channel picker (GET /slack/channels)
//
// Why a side-panel instead of a modal: detail content is read-mostly +
// reference-style (operator pastes manifest into Slack, switches back
// to MC). A side-panel is non-blocking — the fleet table stays visible
// and operators can click another row without dismissing first.
//
// Width: max-w-2xl (~672px). Wider than the credential modal because
// the manifest JSON is wide; not full-width because we want the table
// still partially visible for cross-row navigation.

interface Props {
  /** The agent currently selected. `null` = panel closed. */
  agent: FleetServiceSummary | null
  /** Agent name parsed from service name (operator-friendly identifier). Null when no agent selected. */
  agentName: string | null
  onClose: () => void
}

export function AgentDetailPanel({ agent, agentName, onClose }: Props) {
  const open = agent !== null && agentName !== null
  // Refs for focus management — round-1 audit on PR #50 carried
  // this pattern over from create-agent-form.tsx + delete-agent-
  // form.tsx. With aria-modal="true" set, screen readers treat
  // background as inert; the focus trap below ensures keyboard-
  // only / AT users can't actually Tab out.
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<Element | null>(null)
  // Bumping `picksReloadKey` after a successful credential save
  // re-fetches the channel list (the bot token now exists in
  // SM, so the picker's prior 404 SlackBotTokenNotFound state
  // becomes stale).
  const [picksReloadKey, setPicksReloadKey] = useState(0)

  // Esc closes (matches modal-form behavior).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // On open: capture the trigger element so we can return focus on
  // close, then move focus to the Close button (the most predictable
  // landing for a read-mostly side-panel — operator's natural Tab
  // sequence flows from there into the body).
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement
    const t = setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => {
      clearTimeout(t)
      const target = previousFocusRef.current as HTMLElement | null
      target?.focus?.()
    }
  }, [open])

  // Focus trap (WAI-ARIA 1.2 Dialog Pattern §2.25). Same shape as
  // create-agent-form.tsx:171-194. Tab/Shift-Tab cycles within the
  // panel; without this, focus would escape into the background
  // even though aria-modal="true" tells screen readers it's inert.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open || agent === null || agentName === null) return null

  const panel = (
    // Outer div is the backdrop only — handles dismiss-on-click.
    // Round-2 audit on PR #50: ARIA dialog attributes
    // (role="dialog", aria-modal, aria-labelledby) MUST coincide
    // with the focus-trap root so screen readers announce the
    // same element the focus trap operates on. Moved to the
    // inner content div below.
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="agent-detail-panel"
    >
      <div
        ref={dialogRef}
        className="bg-background h-full w-full max-w-2xl shadow-xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-detail-title"
        data-testid="agent-detail-dialog"
        // Stop click propagation so clicks INSIDE the panel don't
        // hit the backdrop dismiss handler above.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h2
                id="agent-detail-title"
                className="text-lg font-semibold"
              >
                Agent <code className="font-mono">{agentName}</code>
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {agent.name}
              </p>
            </div>
            <Button
              ref={closeButtonRef}
              variant="outline"
              size="sm"
              onClick={onClose}
              data-testid="agent-detail-close"
              aria-label="Close panel"
            >
              Close
            </Button>
          </div>

          {/* ── Identity section ─────────────────────────────── */}
          <section
            className="space-y-2"
            data-testid="agent-detail-identity"
          >
            <h3 className="text-sm font-semibold border-b border-border pb-1">
              Identity
            </h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              {/*
                Service ARN is intentionally not displayed here —
                FleetServiceSummary strips it at the response
                boundary to keep the AWS account ID out of the
                browser (see services.ts:60-63 comment). The
                service NAME is shown in the panel header.
              */}
              <dt className="text-muted-foreground">Task definition</dt>
              <dd className="font-mono text-xs break-all">
                {agent.taskDefinition ?? '—'}
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <span
                  className={
                    agent.status === 'ACTIVE'
                      ? 'text-green-700'
                      : 'text-amber-700'
                  }
                >
                  {agent.status ?? '—'}
                </span>
              </dd>
              <dt className="text-muted-foreground">Launch type</dt>
              <dd>{agent.launchType ?? '—'}</dd>
              <dt className="text-muted-foreground">Desired</dt>
              <dd>{agent.desiredCount ?? '—'}</dd>
              <dt className="text-muted-foreground">Running</dt>
              <dd>{agent.runningCount ?? '—'}</dd>
              <dt className="text-muted-foreground">Pending</dt>
              <dd>{agent.pendingCount ?? '—'}</dd>
              <dt className="text-muted-foreground">Active deployments</dt>
              <dd>{agent.activeDeployments}</dd>
            </dl>
          </section>

          {/* ── Connect to Slack section ─────────────────────── */}
          <section
            className="space-y-4"
            data-testid="agent-detail-slack"
          >
            <h3 className="text-sm font-semibold border-b border-border pb-1">
              Connect to Slack
            </h3>
            <p className="text-xs text-muted-foreground">
              Copy the manifest below and follow the steps to create a
              Slack app for this agent. After install, paste the three
              tokens into the credentials form, then pick the channels
              the agent should subscribe to.
            </p>
            <SlackManifestDisplay agentName={agentName} />

            <div
              className="border-t border-border pt-3"
              data-testid="agent-detail-credentials-section"
            >
              <h4 className="text-sm font-semibold mb-2">
                Step 2 — Paste credentials
              </h4>
              <SlackCredentialsForm
                agentName={agentName}
                onSaved={() => {
                  // Bump picksReloadKey so the channel picker
                  // re-fetches now that the bot token exists.
                  setPicksReloadKey((k) => k + 1)
                }}
              />
            </div>

            <div
              className="border-t border-border pt-3"
              data-testid="agent-detail-channels-section"
            >
              <h4 className="text-sm font-semibold mb-2">
                Step 3 — Pick channels
              </h4>
              <SlackChannelPicker
                agentName={agentName}
                reloadKey={picksReloadKey}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  )

  // 'use client' (top of file) is the correct SSR-protection
  // mechanism — Next.js never server-renders this component.
  // A `typeof document === 'undefined'` guard at this point
  // would be dead code: the useEffect hooks above already
  // reference `window.addEventListener`, so on a real server
  // those would throw before this line was ever reached. Round-8
  // audit on PR #50 caught the misleading guard; removed.
  return createPortal(panel, document.body)
}
