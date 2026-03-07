'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { PropertyChip } from '@/components/ui/property-chip'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { Lightbox } from '@/components/ui/lightbox'
import { OGCard } from '@/components/ui/og-card'
import { Badge } from '@/components/ui/badge'

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

interface ParsedMedia {
  images: string[]
  videos: Array<{ url: string; poster?: string }>
}

function parseMedia(media_urls: string): ParsedMedia {
  const result: ParsedMedia = { images: [], videos: [] }

  try {
    if (!media_urls || media_urls === '[]') return result

    const urls: string[] = JSON.parse(media_urls)

    for (const url of urls) {
      // Video detection: contains video.twimg.com AND ends with .mp4 (ignore query params)
      if (url.includes('video.twimg.com') && url.match(/\.mp4(\?.*)?$/)) {
        result.videos.push({ url })
      } else {
        // Everything else is an image (including old amplify_video_thumb thumbnails)
        result.images.push(url)
      }
    }
  } catch (e) {
    console.error('Failed to parse media_urls:', e, media_urls)
  }

  return result
}

function extractTcoLinks(content: string): string[] {
  const tcoRegex = /https:\/\/t\.co\/\w+/g
  const matches = content.match(tcoRegex)
  if (!matches) return []

  // Deduplicate
  return [...new Set(matches)]
}

// --- Components ---

function ThemeBadge({ theme }: { theme: string }) {
  // Map theme colors to Badge variants
  const variantMap: Record<string, 'info' | 'success' | 'warning' | 'secondary' | 'destructive'> = {
    'AI/LLM': 'info',
    'Apple/Tech': 'secondary',
    'Dev Tools': 'secondary',
    'Creative Coding': 'secondary',
    'Hardware': 'warning',
    'Design/UX': 'info',
    'News': 'secondary',
    'Politics': 'destructive',
  }

  const variant = variantMap[theme] || 'secondary'

  return (
    <Badge variant={variant} size="sm">
      {theme}
    </Badge>
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
    <Button
      variant="ghost"
      size="xs"
      onClick={() => onRate(rating)}
      title={config.label}
      className={isActive ? config.active : config.hover}
    >
      {config.emoji}
    </Button>
  )
}

function TweetCard({ tweet, onUpdate, focused, itemRef }: {
  tweet: Tweet
  onUpdate: () => void
  focused?: boolean
  itemRef?: React.Ref<HTMLDivElement>
}) {
  const [updating, setUpdating] = useState(false)
  const [lightboxState, setLightboxState] = useState<{ images: string[]; index: number } | null>(null)
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())
  const [brokenVideos, setBrokenVideos] = useState<Set<string>>(new Set())

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

  // Parse media URLs into images and videos
  const media = parseMedia(tweet.media_urls)
  const workingImages = media.images.filter(url => !brokenImages.has(url))
  // Don't filter broken videos during debugging
  const workingVideos = media.videos

  const handleImageError = (url: string) => {
    console.error('[XFeed] Image failed to load:', url)
    setBrokenImages(prev => new Set(prev).add(url))
  }

  const handleVideoError = (url: string, event: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    console.error('[XFeed] Video failed to load:', url, event)
    // TEMPORARILY disabled hiding broken videos to debug
    // setBrokenVideos(prev => new Set(prev).add(url))
  }

  // Parse thread content
  const hasThread = tweet.content.includes('---THREAD---')
  const [mainContent, threadContent] = hasThread
    ? tweet.content.split('---THREAD---').map(s => s.trim())
    : [tweet.content, null]

  // Extract t.co links for OG previews (max 3 to avoid spam)
  const tcoLinks = extractTcoLinks(mainContent).slice(0, 3)

  return (
    <>
      <div 
        ref={itemRef} 
        className={`border rounded-lg bg-card transition-all p-4 ${
          isNoise ? 'opacity-40' : ''
        } ${
          tweet.pinned ? 'border-l-4 border-l-amber-500' : 'border-border'
        } ${
          focused ? 'ring-2 ring-primary/50' : ''
        }`}
      >
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-foreground">@{tweet.author}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground/60">{relativeTime(tweet.scraped_at || tweet.created_at)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handlePin}
              disabled={updating}
              title={tweet.pinned ? 'Unpin' : 'Pin'}
              className={tweet.pinned ? 'text-amber-400' : 'text-muted-foreground'}
            >
              📌
            </Button>
            {tweet.tweet_link && (
              <a
                href={tweet.tweet_link}
                target="_blank"
                rel="noopener noreferrer"
                title="Open on X"
              >
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
                  ↗️
                </Button>
              </a>
            )}
          </div>
        </div>

        {/* Content */}
        <p className="text-sm text-foreground whitespace-pre-wrap mb-3 leading-relaxed">
          {mainContent}
        </p>

        {/* OG Preview Cards disabled — 429 rate limit spam, needs client-side queue */}
        {/* {tcoLinks.length > 0 && (
          <div className="space-y-2 mb-3">
            {tcoLinks.map((link, idx) => (
              <OGCard key={idx} url={link} />
            ))}
          </div>
        )} */}

        {/* Image grid */}
        {workingImages.length > 0 && (
          <div className={`mb-3 ${
            workingImages.length === 1 ? '' :
            workingImages.length === 2 ? 'grid grid-cols-2 gap-1' :
            'grid grid-cols-2 gap-1'
          }`}>
            {workingImages.map((url, idx) => {
              const proxiedUrl = `/api/media-proxy?url=${encodeURIComponent(url)}`
              return (
                <button
                  key={idx}
                  onClick={() => setLightboxState({ images: workingImages.map(u => `/api/media-proxy?url=${encodeURIComponent(u)}`), index: idx })}
                  className="overflow-hidden rounded-lg"
                >
                  <img
                    src={proxiedUrl}
                    alt={`Tweet media ${idx + 1}`}
                    loading="lazy"
                    onError={() => handleImageError(url)}
                    className={`w-full object-cover cursor-pointer hover:opacity-90 transition-opacity ${
                      workingImages.length === 1 ? 'max-h-[300px]' :
                      'h-[150px]'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        )}

        {/* Videos */}
        {workingVideos.map((video, idx) => {
          const proxiedUrl = `/api/media-proxy?url=${encodeURIComponent(video.url)}`
          const proxiedPoster = video.poster ? `/api/media-proxy?url=${encodeURIComponent(video.poster)}` : undefined
          return (
            <div key={idx} className="mb-3">
              <video
                ref={(el) => {
                  if (!el) return
                  if ((el as any)._observer) return
                  const loadAndPlay = () => {
                    if (!(el as any)._loaded) {
                      ;(el as any)._loaded = true
                      el.src = proxiedUrl
                      el.load()
                    }
                    el.addEventListener('canplay', () => el.play().catch(() => {}), { once: true })
                  }
                  const observer = new IntersectionObserver(
                    ([entry]) => {
                      if (entry.isIntersecting) {
                        if (!el.src) {
                          const delay = (idx % 3) * 800
                          setTimeout(loadAndPlay, delay)
                        } else {
                          el.play().catch(() => {})
                        }
                      } else {
                        el.pause()
                      }
                    },
                    { threshold: 0.3, rootMargin: '100px' }
                  )
                  observer.observe(el)
                  ;(el as any)._observer = observer
                }}
                poster={proxiedPoster}
                controls
                muted
                playsInline
                preload="none"
                onError={(e) => handleVideoError(video.url, e)}
                className="rounded-lg w-full max-h-[400px] object-cover"
              />
            </div>
          )
        })}

        {/* Thread content */}
        {threadContent && (
          <>
            <div className="border-t border-border/30 my-3" />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              <span>🧵</span>
              <span>Thread</span>
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap line-clamp-6 leading-relaxed">
              {threadContent}
            </p>
          </>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1">
            {tweet.theme && <ThemeBadge theme={tweet.theme} />}
          </div>
          <div className="flex items-center gap-0.5">
            <RatingButton rating="fire" current={tweet.rating} onRate={handleRate} />
            <RatingButton rating="meh" current={tweet.rating} onRate={handleRate} />
            <RatingButton rating="noise" current={tweet.rating} onRate={handleRate} />
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxState && (
        <Lightbox
          images={lightboxState.images}
          initialIndex={lightboxState.index}
          onClose={() => setLightboxState(null)}
        />
      )}
    </>
  )
}

// --- Main Panel ---

const PAGE_SIZE = 50

export function XFeedPanel() {
  const [tweets, setTweets] = useState<Tweet[]>([])
  const [total, setTotal] = useState(0)
  const [curatedCount, setCuratedCount] = useState(0)
  const [themes, setThemes] = useState<string[]>([])
  const [digests, setDigests] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Filters
  const [mode, setMode] = useState<'curated' | 'all'>('curated')
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
      if (mode === 'curated') params.set('verdict', 'curated')
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

      // Fetch curated count when in 'all' mode
      if (mode === 'all') {
        const curatedRes = await fetch('/api/xfeed?verdict=curated&limit=0')
        const curatedData = await curatedRes.json()
        setCuratedCount(curatedData.total)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tweets')
    } finally {
      setLoading(false)
    }
  }, [themeFilter, ratingFilter, digestFilter, search, mode])

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
        if (tweet?.tweet_link) {
          window.open(tweet.tweet_link, '_blank', 'noopener,noreferrer')
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setFocusedIndex(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tweets, focusedIndex])

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

  const handleResetFilters = () => {
    setThemeFilter('')
    setRatingFilter('')
    setDigestFilter('')
    setSearch('')
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
              <span className="text-xs text-muted-foreground">
                {mode === 'curated' ? (
                  `${total} curated`
                ) : (
                  `${curatedCount} curated · ${total} total`
                )}
              </span>
            )}
          </div>
        </div>

        {/* Curated/All tabs */}
        <div className="mb-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'curated' | 'all')}>
            <TabsList>
              <TabsTab value="curated">Curated</TabsTab>
              <TabsTab value="all">All</TabsTab>
            </TabsList>
          </Tabs>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <PropertyChip
            value={themeFilter}
            onSelect={setThemeFilter}
            options={themes.map(t => ({ value: t, label: t }))}
            placeholder="All Themes"
          />
          <PropertyChip
            value={ratingFilter}
            onSelect={setRatingFilter}
            options={[
              { value: 'fire', label: '🔥 Fire' },
              { value: 'meh', label: '😐 Meh' },
              { value: 'noise', label: '🗑️ Noise' },
              { value: 'unrated', label: 'Unrated' },
            ]}
            placeholder="All Ratings"
          />
          <PropertyChip
            value={digestFilter}
            onSelect={setDigestFilter}
            options={digests.map(d => ({ value: d, label: d }))}
            placeholder="All Digests"
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
          <div className="text-center py-12">
            {mode === 'curated' ? (
              <>
                <p className="text-muted-foreground text-sm mb-3">
                  Your curated feed is empty
                </p>
                <Button variant="outline" size="sm" onClick={() => setMode('all')}>
                  View all tweets
                </Button>
              </>
            ) : (
              <>
                <p className="text-muted-foreground text-sm mb-3">
                  No tweets match your filters
                </p>
                <Button variant="outline" size="sm" onClick={handleResetFilters}>
                  Reset filters
                </Button>
              </>
            )}
          </div>
        )}

        <div className="space-y-2 max-w-3xl mx-auto">
          {tweets.map((tweet, index) => (
            <TweetCard
              key={tweet.id}
              tweet={tweet}
              onUpdate={handleUpdate}
              focused={focusedIndex === index}
              itemRef={(el: HTMLDivElement | null) => { itemRefs.current[index] = el }}
            />
          ))}
        </div>

        {/* Load more */}
        {hasMore && !loading && (
          <div className="flex justify-center py-6">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
            >
              Load more ({tweets.length} of {total})
            </Button>
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
