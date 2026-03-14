'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { Loader } from '@/components/ui/loader'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WFTask {
  id: string
  title: string
  type: string
  agent: string
  status: string
  priority: string
  scope: string | null
  created_at: string
  dispatched_at: string | null
  completed_at: string | null
  goal: string | null
  failure_reason: string | null
  tags: string | null
}

interface WFIdea {
  id: string
  timestamp: string
  raw_text: string
  transcription: string | null
  status: string
  scoped_task_id: string | null
  created_at: string
  clarification_reason: string | null
}

interface WFCounts {
  tasks_total: number
  tasks_active: number
  ideas_total: number
  ideas_inbox: number
  approvals_pending: number
  by_status: Record<string, number>
}

interface WFMeta {
  source: string
  wal_mode: boolean
  last_idea: string | null
  fetched_at: string
}

interface WFData {
  tasks: WFTask[]
  ideas: WFIdea[]
  approvals: unknown[]
  counts: WFCounts
  meta: WFMeta
  error?: string
  available?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  inbox: 'text-zinc-400',
  scoped: 'text-blue-400',
  routed: 'text-yellow-400',
  dispatched: 'text-purple-400',
  in_progress: 'text-cyan-400',
  complete: 'text-green-400',
  failed: 'text-red-400',
  cancelled: 'text-zinc-600',
  needs_clarification: 'text-orange-400',
}

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'text-red-400',
  P2: 'text-yellow-400',
  P3: 'text-zinc-400',
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

const TERMINAL = new Set(['complete', 'failed', 'cancelled'])

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'text-zinc-400'
  return (
    <span className={`text-xs font-mono uppercase ${color}`}>{status.replace('_', ' ')}</span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] ?? 'text-zinc-400'
  return <span className={`text-xs font-mono font-bold ${color}`}>{priority}</span>
}

function PipelineTab({ tasks }: { tasks: WFTask[] }) {
  const [filter, setFilter] = useState<'active' | 'all'>('active')

  const displayed = useMemo(
    () => (filter === 'active' ? tasks.filter((t) => !TERMINAL.has(t.status)) : tasks),
    [tasks, filter]
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Filter toggle */}
      <div className="flex gap-2">
        {(['active', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded font-mono transition-colors ${
              filter === f
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {f === 'active' ? 'Active' : 'All'}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-600 font-mono">
          {displayed.length} task{displayed.length !== 1 ? 's' : ''}
        </span>
      </div>

      {displayed.length === 0 && (
        <p className="text-sm text-zinc-500 italic">No tasks{filter === 'active' ? ' in flight' : ''}.</p>
      )}

      {displayed.map((task) => (
        <div
          key={task.id}
          className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/50 flex flex-col gap-1"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm text-zinc-100 font-medium leading-snug">{task.title}</span>
            <div className="flex items-center gap-2 shrink-0">
              <PriorityBadge priority={task.priority} />
              <StatusBadge status={task.status} />
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono">
            <span>{task.type}</span>
            <span>→ {task.agent}</span>
            {task.scope && <span className="text-zinc-600">{task.scope}</span>}
            <span className="ml-auto">{timeAgo(task.created_at)}</span>
          </div>
          {task.failure_reason && (
            <p className="text-xs text-red-400 font-mono mt-1 truncate" title={task.failure_reason}>
              ✗ {task.failure_reason}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function IdeasTab({ ideas }: { ideas: WFIdea[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <span className="text-xs text-zinc-600 font-mono">{ideas.length} idea{ideas.length !== 1 ? 's' : ''}</span>
      </div>

      {ideas.length === 0 && (
        <p className="text-sm text-zinc-500 italic">No ideas yet.</p>
      )}

      {ideas.map((idea) => (
        <div
          key={idea.id}
          className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/50 flex flex-col gap-1"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-zinc-100 leading-snug line-clamp-2">
              {idea.transcription || idea.raw_text}
            </p>
            <StatusBadge status={idea.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono">
            <span>{timeAgo(idea.created_at)}</span>
            {idea.scoped_task_id && (
              <span className="text-blue-400">→ task created</span>
            )}
            {idea.clarification_reason && (
              <span className="text-orange-400 truncate" title={idea.clarification_reason}>
                ⚠ needs clarification
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function CountsBar({ counts }: { counts: WFCounts }) {
  return (
    <div className="flex gap-4 text-xs font-mono text-zinc-400 border-b border-zinc-800 pb-3 mb-4">
      <span>
        <span className="text-white font-bold">{counts.tasks_active}</span> active tasks
      </span>
      <span>
        <span className="text-white font-bold">{counts.ideas_inbox}</span> ideas in inbox
      </span>
      <span>
        <span className={counts.approvals_pending > 0 ? 'text-yellow-400 font-bold' : 'text-white font-bold'}>
          {counts.approvals_pending}
        </span>{' '}
        pending approval{counts.approvals_pending !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

type Tab = 'pipeline' | 'ideas'

export function WatsonFlowPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('pipeline')
  const [data, setData] = useState<WFData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/watsonflow')
      const json: WFData = await res.json()
      setData(json)
      setFetchError(null)
    } catch (err: any) {
      setFetchError(err?.message ?? 'Failed to fetch WatsonFlow data')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { poll() }, [poll])

  // Poll every 10s
  useSmartPoll(poll, 10000)

  // WatsonFlow daemon not running / DB missing
  if (!loading && (data?.available === false || fetchError)) {
    return (
      <div className="p-6 flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">WatsonFlow</h2>
        <div className="border border-red-800 rounded-lg p-4 bg-red-950/20">
          <p className="text-sm text-red-400 font-mono">
            {data?.error ?? fetchError ?? 'WatsonFlow unavailable — is the daemon running?'}
          </p>
          <p className="text-xs text-zinc-500 mt-2">
            Run: <code className="text-zinc-300">launchctl list | grep watsonflow</code>
          </p>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader />
      </div>
    )
  }

  const { tasks = [], ideas = [], counts, meta } = data ?? {}

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">WatsonFlow</h2>
          {meta?.fetched_at && (
            <p className="text-xs text-zinc-600 font-mono mt-0.5">
              updated {timeAgo(meta.fetched_at)}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {(['pipeline', 'ideas'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs rounded font-mono capitalize transition-colors ${
                activeTab === tab
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
              {tab === 'pipeline' && counts && (
                <span className="ml-1.5 text-zinc-500">{counts.tasks_active}</span>
              )}
              {tab === 'ideas' && counts && (
                <span className="ml-1.5 text-zinc-500">{counts.ideas_inbox}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {counts && <CountsBar counts={counts} />}

        {activeTab === 'pipeline' && <PipelineTab tasks={tasks} />}
        {activeTab === 'ideas' && <IdeasTab ideas={ideas} />}
      </div>
    </div>
  )
}
