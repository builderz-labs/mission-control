'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// --- Types ---

type TweetRating = 'fire' | 'meh' | 'noise'

interface Tweet {
  id: string
  title: string
  author: string
  theme: string
  verdict: string
  action: string
  source: string
  tweet_link: string
  digest: string
  content: string
  created_at: string
  scraped_at: string
  pinned: number
  media_urls: string
  triage_status: string
  rating: TweetRating | null
}

// --- Theme colors (from Eden) ---

const THEME_COLORS: Record<string, string> = {
  'AI/LLM': 'bg-blue-500/20 text-blue-400',
  'Apple/Tech': 'bg-zinc-500/20 text-zinc-400',
  'Dev Tools': 'bg-purple-500/20 text-purple-400',
  'Creative Coding': 'bg-pink-500/20 text-pink-400',
  'Hardware': 'bg-amber-500/20 text-amber-400',
  'Design/UX': 'bg-teal-500/20 text-teal-400',
  'News': 'bg-zinc-500/20 text-zinc-300',
  'Politics': 'bg-red-500/20 text-red-400',
}

const RATING_CONFIG: Record<TweetRating, { emoji: string; label: string; active: string; hover: string }> = {
  fire: { emoji: '\uD83D\uDD25', label: 'Fire', active: 'bg-amber-500/20 text-amber-400', hover: 'hover:bg-amber-500/10 hover:text-amber-400' },
  meh: { emoji: '\uD83D\uDE10', label: 'Meh', active: 'bg-zinc-500/20 text-zinc-400', hover: 'hover:bg-zinc-500/10 hover:text-zinc-400' },
  noise: { emoji: '\uD83D\uDDD1\uFE0F', label: 'Noise', active: 'bg-red-500/20 text-red-400', hover: 'hover:bg-red-500/10 hover:text-red-400' },
}

// --- Helpers ---

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

// --- Components ---

function ThemeBadge({ theme }: { theme: string }) {
  const colorClass = THEME_COLORS[theme] || 'bg-secondary text-muted-foreground'
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colorClass}`}>
      {theme}
    </span>
  )
}

function RatingButton({ rating, current, onRate }: {
  rating: TweetRating
  current: TweetRating | null
  onRate: (r: TweetRating) => void
}) {
  const config = RATING_CONFIG[rating]
  const isActive = current === rating
  return (
    <button
      onClick={() => onRate(rating)}
      title={config.label}
      className={`px-1.5 py-1 rounded text-xs transition-colors ${
        isActive ? config.active : `text-muted-foreground ${config.hover}`
      }`}
    >
      {config.emoji}
    </button>
  )
}

function TweetCard({ tweet, onUpdate, expanded, onToggle, focused, itemRef }: {
  tweet: Tweet
  onUpdate: () => void
  expanded: boolean
  onToggle: () => void
  focused?: boolean
  itemRef?: React.Ref<HTMLDivElement>
}) {
  const [updating, setUpdating] = useState(false)

  const handleRate = async (rating: TweetRating) => {
    setUpdating(true)
    try {
      const newRating = tweet.rating === rating ? null : rating
      await fetch(`/api/xfeed/${tweet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: newRating }),
      })
      onUpdate()
    } finally {
      setUpdating(false)
    }
  }

  const handlePin = async () => {
    setUpdating(true)
    try {
      await fetch(`/api/xfeed/${tweet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !tweet.pinned }),
      })
      onUpdate()
    } finally {
      setUpdating(false)
    }
  }

  const isNoise = tweet.rating === 'noise'

  return (
    <div ref={itemRef} className={`border border-border rounded-lg bg-card transition-all ${isNoise ? 'opacity-50' : ''} ${tweet.pinned ? 'ring-1 ring-amber-500/30' : ''} ${focused ? 'ring-2 ring-primary/50' : ''}`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {tweet.theme && <ThemeBadge theme={tweet.theme} />}
            <span className="text-xs text-muted-foreground font-medium">@{tweet.author}</span>
            <span className="text-xs text-muted-foreground/60">{relativeTime(tweet.scraped_at || tweet.created_at)}</span>
            {tweet.pinned ? <span title="Pinned" className="text-amber-400 text-xs">{'\uD83D\uDCCC'}</span> : null}
          </div>
          <p className="text-sm text-foreground line-clamp-2">
            {tweet.title || tweet.content}
          </p>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-border/50 pt-3">
          {tweet.title && tweet.content && tweet.content !== tweet.title && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{tweet.content}</p>
          )}
          {tweet.verdict && (
            <div className="text-xs text-muted-foreground bg-secondary/50 rounded px-2 py-1.5">
              <span className="font-medium text-foreground">Verdict:</span> {tweet.verdict}
            </div>
          )}
          {tweet.tweet_link && (
            <a
              href={tweet.tweet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open on X {'\u2197\uFE0F'}
            </a>
          )}
          {tweet.digest && (
            <span className="text-[10px] text-muted-foreground/60 block">Digest: {tweet.digest}</span>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-border/50">
        <div className="flex items-center gap-0.5 bg-secondary/40 rounded-md">
          <RatingButton rating="fire" current={tweet.rating} onRate={handleRate} />
          <RatingButton rating="meh" current={tweet.rating} onRate={handleRate} />
          <RatingButton rating="noise" current={tweet.rating} onRate={handleRate} />
        </div>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={handlePin}
          disabled={updating}
          title={tweet.pinned ? 'Unpin' : 'Pin'}
          className={`px-1.5 py-1 rounded text-xs transition-colors ${
            tweet.pinned
              ? 'text-amber-400 bg-amber-500/10'
              : 'text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10'
          }`}
        >
          {'\uD83D\uDCCC'}
        </button>
        {tweet.tweet_link && (
          <a
            href={tweet.tweet_link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-1.5 py-1 rounded text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Open on X"
          >
            {'\u2197\uFE0F'}
          </a>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/50">
          {tweet.rating && RATING_CONFIG[tweet.rating]?.emoji}
        </span>
      </div>
    </div>
  )
}

// --- Filter Select ---

function FilterSelect({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-secondary text-foreground text-xs rounded-md px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// --- Main Panel ---

const PAGE_SIZE = 50

export function XFeedPanel() {
  const [tweets, setTweets] = useState<Tweet[]>([])
  const [total, setTotal] = useState(0)
  const [themes, setThemes] = useState<string[]>([])
  const [digests, setDigests] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Filters
  const [themeFilter, setThemeFilter] = useState('')
  const [ratingFilter, setRatingFilter] = useState('')
  const [digestFilter, setDigestFilter] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  const searchTimeoutRef = useRef<NodeJS.Timeout>(null)

  const fetchTweets = useCallback(async (newOffset = 0) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (themeFilter) params.set('theme', themeFilter)
      if (ratingFilter) params.set('rating', ratingFilter)
      if (digestFilter) params.set('digest', digestFilter)
      if (search) params.set('search', search)
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(newOffset))

      const res = await fetch(`/api/xfeed?${params}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()

      if (newOffset > 0) {
        setTweets(prev => [...prev, ...data.tweets])
      } else {
        setTweets(data.tweets)
      }
      setTotal(data.total)
      if (data.themes) setThemes(data.themes)
      if (data.digests) setDigests(data.digests)
      setOffset(newOffset)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tweets')
    } finally {
      setLoading(false)
    }
  }, [themeFilter, ratingFilter, digestFilter, search])

  // Initial load + filter changes
  useEffect(() => {
    fetchTweets(0)
  }, [fetchTweets])

  // Reset focus when tweets change
  useEffect(() => {
    setFocusedIndex(null)
  }, [themeFilter, ratingFilter, digestFilter, search])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex !== null && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if input/textarea/contenteditable is focused
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      // Skip if detail view is open
      if (expandedId) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex(prev => {
          if (prev === null) return 0
          return Math.min(prev + 1, tweets.length - 1)
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex(prev => {
          if (prev === null) return 0
          return Math.max(prev - 1, 0)
        })
      } else if (e.key === 'Enter' && focusedIndex !== null) {
        e.preventDefault()
        const tweet = tweets[focusedIndex]
        if (tweet) setExpandedId(tweet.id)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setFocusedIndex(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tweets, expandedId, focusedIndex])

  // Debounced search
  const handleSearch = (value: string) => {
    setSearch(value)
  }

  const handleSearchInput = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => handleSearch(value), 300)
  }

  const handleLoadMore = () => {
    fetchTweets(offset + PAGE_SIZE)
  }

  const handleUpdate = () => {
    fetchTweets(0)
  }

  const hasMore = tweets.length < total

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">X Feed</h2>
            {total > 0 && (
              <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                {total}
              </span>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect
            value={themeFilter}
            onChange={setThemeFilter}
            placeholder="All Themes"
            options={themes.map(t => ({ value: t, label: t }))}
          />
          <FilterSelect
            value={ratingFilter}
            onChange={setRatingFilter}
            placeholder="All Ratings"
            options={[
              { value: 'fire', label: '\uD83D\uDD25 Fire' },
              { value: 'meh', label: '\uD83D\uDE10 Meh' },
              { value: 'noise', label: '\uD83D\uDDD1\uFE0F Noise' },
              { value: 'unrated', label: 'Unrated' },
            ]}
          />
          <FilterSelect
            value={digestFilter}
            onChange={setDigestFilter}
            placeholder="All Digests"
            options={digests.map(d => ({ value: d, label: d }))}
          />
          <input
            type="text"
            placeholder="Search..."
            onChange={(e) => handleSearchInput(e.target.value)}
            className="bg-secondary text-foreground text-xs rounded-md px-3 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60 w-40"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="text-red-400 text-sm text-center py-8">
            Failed to load tweets: {error}
          </div>
        )}

        {!loading && !error && tweets.length === 0 && (
          <div className="text-muted-foreground text-sm text-center py-12">
            No tweets found. Adjust filters or import tweets.
          </div>
        )}

        <div className="space-y-2 max-w-3xl mx-auto">
          {tweets.map((tweet, index) => (
            <TweetCard
              key={tweet.id}
              tweet={tweet}
              onUpdate={handleUpdate}
              expanded={expandedId === tweet.id}
              onToggle={() => setExpandedId(expandedId === tweet.id ? null : tweet.id)}
              focused={focusedIndex === index}
              itemRef={(el: HTMLDivElement | null) => { itemRefs.current[index] = el }}
            />
          ))}
        </div>

        {/* Load more */}
        {hasMore && !loading && (
          <div className="flex justify-center py-6">
            <button
              onClick={handleLoadMore}
              className="text-xs text-primary hover:underline"
            >
              Load more ({tweets.length} of {total})
            </button>
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-8">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              Loading...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
