'use client'

import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { useMissionControl } from '@/store'

// --- Types ---

type InboxSourceType = 'task' | 'garden' | 'xfeed' | 'notification'

interface InboxItem {
  id: string
  source: InboxSourceType
  title: string
  subtitle: string
  icon: string
  badge: string
  badgeColor: string
  timestamp: number
  actionUrl?: string
  metadata: Record<string, any>
}

interface InboxCounts {
  task: number
  garden: number
  xfeed: number
  notification: number
}

// --- Source config ---

const SOURCE_CONFIG: Record<InboxSourceType, {
  label: string
  color: string
  badgeBg: string
  dotColor: string
}> = {
  task: {
    label: 'Tasks',
    color: 'text-blue-400',
    badgeBg: 'bg-blue-500/15 text-blue-400',
    dotColor: 'bg-blue-400',
  },
  garden: {
    label: 'Garden',
    color: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/15 text-emerald-400',
    dotColor: 'bg-emerald-400',
  },
  xfeed: {
    label: 'X Feed',
    color: 'text-purple-400',
    badgeBg: 'bg-purple-500/15 text-purple-400',
    dotColor: 'bg-purple-400',
  },
  notification: {
    label: 'Alerts',
    color: 'text-amber-400',
    badgeBg: 'bg-amber-500/15 text-amber-400',
    dotColor: 'bg-amber-400',
  },
}

const FILTERS: { key: InboxSourceType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks' },
  { key: 'garden', label: 'Garden' },
  { key: 'xfeed', label: 'Feed' },
  { key: 'notification', label: 'Alerts' },
]

// --- Helpers ---

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

// --- Component ---

export function InboxPanel() {
  const { setActiveTab } = useMissionControl()
  const [items, setItems] = useState<InboxItem[]>([])
  const [counts, setCounts] = useState<InboxCounts>({ task: 0, garden: 0, xfeed: 0, notification: 0 })
  const [filter, setFilter] = useState<InboxSourceType | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInbox = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('source', filter)
      params.set('limit', '100')

      const res = await fetch(`/api/inbox?${params}`)
      if (!res.ok) throw new Error('Failed to fetch inbox')
      const data = await res.json()
      setItems(data.items)
      setCounts(data.counts)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch inbox')
    } finally {
      setLoading(false)
    }
  }, [filter])

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchInbox()
    const interval = setInterval(fetchInbox, 30_000)
    return () => clearInterval(interval)
  }, [fetchInbox])

  const filtered = filter === 'all' ? items : items.filter(i => i.source === filter)
  const totalCount = counts.task + counts.garden + counts.xfeed + counts.notification

  function handleItemClick(item: InboxItem) {
    if (item.actionUrl) {
      // Navigate to the relevant panel
      const panel = item.actionUrl.split('?')[0]
      setActiveTab(panel)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5 text-primary">
              <path d="M2 4l6 4 6-4" />
              <rect x="1" y="3" width="14" height="10" rx="1.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
            <p className="text-xs text-muted-foreground">
              {totalCount > 0 ? `${totalCount} item${totalCount === 1 ? '' : 's'} need attention` : 'All caught up'}
            </p>
          </div>
        </div>
        <button
          onClick={fetchInbox}
          className="text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-secondary transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="shrink-0 px-6 py-3 border-b border-border overflow-x-auto">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            {FILTERS.map(({ key, label }) => {
              const count = key === 'all' ? totalCount : counts[key]
              return (
                <TabsTab key={key} value={key} className="text-sm">
                  {label}
                  {count > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center bg-muted text-muted-foreground data-active:bg-primary/20 data-active:text-primary">
                      {count}
                    </span>
                  )}
                </TabsTab>
              )
            })}
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 bg-muted rounded" />
                    <div className="h-4 w-3/4 bg-muted rounded" />
                    <div className="h-3 w-1/2 bg-muted rounded" />
                  </div>
                  <div className="h-3 w-12 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-destructive">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 5v3.5M8 10.5v.5" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-foreground mb-1">Failed to load</h2>
              <p className="text-sm text-muted-foreground mb-3">{error}</p>
              <button onClick={fetchInbox} className="text-sm text-primary hover:underline">Try again</button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-primary">
                  <path d="M4 8l3 3 5-6" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-foreground mb-1">All caught up</h2>
              <p className="text-sm text-muted-foreground">
                {filter === 'all'
                  ? 'No new items in your inbox. Check back later.'
                  : `No ${SOURCE_CONFIG[filter as InboxSourceType]?.label || filter} items to show.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-3 max-w-3xl">
            {filtered.map((item) => (
              <InboxCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
            ))}
            {filtered.length > 0 && filtered.length < 5 && (
              <div className="flex items-center justify-center gap-2 pt-4 pb-2 text-sm text-muted-foreground">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-primary">
                  <path d="M4 8l3 3 5-6" />
                </svg>
                <span>All caught up</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// --- InboxCard ---

function InboxCard({ item, onClick }: { item: InboxItem; onClick: () => void }) {
  const config = SOURCE_CONFIG[item.source]

  return (
    <div
      onClick={onClick}
      className="group border border-border rounded-xl bg-card ring-1 ring-white/[0.03] shadow-sm transition-all cursor-pointer hover:shadow-md hover:bg-secondary/50 hover:border-primary/20 active:scale-[0.995] p-4"
    >
      <div className="flex items-start gap-3">
        {/* Source icon */}
        <div className={`mt-0.5 w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.badgeBg}`}>
          <span className="text-base">{item.icon}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
              {config.label}
            </span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${config.badgeBg}`}>
              {item.badge}
            </span>
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1 leading-snug line-clamp-1">
            {item.title}
          </h3>
          <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
            {item.subtitle}
          </p>
        </div>

        {/* Timestamp */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 4v4l2.5 2.5" />
            </svg>
            {timeAgo(item.timestamp)}
          </span>
        </div>
      </div>
    </div>
  )
}
