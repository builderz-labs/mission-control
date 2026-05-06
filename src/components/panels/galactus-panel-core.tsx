'use client'

import { useCallback, useMemo, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import {
  fetchGalactus,
  readGalactusClientConfig,
  saveGalactusToken,
  type ApprovalQueueItem,
  type AttentionResponse,
  type EvidenceReview,
  type FleetResponse,
  type MemoryResponse,
  type RunDetail,
  type RuntimeHealthResponse,
  type SignalsResponse,
} from '@/lib/galactus-api'

type PanelKind =
  | 'attention'
  | 'run'
  | 'verify'
  | 'fleet'
  | 'signals'
  | 'memory'
  | 'approvals'
  | 'evidence'
  | 'runtime-health'

interface PanelState {
  attention: AttentionResponse | null
  fleet: FleetResponse | null
  signals: SignalsResponse | null
  memory: MemoryResponse | null
  approvals: ApprovalQueueItem[] | null
  runtimeHealth: RuntimeHealthResponse | null
  runDetail: RunDetail | null
  evidence: EvidenceReview | null
}

const emptyState: PanelState = {
  attention: null,
  fleet: null,
  signals: null,
  memory: null,
  approvals: null,
  runtimeHealth: null,
  runDetail: null,
  evidence: null,
}

const toneClasses = {
  healthy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  critical: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
  muted: 'border-slate-700 bg-slate-900/70 text-slate-300',
}

const severityTone = {
  critical: toneClasses.critical,
  high: toneClasses.warning,
  medium: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
  low: toneClasses.healthy,
}

function formatAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return 'No event clock'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'Unavailable'
  return new Date(value).toLocaleString()
}

function selectedRunId(fleet: FleetResponse | null): string | null {
  return fleet?.runs[0]?.run.run_id ?? null
}

async function fetchPanelState(kind: PanelKind): Promise<PanelState> {
  const next: PanelState = { ...emptyState }
  if (kind === 'attention') {
    next.attention = await fetchGalactus<AttentionResponse>('/api/mission-control/attention')
    return next
  }
  if (kind === 'fleet' || kind === 'run' || kind === 'verify' || kind === 'evidence') {
    next.fleet = await fetchGalactus<FleetResponse>('/api/mission-control/fleet')
    const runId = selectedRunId(next.fleet)
    if (runId && (kind === 'run' || kind === 'verify')) {
      next.runDetail = await fetchGalactus<RunDetail>(`/api/runs/control-plane/${runId}`)
    }
    if (runId && (kind === 'verify' || kind === 'evidence')) {
      next.evidence = await fetchGalactus<EvidenceReview>(
        `/api/runs/control-plane/${runId}/evidence`
      )
    }
    return next
  }
  if (kind === 'signals') {
    next.signals = await fetchGalactus<SignalsResponse>('/api/mission-control/signals')
    return next
  }
  if (kind === 'memory') {
    next.memory = await fetchGalactus<MemoryResponse>('/api/mission-control/memory')
    return next
  }
  if (kind === 'approvals') {
    next.approvals = await fetchGalactus<ApprovalQueueItem[]>(
      '/api/runs/control-plane/approvals?stream_id=galactus'
    )
    return next
  }
  next.runtimeHealth = await fetchGalactus<RuntimeHealthResponse>(
    '/api/mission-control/runtime-health'
  )
  return next
}

function TokenSetup({ onSaved }: { onSaved: () => void }) {
  const config = readGalactusClientConfig()
  const [token, setToken] = useState(config.token)
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-100">
        TTM connection
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={token}
          onChange={event => setToken(event.target.value)}
          className="min-h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
          placeholder="Bearer token"
          type="password"
        />
        <button
          className="min-h-10 rounded-md border border-amber-300/30 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-400/10"
          type="button"
          onClick={() => {
            saveGalactusToken(token)
            onSaved()
          }}
        >
          Save
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-50/75">
        API base: {config.apiBase}
      </p>
    </div>
  )
}

function Shell({
  title,
  eyebrow,
  children,
  error,
  loading,
  onRetry,
}: {
  title: string
  eyebrow: string
  children: React.ReactNode
  error: string | null
  loading: boolean
  onRetry: () => void
}) {
  return (
    <div className="m-4 space-y-4">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
          </div>
          <button
            className="min-h-9 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground"
            type="button"
            onClick={onRetry}
          >
            Refresh
          </button>
        </div>
        {loading && <p className="mt-3 text-sm text-muted-foreground">Loading live TTM data...</p>}
        {error && <div className="mt-4"><TokenSetup onSaved={onRetry} /></div>}
      </section>
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      )}
      {children}
    </div>
  )
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
      No {label} data is available from TTM.
    </section>
  )
}

function AttentionPanel({ data }: { data: AttentionResponse | null }) {
  if (!data) return <EmptyPanel label="attention" />
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      {data.items.map(item => (
        <article key={item.id} className={`rounded-lg border p-4 ${severityTone[item.severity]}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-current/70">
                {item.kind.replace(/_/g, ' ')}
              </p>
              <h2 className="mt-1 text-base font-semibold text-current">{item.title}</h2>
            </div>
            <span className="rounded-full border border-current/25 px-2 py-1 text-xs uppercase">
              {item.severity}
            </span>
          </div>
          <p className="mt-3 text-sm text-current/80">{item.reason}</p>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-current/75">
            <div><dt>Run</dt><dd className="font-mono">{item.run_id.slice(0, 8)}</dd></div>
            <div><dt>Clock</dt><dd>{formatAge(item.time_since_last_event_minutes)}</dd></div>
          </dl>
        </article>
      ))}
      {data.items.length === 0 && <EmptyPanel label="attention" />}
    </section>
  )
}

function FleetPanel({ data }: { data: FleetResponse | null }) {
  if (!data) return <EmptyPanel label="fleet" />
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="grid gap-3">
        {data.runs.map(row => (
          <article key={row.run.run_id} className="rounded-lg border border-border bg-background/40 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">{row.run.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{row.run.objective}</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs uppercase text-muted-foreground">
                {row.run.status}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
              <Metric label="Burn rate" value={`$${(row.cost_burn_rate ?? 0).toFixed(4)}/min`} />
              <Metric label="Last event" value={formatAge(row.time_since_last_event_minutes)} />
              <Metric label="Runtime" value={`${row.run.runtime_id}:${row.run.runtime_status}`} />
              <Metric label="Cost" value={`$${(row.run.run_usage?.cost_usd ?? 0).toFixed(2)}`} />
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-foreground">{value}</dd>
    </div>
  )
}

function SignalsPanel({ data }: { data: SignalsResponse | null }) {
  if (!data) return <EmptyPanel label="signals" />
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.items.map(item => (
        <article key={item.label} className={`rounded-lg border p-4 ${toneClasses[item.tone]}`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-current/70">
            {item.label}
          </p>
          <p className="mt-2 text-2xl font-semibold text-current">{item.value}</p>
          <p className="mt-2 text-xs text-current/60">Source: {item.provenance}</p>
        </article>
      ))}
    </section>
  )
}

function MemoryPanel({ data }: { data: MemoryResponse | null }) {
  if (!data) return <EmptyPanel label="memory" />
  return (
    <section className="grid gap-3 md:grid-cols-2">
      {data.runbooks.map(item => (
        <article key={item.label} className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {item.status}
          </p>
          <h2 className="mt-1 text-base font-semibold text-foreground">{item.label}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
          <p className="mt-3 text-xs text-muted-foreground">Source: {item.provenance}</p>
        </article>
      ))}
    </section>
  )
}

function ApprovalsPanel({ data }: { data: ApprovalQueueItem[] | null }) {
  if (!data) return <EmptyPanel label="approvals" />
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="space-y-3">
        {data.map(item => (
          <article key={`${item.run_id}:${item.approval_id ?? item.approval_type}`} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm text-amber-50/75">{item.approval_type}</p>
              </div>
              <span className="rounded-full border border-current/25 px-2 py-1 text-xs uppercase">
                {item.status}
              </span>
            </div>
          </article>
        ))}
        {data.length === 0 && <p className="text-sm text-muted-foreground">No pending approvals.</p>}
      </div>
    </section>
  )
}

function RunPanel({ data }: { data: RunDetail | null; fleet: FleetResponse | null }) {
  if (!data) return <EmptyPanel label="run" />
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg font-semibold text-foreground">{data.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{data.objective}</p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Status" value={data.status} />
        <Metric label="Runtime" value={`${data.runtime_id}:${data.runtime_status}`} />
        <Metric label="Events" value={String(data.event_count)} />
      </dl>
      <div className="mt-5 space-y-2">
        {(data.recent_events ?? []).slice(0, 5).map(event => (
          <div key={event.event_id} className="rounded-md border border-border bg-background/40 p-3">
            <p className="text-sm text-foreground">{event.summary}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {event.event_type} · {formatTime(event.occurred_at)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function EvidencePanel({ data }: { data: EvidenceReview | null; verify?: boolean }) {
  if (!data) return <EmptyPanel label="evidence" />
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Current" value={String(data.rollup.current)} />
        <Metric label="Stale" value={String(data.rollup.stale)} />
        <Metric label="Total" value={String(data.rollup.total)} />
      </div>
      <div className="mt-5 space-y-3">
        {data.items.map(item => (
          <article key={item.evidence_id} className={`rounded-lg border p-4 ${item.is_current_scope ? toneClasses.healthy : toneClasses.warning}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-current/70">
                  {item.kind} · {item.verdict}
                </p>
                <h2 className="mt-1 text-sm font-semibold text-current">{item.subject}</h2>
              </div>
              <span className="rounded-full border border-current/25 px-2 py-1 text-xs uppercase">
                {item.is_current_scope ? 'fresh' : 'stale'}
              </span>
            </div>
            <p className="mt-2 text-xs text-current/70">{formatTime(item.produced_at)}</p>
          </article>
        ))}
        {data.items.length === 0 && <p className="text-sm text-muted-foreground">No evidence items.</p>}
      </div>
    </section>
  )
}

function RuntimeHealthPanel({ data }: { data: RuntimeHealthResponse | null }) {
  if (!data) return <EmptyPanel label="runtime health" />
  return (
    <section className="grid gap-3 md:grid-cols-2">
      {data.runtimes.map(runtime => {
        const tone = runtime.status === 'ok' ? toneClasses.healthy : runtime.status === 'degraded' ? toneClasses.warning : toneClasses.muted
        return (
          <article key={runtime.runtime_id} className={`rounded-lg border p-5 ${tone}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-current/70">
              {runtime.runtime_id}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-current">{runtime.status}</h2>
            <p className="mt-2 text-sm text-current/75">{runtime.reason ?? runtime.producer}</p>
            <p className="mt-3 text-xs text-current/60">{formatTime(runtime.last_checked)}</p>
          </article>
        )
      })}
    </section>
  )
}

const titles: Record<PanelKind, string> = {
  attention: 'Galactus Attention',
  run: 'Galactus Run',
  verify: 'Galactus Verify',
  fleet: 'Galactus Fleet',
  signals: 'Galactus Signals',
  memory: 'Galactus Memory',
  approvals: 'Galactus Approvals',
  evidence: 'Galactus Evidence',
  'runtime-health': 'Galactus Runtime Health',
}

export function GalactusPanelCore({ kind }: { kind: PanelKind }) {
  const [state, setState] = useState<PanelState>(emptyState)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setState(await fetchPanelState(kind))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TTM data')
    } finally {
      setLoading(false)
    }
  }, [kind])

  useSmartPoll(load, 15_000)

  const body = useMemo(() => {
    switch (kind) {
      case 'attention':
        return <AttentionPanel data={state.attention} />
      case 'fleet':
        return <FleetPanel data={state.fleet} />
      case 'signals':
        return <SignalsPanel data={state.signals} />
      case 'memory':
        return <MemoryPanel data={state.memory} />
      case 'approvals':
        return <ApprovalsPanel data={state.approvals} />
      case 'run':
        return <RunPanel data={state.runDetail} fleet={state.fleet} />
      case 'verify':
      case 'evidence':
        return <EvidencePanel data={state.evidence} verify={kind === 'verify'} />
      case 'runtime-health':
        return <RuntimeHealthPanel data={state.runtimeHealth} />
    }
  }, [kind, state])

  return (
    <Shell
      title={titles[kind]}
      eyebrow="GSJ DW12 / Read-only supervision"
      error={error}
      loading={loading}
      onRetry={load}
    >
      {body}
    </Shell>
  )
}
