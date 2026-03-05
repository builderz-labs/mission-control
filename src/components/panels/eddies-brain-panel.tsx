'use client'

import { useState, useEffect, useCallback } from 'react'

interface BrainEntry {
  date: string
  dayOfWeek: string
  time: string
  title: string
  source?: string
  insight: string
  whyItMatters?: string
  tags: string[]
  action?: string
  related?: string
}

export function EddiesBrainPanel() {
  const [entries, setEntries] = useState<BrainEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [allTags, setAllTags] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [topics, setTopics] = useState<string[]>([])
  const [selectedEntry, setSelectedEntry] = useState<BrainEntry | null>(null)
  const [view, setView] = useState<'list' | 'detail'>('list')

  const fetchEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams({ action: 'entries' })
      if (search) params.set('search', search)
      if (tagFilter) params.set('tag', tagFilter)

      const res = await fetch(`/api/eddies-brain?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setEntries(data.entries || [])
      setTotal(data.total || 0)
      setAllTags(data.allTags || [])
      setTopics(data.topics || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, tagFilter])

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => fetchEntries(), 300)
    return () => clearTimeout(timer)
  }, [fetchEntries])

  const openEntry = (entry: BrainEntry) => {
    setSelectedEntry(entry)
    setView('detail')
  }

  const backToList = () => {
    setSelectedEntry(null)
    setView('list')
  }

  // Detail view
  if (view === 'detail' && selectedEntry) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <button
          onClick={backToList}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M10 3l-5 5 5 5" />
          </svg>
          Back to entries
        </button>

        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <span>{selectedEntry.date}</span>
              {selectedEntry.dayOfWeek && <span>({selectedEntry.dayOfWeek})</span>}
              <span>{selectedEntry.time}</span>
            </div>
            <h2 className="text-lg font-semibold">{selectedEntry.title}</h2>
          </div>

          {selectedEntry.source && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">Source</h3>
              <p className="text-sm">{selectedEntry.source}</p>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1">Insight</h3>
            <p className="text-sm leading-relaxed">{selectedEntry.insight}</p>
          </div>

          {selectedEntry.whyItMatters && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">Why This Matters</h3>
              <p className="text-sm leading-relaxed italic text-muted-foreground">
                {selectedEntry.whyItMatters}
              </p>
            </div>
          )}

          {selectedEntry.action && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">Action</h3>
              <p className="text-sm">{selectedEntry.action}</p>
            </div>
          )}

          {selectedEntry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {selectedEntry.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setTagFilter(tag)
                    backToList()
                  }}
                  className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Eddie&apos;s Brain</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {total} journal entr{total !== 1 ? 'ies' : 'y'}
          {topics.length > 0 && ` \u00B7 ${topics.length} topic${topics.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search entries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {(search || tagFilter) && (
          <button
            onClick={() => {
              setSearch('')
              setTagFilter('')
            }}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Tag cloud */}
      {!search && !tagFilter && allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag)}
              className="px-2 py-0.5 text-2xs bg-secondary text-secondary-foreground rounded-full hover:bg-secondary/80 transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading entries...</div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {search || tagFilter ? 'No entries match your search.' : 'No journal entries yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <button
              key={`${entry.date}-${entry.time}-${i}`}
              onClick={() => openEntry(entry)}
              className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* Date badge */}
                <div className="shrink-0 w-14 text-center pt-0.5">
                  <div className="text-2xs text-muted-foreground">{entry.date.slice(5)}</div>
                  <div className="text-2xs text-muted-foreground/60">{entry.time.replace(' ET', '')}</div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium truncate">{entry.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.insight}</p>
                  {entry.source && (
                    <p className="text-2xs text-muted-foreground/70 mt-1">
                      {entry.source}
                    </p>
                  )}
                  {entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-2xs bg-primary/10 text-primary rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Arrow */}
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 text-muted-foreground/40 mt-1">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
