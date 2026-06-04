'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'
import { apiFetch } from '@/lib/api-client'

type Decision = 'approve' | 'needs_changes' | 'defer'

interface MorningApprovalItem {
  id: string
  source: 'mission-control-task' | 'mission-control-notification' | 'exec-approval' | 'athena-notion-snapshot' | 'stripe-revenue-snapshot'
  sourceId?: number | string
  title: string
  detail: string
  status: string
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  owner?: string | null
  project?: string | null
  url?: string | null
  options: Array<{ value: Decision; label: string }>
  metadata?: Record<string, unknown>
  response?: {
    decision: Decision
    feedback?: string
    actor: string
    respondedAt: number
  }
}

interface MorningApprovalBrief {
  id: number
  date: string
  title: string
  summary: string
  status: 'prepared' | 'in_review' | 'completed'
  items: MorningApprovalItem[]
  stats: Record<string, number>
  prepared_at: number
  published_at?: number | null
  responded_at?: number | null
}

const sourceLabels: Record<MorningApprovalItem['source'], string> = {
  'mission-control-task': 'Mission Control',
  'mission-control-notification': 'Inbox',
  'exec-approval': 'Exec gate',
  'athena-notion-snapshot': 'ATHENA / Notion',
  'stripe-revenue-snapshot': 'Stripe',
}

const priorityClasses: Record<MorningApprovalItem['priority'], string> = {
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
  medium: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  high: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  critical: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  urgent: 'bg-red-500/15 text-red-300 border-red-500/25',
}

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return 'not prepared yet'
  return new Date(timestamp * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function responseLabel(decision: Decision): string {
  if (decision === 'approve') return 'Approved'
  if (decision === 'needs_changes') return 'Needs changes'
  return 'Deferred'
}

export function MorningApprovalPanel() {
  const navigateToPanel = useNavigateToPanel()
  const [brief, setBrief] = useState<MorningApprovalBrief | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadBrief = useCallback(async (generate = false) => {
    setLoading(true)
    setError(null)
    try {
      const url = generate ? '/api/morning-approvals?generate=true&publish=true' : '/api/morning-approvals'
      const data = await apiFetch<{ brief?: MorningApprovalBrief | null }>(url, { cache: 'no-store' })
      if (!data.brief && !generate) {
        await loadBrief(true)
        return
      }
      setBrief(data.brief || null)
      setSelectedIndex(0)
      setFeedback('')
    } catch (err: any) {
      setError(err.message || 'Failed to load morning approvals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBrief(false)
  }, [loadBrief])

  const items = useMemo(() => brief?.items || [], [brief?.items])
  const pendingItems = useMemo(() => items.filter(item => !item.response), [items])
  const selectedItem = items[selectedIndex] || items[0] || null
  const selectedReadOnly = selectedItem?.metadata?.readOnly === true
  const progressText = brief
    ? `${brief.stats.responded || 0}/${brief.stats.total || 0} answered`
    : '0/0 answered'

  const selectItem = (index: number) => {
    setSelectedIndex(index)
    setFeedback('')
  }

  const respond = async (decision: Decision) => {
    if (!brief || !selectedItem) return
    setSaving(decision)
    setError(null)
    try {
      const data = await apiFetch<{ brief: MorningApprovalBrief }>('/api/morning-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respond',
          briefId: brief.id,
          itemId: selectedItem.id,
          decision,
          feedback,
        }),
      })
      setBrief(data.brief)
      setFeedback('')
      const nextPendingIndex = (data.brief.items as MorningApprovalItem[])
        .findIndex((item, index) => !item.response && index !== selectedIndex)
      if (nextPendingIndex >= 0) setSelectedIndex(nextPendingIndex)
    } catch (err: any) {
      setError(err.message || 'Failed to save response')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        Preparing the morning approval deck...
      </div>
    )
  }

  return (
    <div className="min-h-full bg-background">
      <div className="border-b border-border bg-surface-1 px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">Morning approvals</h1>
              {brief && (
                <span className="rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {brief.date}
                </span>
              )}
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
                {progressText}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {brief?.summary || 'No approval brief exists yet.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigateToPanel('athena')}>
              Ask ATHENA
            </Button>
            <Button size="sm" onClick={() => loadBrief(true)}>
              Refresh deck
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-auto mt-4 max-w-7xl px-4">
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        </div>
      )}

      {!brief || items.length === 0 ? (
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center">
          <h2 className="text-lg font-semibold text-foreground">Nothing is waiting on you right now</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Mission Control checked task gates, execution approvals, inbox signals, and the synced ATHENA snapshot.
          </p>
          <Button className="mt-5" onClick={() => loadBrief(true)}>Check again</Button>
        </div>
      ) : (
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                      {sourceLabels[selectedItem.source]}
                    </span>
                    <span className={`rounded border px-2 py-0.5 text-xs ${priorityClasses[selectedItem.priority]}`}>
                      {selectedItem.priority}
                    </span>
                    <span className="rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                      {selectedItem.status}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold leading-snug text-foreground">{selectedItem.title}</h2>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {selectedItem.owner && <span>Owner: {selectedItem.owner}</span>}
                    {selectedItem.project && <span>Project: {selectedItem.project}</span>}
                    <span>Prepared: {formatTime(brief.prepared_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={selectedIndex <= 0}
                    onClick={() => selectItem(Math.max(0, selectedIndex - 1))}
                  >
                    Prev
                  </Button>
                  <span className="px-2">{selectedIndex + 1} of {items.length}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={selectedIndex >= items.length - 1}
                    onClick={() => selectItem(Math.min(items.length - 1, selectedIndex + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-border bg-background p-4 text-sm leading-6 text-foreground">
                {selectedItem.detail}
              </div>

              {selectedItem.url && (
                <a
                  href={selectedItem.url}
                  target={selectedItem.url.startsWith('http') ? '_blank' : undefined}
                  rel={selectedItem.url.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="mt-3 inline-flex text-sm text-primary hover:underline"
                >
                  Open source
                </a>
              )}

              {selectedReadOnly ? (
                <div className="mt-4 rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                  Snapshot only
                </div>
              ) : selectedItem.response ? (
                <div className="mt-4 rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  {responseLabel(selectedItem.response.decision)} by {selectedItem.response.actor}
                  {selectedItem.response.feedback && (
                    <div className="mt-1 text-emerald-100/80">{selectedItem.response.feedback}</div>
                  )}
                </div>
              ) : (
                <>
                  <textarea
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="Feedback, context, or a question for the agent..."
                    className="mt-4 min-h-28 w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={!!saving}
                      onClick={() => respond('approve')}
                    >
                      {saving === 'approve' ? 'Saving...' : 'Approve'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!!saving}
                      onClick={() => respond('needs_changes')}
                    >
                      {saving === 'needs_changes' ? 'Saving...' : 'Needs changes'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!!saving}
                      onClick={() => respond('defer')}
                    >
                      {saving === 'defer' ? 'Saving...' : 'Defer'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </section>

          <aside className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">Waiting</h2>
                <span className="text-xs text-muted-foreground">{pendingItems.length} open</span>
              </div>
              <div className="max-h-[62vh] space-y-2 overflow-auto pr-1">
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => selectItem(index)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      index === selectedIndex
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-border bg-background hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{sourceLabels[item.source]}</span>
                      <span className={item.response ? 'text-xs text-emerald-300' : 'text-xs text-muted-foreground'}>
                        {item.metadata?.readOnly ? 'Snapshot' : item.response ? responseLabel(item.response.decision) : item.priority}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm font-medium text-foreground">{item.title}</div>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
