'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
// `import type` elides at compile time — no runtime import of the
// AWS SDK / NextRequest from the server module reaches the client bundle.
import type {
  FleetServicesResponse as ServicesResponse,
  FleetServicesErrorResponse as ErrorResponse,
  FleetServiceSummary,
} from '../api/services'
import { CreateAgentForm } from './create-agent-form'
import { DeleteAgentForm } from './delete-agent-form'
import { AgentDetailPanel } from './agent-detail-panel'

// ---------- Component ----------

// Polling cadence while any row is mid-rollout. ECS rolls finish in 2–4
// min; 5s gives operators responsive feedback after a Redeploy click
// without spamming DescribeServices on healthy fleets (the polling stops
// the moment all rows hit activeDeployments=0).
const POLL_INTERVAL_MS = 5000

// Per-row redeploy state. Keyed by service name. 'pending' = awaiting
// the POST /redeploy response; 'error' + message = SDK or network error.
// After a 202 we hand control back to ECS's `activeDeployments` counter
// — the table refresh re-reads it and the disable predicate uses
// `svc.activeDeployments > 0` to keep the button disabled while the
// rollout finishes. So there's no per-row 'rolling' / 'ok' state to
// track in MC; ECS is the source of truth for "is this rolling?"
type RedeployState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'error'; error: string }

export function FleetPanel() {
  const [data, setData] = useState<ServicesResponse | null>(null)
  const [error, setError] = useState<ErrorResponse | null>(null)
  // Initial render is mid-fetch (load() fires from useEffect); keep the
  // Refresh button in its loading state from t=0 to avoid an empty body.
  const [loading, setLoading] = useState(true)
  const [redeployStates, setRedeployStates] = useState<
    Record<string, RedeployState>
  >({})
  // Create-agent form (Phase 2.2 Beat 3b) is a collapsible section under
  // the panel header. Closed by default — opens only when the operator
  // clicks "Create agent". On submit-success the form refreshes the
  // table via load() and stays open showing the success summary; the
  // operator dismisses with "Done" or "Create another."
  const [createOpen, setCreateOpen] = useState(false)
  // Beat 4c — agent currently selected for deletion. `null` = modal
  // closed. The modal is single-instance (one delete at a time);
  // selecting "Delete" on a second row while a first delete is open
  // would replace the selection. In practice operators don't multi-
  // select; UI affordance simple.
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // Beat 5c.1 — agent currently selected for the detail panel.
  // Stores the full FleetServiceSummary (so the panel can render
  // identity fields without re-fetching) plus the parsed agent
  // name (for the Slack manifest endpoint). `null` = panel closed.
  //
  // Staleness contract: this is a SNAPSHOT taken at click-time.
  // The fleet table polls every 5s during active rollouts; if an
  // agent transitions ACTIVE → DRAINING → INACTIVE while the
  // panel is open, the Identity section will keep showing the
  // click-time snapshot. Acceptable for Beat 5c.1's read-only
  // scope; the manifest is the actionable content and it's
  // independently fetched. Round-6 audit (Greptile P1) flagged
  // adding a staleness indicator — tracked as ender-stack#282
  // for Beat 5c.2 / 5c.3.
  const [detailTarget, setDetailTarget] = useState<{
    agent: FleetServiceSummary
    agentName: string
  } | null>(null)

  // Stable onClose handlers for child modals/panels. Inline arrows
  // would create a new function reference on every parent render,
  // which (combined with the children's `onClose`-in-deps useEffects)
  // re-attaches keydown listeners on every fleet-table refresh tick.
  // Round-6 audit on PR #50 (Greptile P2 + Claude's pre-existing-
  // pattern note) called this out for AgentDetailPanel; same fix
  // applied to DeleteAgentForm + CreateAgentForm for consistency.
  const closeCreateForm = useCallback(() => setCreateOpen(false), [])
  const closeDeleteTarget = useCallback(() => setDeleteTarget(null), [])
  const closeDetailTarget = useCallback(() => setDetailTarget(null), [])
  // Tracks when `data` was last successfully fetched (Date.now()).
  // Drives the staleness indicator that appears when error+data are
  // both present — operators need to know the table is from before
  // the error, not from after it.
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  // AbortController for the in-flight load() fetch. Used to:
  //   1. Cancel a superseded poll so out-of-order resolution can't
  //      stomp newer data with older (closes the concurrent-fetch
  //      race ender-stack#182 flagged).
  //   2. Cancel on unmount so a dangling fetch doesn't try to
  //      setData on an unmounted component (React 18 silently
  //      no-ops it but it's still a wasted RTT and a leaked
  //      promise).
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    // `silent` skips the visible "Loading…" state on the Refresh button.
    // Background polls pass silent=true so a 5s rollout-watch interval
    // doesn't make the button flicker every tick. Initial mount + manual
    // clicks pass silent=false (default) so operators see the spinner.

    // Cancel any in-flight fetch from a prior call. Prevents two polls
    // racing to setData with stale order.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (!silent) setLoading(true)
    try {
      const resp = await fetch('/api/fleet/services', {
        cache: 'no-store',
        signal: controller.signal,
      })
      const body = (await resp.json()) as ServicesResponse | ErrorResponse
      if (!resp.ok) {
        // Don't clear `data` on transient errors. The auto-poll loop's
        // `hasRolling` predicate evaluates `data?.services.some(...) ??
        // false` — clearing data flips it to false, which kills the
        // poll interval, which strands the operator on "Rolling…"
        // exactly when a transient AWS hiccup happens mid-rollout
        // (the original bug PR #34 set out to fix).
        setError(body as ErrorResponse)
      } else {
        setError(null)
        setData(body as ServicesResponse)
        setFetchedAt(Date.now())
      }
    } catch (err) {
      // AbortError is expected when a newer call supersedes this one —
      // the newer call's fetch is already in flight and will (or did)
      // update state. Don't overwrite with a NetworkError.
      if ((err as Error).name === 'AbortError') return
      // Bare network failure (DNS, offline, etc.) — surface a stable
      // generic. Browser dev-tools still show the underlying error;
      // we don't echo it into the UI to keep this consistent with the
      // server-side policy of not leaking error detail.
      // Same data-preservation rationale as above.
      setError({ error: 'NetworkError' })
    } finally {
      // Only the CANONICAL call (still tracked in abortRef) manages the
      // loading flag. If this call was superseded, abortRef.current
      // points to the newer controller — leave the flag alone. The
      // newer canonical call will reset it via its own finally.
      //
      // Critical: we DON'T gate on `silent` here. Even a silent poll,
      // if it's the canonical call, must clear loading=true that an
      // earlier (now-aborted) non-silent Refresh set. Otherwise the
      // spinner stays stuck forever when a silent poll happens to
      // abort an in-flight Refresh (Auditor PR #35 stuck-state bug).
      // setLoading(false) is idempotent when loading was already false,
      // so it's safe to call from a silent path too.
      if (abortRef.current === controller) {
        setLoading(false)
      }
    }
  }, [])

  const redeploy = useCallback(
    async (svcName: string) => {
      setRedeployStates((s) => ({ ...s, [svcName]: { kind: 'pending' } }))
      try {
        const resp = await fetch(
          `/api/fleet/services/${encodeURIComponent(svcName)}/redeploy`,
          { method: 'POST', cache: 'no-store' },
        )
        if (!resp.ok) {
          const body = (await resp.json()) as { error?: string }
          setRedeployStates((s) => ({
            ...s,
            [svcName]: { kind: 'error', error: body.error ?? 'AWSError' },
          }))
          return
        }
        // 202 — ECS accepted the UpdateService call. Re-fetch the table
        // so DescribeServices reports the new IN_PROGRESS deployment;
        // from that point on the table's `activeDeployments` column is
        // the source of truth for "rollout in flight" (the button's
        // disable predicate keys on it). Reset the per-row state
        // unconditionally — the row state machine is "pending (POST in
        // flight) → idle (POST returned 202)". The follow-up load() is
        // best-effort table refresh; if a background poll supersedes
        // it, the next poll picks up canonical ECS state. The button
        // stays correctly disabled during rollout via
        // `svc.activeDeployments > 0` (line below), not via the row's
        // `pending` flag. Earlier code gated `idle` on load completion
        // — that left rows stuck on `pending` forever when the silent
        // poll aborted load() (Auditor PR #35 finding).
        await load()
        setRedeployStates((s) => ({ ...s, [svcName]: { kind: 'idle' } }))
      } catch {
        setRedeployStates((s) => ({
          ...s,
          [svcName]: { kind: 'error', error: 'NetworkError' },
        }))
      }
    },
    [load],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Auto-poll while ANY row is mid-rollout. ECS rolls take 2–4 min; without
  // this, the table snapshots the post-Redeploy IN_PROGRESS state and never
  // refreshes — operator sees "Rolling…" indefinitely until they click
  // Refresh manually. Same `activeDeployments > 0` predicate the per-row
  // disabled state uses, so the loops naturally pair: polling stops the
  // moment ECS reports COMPLETED on every row.
  const hasRolling =
    data?.services.some((s) => s.activeDeployments > 0) ?? false

  useEffect(() => {
    if (!hasRolling) return
    const id = setInterval(() => {
      // silent=true: don't toggle the Refresh button's disabled state
      // every 5s for a rollout the operator didn't initiate.
      void load({ silent: true })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [hasRolling, load])

  // Cancel any in-flight fetch on unmount. Without this, a panel that's
  // mid-fetch when the operator navigates away would still resolve the
  // promise and call setData on an unmounted component (React 18 silently
  // no-ops, but it's a wasted RTT + leaked promise).
  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Fleet</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Production-deployed agents in this cluster — OpenClaw companions,
            Hermes workers, and other agent harnesses. Read-only today;
            deploy + configure actions ship in subsequent phases.
          </p>
        </div>
        <div className="flex gap-2">
          {/* Toggle is intentionally NOT disabled by `loading`. The
              auto-poll loop + post-create refresh both flip `loading`
              to true; gating the toggle on it would lock the operator
              out of opening the modal whenever the table is fetching.
              The modal itself disables its inputs during in-flight
              POST and blocks dismiss while submitting (Esc + backdrop
              ignored mid-POST). Single-action button now that the
              form is a portaled modal — Esc / backdrop / Cancel all
              close it. */}
          <Button
            variant="outline"
            onClick={() => setCreateOpen(true)}
            data-testid="toggle-create-agent"
          >
            Create agent
          </Button>
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <CreateAgentForm
        open={createOpen}
        onCreated={() => {
          void load()
        }}
        onClose={closeCreateForm}
      />


      {error ? (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-4">
          <div className="font-medium">Failed to load fleet</div>
          <div className="text-sm mt-1">
            <code>{error.error}</code>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Common causes: MC task role missing <code>ecs:ListServices</code> /
            <code>ecs:DescribeServices</code> (provisioned by ender-stack PR
            #150); cluster name mismatch (set <code>MC_FLEET_CLUSTER_NAME</code>);
            AWS region misconfigured.
          </div>
        </div>
      ) : null}

      {data ? (
        <div>
          <div className="text-sm text-muted-foreground mb-2">
            Cluster: <code>{data.cluster}</code> · Region: <code>{data.region}</code>
            {' · '}
            {data.services.length} agent{data.services.length === 1 ? '' : 's'}
            {/* Staleness indicator when both error AND data are present —
                operator needs to know the table is from BEFORE the error,
                not after. Otherwise they could read the error banner as
                being about the rendered fleet state. */}
            {error && fetchedAt !== null ? (
              <StalenessTimer fetchedAt={fetchedAt} />
            ) : null}
          </div>

          {/* Banner only when there ARE agents to show + truncation is real
              risk. When there are zero agents AND truncated, the empty-state
              copy below carries the same warning — duplicating both was
              inherited noise. Auditor flagged the dual display as confusing. */}
          {data.truncated && data.services.length > 0 ? (
            <div
              className="mb-2 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
              data-testid="truncation-banner"
            >
              Cluster has more than 100 services; Fleet scans only the first
              100 for agent harnesses, so some agents may be missing from this
              view. Pagination support lands in a follow-up.
            </div>
          ) : null}

          {data.services.length === 0 ? (
            <div
              className="rounded border p-4 text-sm text-muted-foreground"
              data-testid="empty-state"
            >
              {data.truncated
                ? 'No agents found in the first 100 services. More services may exist beyond the page cap.'
                : 'No agents currently deployed.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-right p-2">Desired</th>
                    <th className="text-right p-2">Running</th>
                    <th className="text-right p-2">Pending</th>
                    <th className="text-left p-2">Launch type</th>
                    <th className="text-right p-2">Deployments</th>
                    <th className="text-right p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.services.map((svc) => {
                    const rs = redeployStates[svc.name] ?? { kind: 'idle' }
                    // Extract the agent-name suffix once per row.
                    // Null = service isn't an MC-managed agent
                    // shape (e.g. mission-control itself, litellm,
                    // the smoke-test on the legacy ALB), so the
                    // Delete affordance is hidden.
                    const parsedAgentName = agentNameFromService(svc.name)
                    // Disable Redeploy if (a) the POST is in flight,
                    // OR (b) ECS already shows an active rollout in
                    // progress (activeDeployments > 0). Avoids double-
                    // rolling and re-enables automatically when ECS
                    // reports COMPLETED — no per-row "rolling" state in
                    // MC.
                    const redeployDisabled =
                      rs.kind === 'pending' || svc.activeDeployments > 0
                    return (
                      <tr key={svc.name} className="border-t">
                        <td className="p-2 font-mono">
                          {/*
                            Beat 5c.1: the agent-name cell is a
                            clickable button when the row is an
                            MC-managed agent (parsedAgentName
                            non-null). Opens the detail panel
                            with identity fields + Slack manifest.
                            Non-agent rows (litellm, mission-
                            control itself, smoke-test) render
                            plain text — clicking does nothing
                            since the manifest endpoint would
                            404 for them anyway. Match the row
                            convention in delete-agent-form: act
                            on parsed agent name, not the raw
                            service name.
                          */}
                          {parsedAgentName !== null ? (
                            <button
                              type="button"
                              onClick={() =>
                                setDetailTarget({
                                  agent: svc,
                                  agentName: parsedAgentName,
                                })
                              }
                              className="text-left hover:underline focus:outline-none focus:ring-2 focus:ring-primary/50 rounded"
                              data-testid={`detail-${svc.name}`}
                            >
                              {svc.name}
                            </button>
                          ) : (
                            svc.name
                          )}
                        </td>
                        <td className="p-2">
                          <span
                            className={
                              svc.status === 'ACTIVE'
                                ? 'text-green-700'
                                : 'text-amber-700'
                            }
                          >
                            {svc.status ?? '—'}
                          </span>
                        </td>
                        <td className="p-2 text-right">{svc.desiredCount ?? '—'}</td>
                        <td className="p-2 text-right">{svc.runningCount ?? '—'}</td>
                        <td className="p-2 text-right">{svc.pendingCount ?? '—'}</td>
                        <td className="p-2">{svc.launchType ?? '—'}</td>
                        <td className="p-2 text-right">{svc.activeDeployments}</td>
                        <td className="p-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void redeploy(svc.name)}
                              disabled={redeployDisabled}
                              data-testid={`redeploy-${svc.name}`}
                            >
                              {rs.kind === 'pending'
                                ? 'Triggering…'
                                : svc.activeDeployments > 0
                                  ? 'Rolling…'
                                  : 'Redeploy'}
                            </Button>
                            {/*
                              Delete button — Beat 4c. The agent
                              name is extracted from the service
                              name once above (parsedAgentName);
                              the modal receives the parsed name
                              directly and routes to
                              /api/fleet/agents/{name}. Disabled
                              while redeploy is in-flight or rolling
                              on the same row — the backend doesn't
                              enforce mutex, so this is the UX-level
                              guard against compounding state
                              changes. Hidden entirely for non-agent
                              rows.
                            */}
                            {parsedAgentName !== null ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setDeleteTarget(parsedAgentName)
                                }
                                disabled={redeployDisabled}
                                data-testid={`delete-${svc.name}`}
                                className="text-destructive hover:bg-destructive/10"
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                          {rs.kind === 'error' ? (
                            <div
                              className="text-xs text-destructive mt-1"
                              data-testid={`redeploy-error-${svc.name}`}
                            >
                              <code>{rs.error}</code>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      <DeleteAgentForm
        agentName={deleteTarget}
        // onDeleted fires AFTER a successful 200 — refresh the
        // fleet table so the deleted row drops out, but DO NOT
        // close the modal here. The modal renders its own
        // success summary (resource ARNs + idempotency notes)
        // and the operator dismisses via "Done" (which calls
        // onClose). Closing here would race the success summary
        // off-screen before the operator could read it.
        onDeleted={() => {
          void load({ silent: false })
        }}
        onClose={closeDeleteTarget}
      />
      <AgentDetailPanel
        agent={detailTarget?.agent ?? null}
        agentName={detailTarget?.agentName ?? null}
        onClose={closeDetailTarget}
      />
    </div>
  )
}

/**
 * Extract the agent-name suffix from a service name shaped like
 * `{prefix}-companion-openclaw-{agentName}`. Returns null when the
 * service isn't an MC-managed agent (the Delete button stays hidden
 * for those rows — defense in depth on the server-side
 * Component=agent-harness + ManagedBy=mission-control tag check).
 *
 * The fleet-services API returns ALL services in the cluster
 * (including the smoke-test, MC itself, LiteLLM, etc.); we only want
 * the Delete button next to MC-created agents. Tag-based filtering
 * isn't exposed on the services-list response today, so we fall back
 * to the naming convention. The smoke-test (`*-companion-openclaw-
 * smoke-test`) WOULD pass this regex too, but the server's two-tag
 * check (Component=agent-harness AND ManagedBy=mission-control)
 * refuses the delete with a 404. Belt-and-suspenders: the button is
 * harmless even if shown for the smoke-test.
 */
function agentNameFromService(serviceName: string): string | null {
  const m = serviceName.match(/-companion-openclaw-([a-z0-9][a-z0-9-]*[a-z0-9])$/)
  return m ? m[1] : null
}

// Self-ticking timer rendered next to the cluster summary when both error
// and stale data are present. Re-renders once per second so the operator
// sees the count climb in real time — makes the "this is stale" signal
// unambiguous without needing to refresh the whole table.
function StalenessTimer({ fetchedAt }: { fetchedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000))
  return (
    <span
      className="ml-2 text-amber-700"
      data-testid="staleness-indicator"
    >
      · Last refreshed: {seconds}s ago
    </span>
  )
}
