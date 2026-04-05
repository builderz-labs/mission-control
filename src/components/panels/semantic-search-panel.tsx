'use client'

import { useState, useEffect, useRef } from 'react'
import { formatRelativeTime } from '@/lib/format-date'
import type { SearchEntityType, SearchResponse, SearchResult } from '@/lib/search-engine'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ENTITY_TYPES: SearchEntityType[] = ['agent', 'task', 'memory', 'activity', 'alert']

type FilterTab = 'all' | SearchEntityType

const BADGE_COLORS: Record<SearchEntityType, string> = {
  agent:    'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  task:     'bg-green-500/20 text-green-400 border border-green-500/30',
  memory:   'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  activity: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  alert:    'bg-red-500/20 text-red-400 border border-red-500/30',
}

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { label: 'All', value: 'all' },
  { label: 'Agents', value: 'agent' },
  { label: 'Tasks', value: 'task' },
  { label: 'Memories', value: 'memory' },
  { label: 'Activities', value: 'activity' },
  { label: 'Alerts', value: 'alert' },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EntityBadge({ type }: { type: SearchEntityType }): React.JSX.Element {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${BADGE_COLORS[type]}`}>
      {type}
    </span>
  )
}

function ResultCard({ result }: { result: SearchResult }): React.JSX.Element {
  return (
    <div className="px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <EntityBadge type={result.entityType} />
          <span className="text-sm font-medium text-white truncate">{result.title}</span>
        </div>
        <span className="text-xs text-white/40 shrink-0">
          {formatRelativeTime(result.created_at)}
        </span>
      </div>
      {result.excerpt && (
        <p className="text-xs text-white/50 mt-0.5 line-clamp-2 pl-0.5">{result.excerpt}</p>
      )}
    </div>
  )
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-white/40">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <span className="text-sm">Searching...</span>
    </div>
  )
}

function EmptyState({ query }: { query: string }): React.JSX.Element {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-white/40">No results for &ldquo;{query}&rdquo;</p>
      <p className="text-xs text-white/30 mt-1">Try different terms or broaden your filter</p>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-white/40">Search failed</p>
      <button
        onClick={onRetry}
        className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
      >
        Retry
      </button>
    </div>
  )
}

function PlaceholderState(): React.JSX.Element {
  return (
    <div className="py-12 text-center text-white/30 text-sm">
      Type at least 2 characters to search
    </div>
  )
}

function SearchFooter({ data }: { data: SearchResponse }): React.JSX.Element {
  return (
    <div className="px-4 py-2 border-t border-white/5 flex items-center gap-3 text-[11px] text-white/30">
      <span>{data.totalHits} result{data.totalHits !== 1 ? 's' : ''}</span>
      <span>·</span>
      <span>{data.durationMs}ms</span>
      <span>·</span>
      <span className="font-mono">{data.engine}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SemanticSearchPanel(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  // Stable ref for retry — holds the last-executed query + filter
  const lastSearch = useRef({ query: '', filter: 'all' as FilterTab })

  const activeTypes: SearchEntityType[] =
    activeFilter === 'all' ? ALL_ENTITY_TYPES : [activeFilter]

  const runSearch = (q: string, types: SearchEntityType[]): void => {
    lastSearch.current = { query: q, filter: activeFilter }
    setLoading(true)
    setError(false)

    const typesParam = encodeURIComponent(types.join(','))
    const url = `/api/search?q=${encodeURIComponent(q)}&types=${typesParam}&limit=20`

    fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<SearchResponse>
      })
      .then(data => {
        setResults(data)
        setLoading(false)
      })
      .catch(err => {
        // AbortError means a newer debounce cancelled this fetch — ignore silently
        if ((err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError') return
        setError(true)
        setLoading(false)
      })
  }

  // Debounced search on query or filter change
  useEffect(() => {
    if (query.length < 2) {
      setResults(null)
      setLoading(false)
      setError(false)
      return
    }
    const timer = setTimeout(() => runSearch(query, activeTypes), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeFilter])

  const handleRetry = (): void => {
    if (lastSearch.current.query.length >= 2) {
      runSearch(lastSearch.current.query, activeTypes)
    }
  }

  const renderBody = (): React.JSX.Element => {
    if (query.length < 2) return <PlaceholderState />
    if (loading) return <LoadingState />
    if (error) return <ErrorState onRetry={handleRetry} />
    if (!results || results.results.length === 0) return <EmptyState query={query} />
    return (
      <div>
        {results.results.map(r => (
          <ResultCard key={`${r.entityType}-${r.id}`} result={r} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] text-white">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-white/5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-3">
          Search
        </h2>

        {/* Search input */}
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
          <svg className="w-4 h-4 text-white/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search agents, tasks, memories..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-white/30 hover:text-white/60 text-xs"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-3 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveFilter(tab.value)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                activeFilter === tab.value
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {renderBody()}
      </div>

      {/* Footer stats */}
      {results && !loading && !error && query.length >= 2 && (
        <SearchFooter data={results} />
      )}
    </div>
  )
}
