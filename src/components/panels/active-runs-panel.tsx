'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('ActiveRuns')

interface ActiveRun {
  id: string
  name: string
  type: 'tmux' | 'systemd' | 'cron' | 'process'
  owner: string
  status: 'running' | 'stopped' | 'failed' | 'stale'
  pid?: string
  startedAt?: string
  lastProgress?: string
  outputSnippet?: string
  unit?: string
  logPath?: string
}

interface ActiveRunsResponse {
  runs: ActiveRun[]
  summary: { total: number; active: number; stale: number; stopped: number }
  scannedAt: string
}

const TYPE_ICONS: Record<string, string> = {
  tmux: 'T',
  systemd: 'S',
  cron: 'C',
  process: 'P',
}

const TYPE_LABELS: Record<string, string> = {
  tmux: 'tmux session',
  systemd: 'systemd unit',
  cron: 'cron job',
  process: 'background process',
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  stale: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  stopped: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/40',
  failed: 'bg-red-500/20 text-red-400 border-red-500/40',
}

const OWNER_STYLES: Record<string, string> = {
  ralph: 'bg-blue-500/15 text-blue-400',
  obsidian: 'bg-purple-500/15 text-purple-400',
  sentinel: 'bg-cyan-500/15 text-cyan-400',
  system: 'bg-zinc-500/15 text-zinc-400',
}

type FilterType = 'all' | 'tmux' | 'systemd' | 'cron' | 'process'
type FilterStatus = 'all' | 'running' | 'stale' | 'stopped' | 'failed'

export function ActiveRunsPanel() {
  const [data, setData] = useState<ActiveRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/active-runs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err) {
      log.error('Failed to fetch active runs:', err)
      setError('Failed to load active runs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRuns()
    const interval = setInterval(fetchRuns, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchRuns])

  if (loading && !data) {
    return (
      <div className="p-6">
        <Loader variant="inline" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-400">{error}</div>
        <Button variant="outline" size="sm" onClick={fetchRuns} className="mt-2">
          Retry
        </Button>
      </div>
    )
  }

  const summary = data?.summary || { total: 0, active: 0, stale: 0, stopped: 0 }
  const runs = (data?.runs || []).filter(r => {
    if (filterType !== 'all' && r.type !== filterType) return false
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    return true
  })

  // Sort: running first, then stale, then stopped/failed
  const sortOrder: Record<string, number> = { running: 0, stale: 1, failed: 2, stopped: 3 }
  runs.sort((a, b) => (sortOrder[a.status] ?? 4) - (sortOrder[b.status] ?? 4))

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Active Runs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Machine processes, sessions, and scheduled jobs
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.scannedAt && (
            <span className="text-2xs text-muted-foreground">
              Scanned {formatRelativeTime(data.scannedAt)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
            {loading ? 'Scanning...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total" value={summary.total} color="text-foreground" />
        <SummaryCard label="Active" value={summary.active} color="text-emerald-400" />
        <SummaryCard label="Stale" value={summary.stale} color="text-amber-400" />
        <SummaryCard label="Stopped / Failed" value={summary.stopped} color="text-zinc-400" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <FilterGroup
          label="Type"
          value={filterType}
          onChange={(v) => setFilterType(v as FilterType)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'tmux', label: 'tmux' },
            { value: 'systemd', label: 'systemd' },
            { value: 'cron', label: 'cron' },
            { value: 'process', label: 'process' },
          ]}
        />
        <div className="w-px bg-border mx-1" />
        <FilterGroup
          label="Status"
          value={filterStatus}
          onChange={(v) => setFilterStatus(v as FilterStatus)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'running', label: 'Running' },
            { value: 'stale', label: 'Stale' },
            { value: 'stopped', label: 'Stopped' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
      </div>

      {/* Runs List */}
      {runs.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No runs found matching filters
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map(run => (
            <RunCard
              key={run.id}
              run={run}
              expanded={expandedRun === run.id}
              onToggle={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-2xs text-muted-foreground mr-1">{label}:</span>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2 py-0.5 text-2xs rounded-md transition-colors ${
            value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function RunCard({ run, expanded, onToggle }: { run: ActiveRun; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header Row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/50 transition-colors"
      >
        {/* Status dot */}
        <div className="flex-shrink-0">
          {run.status === 'running' ? (
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          ) : run.status === 'stale' ? (
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          ) : run.status === 'failed' ? (
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          ) : (
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
          )}
        </div>

        {/* Type badge */}
        <span className="flex-shrink-0 w-6 h-6 rounded bg-secondary text-2xs font-mono font-bold flex items-center justify-center text-muted-foreground"
          title={TYPE_LABELS[run.type]}
        >
          {TYPE_ICONS[run.type]}
        </span>

        {/* Name */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{run.name}</div>
          <div className="text-2xs text-muted-foreground">
            {TYPE_LABELS[run.type]}
            {run.pid && ` (PID ${run.pid})`}
          </div>
        </div>

        {/* Owner badge */}
        <span className={`flex-shrink-0 px-2 py-0.5 text-2xs rounded-full ${OWNER_STYLES[run.owner] || OWNER_STYLES.system}`}>
          {run.owner}
        </span>

        {/* Status badge */}
        <span className={`flex-shrink-0 px-2 py-0.5 text-2xs rounded-full border ${STATUS_STYLES[run.status]}`}>
          {run.status}
        </span>

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2 bg-secondary/30">
          {run.startedAt && (
            <DetailRow label="Started" value={`${formatRelativeTime(run.startedAt)} (${new Date(run.startedAt).toLocaleString()})`} />
          )}
          {run.lastProgress && (
            <DetailRow label="Last Progress" value={`${formatRelativeTime(run.lastProgress)} (${new Date(run.lastProgress).toLocaleString()})`} />
          )}
          {run.unit && (
            <DetailRow label="Unit" value={run.unit} />
          )}
          {run.logPath && (
            <DetailRow label="Log" value={run.logPath} />
          )}
          {run.outputSnippet && (
            <div>
              <div className="text-2xs text-muted-foreground mb-1">Latest Output</div>
              <pre className="text-2xs bg-background rounded p-2 overflow-x-auto whitespace-pre-wrap text-foreground/80 max-h-32 overflow-y-auto font-mono">
                {run.outputSnippet}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-2xs">
      <span className="text-muted-foreground flex-shrink-0 w-24">{label}</span>
      <span className="text-foreground/80 font-mono break-all">{value}</span>
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
