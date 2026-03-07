'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Badge } from '@/components/ui/badge'

// --- Types ---

interface GardenItem {
  id: string
  content: string
  type: string
  interest: string
  temporal: string
  tags: string
  note: string
  original_source: string | null
  media_urls: string
  metadata: string
  enriched: number
  instance_type: string
  snooze_until: string | null
  expires_at: string | null
  created_at: string
  saved_at: string
}

interface GardenStats {
  byInterest: Record<string, number>
  byType: Record<string, number>
  total: number
}

// --- i5 classification colors & icons ---

const INTEREST_COLORS: Record<string, string> = {
  information: 'bg-blue-500/20 text-blue-400',
  inspiration: 'bg-purple-500/20 text-purple-400',
  instrument: 'bg-green-500/20 text-green-400',
  ingredient: 'bg-orange-500/20 text-orange-400',
  idea: 'bg-yellow-500/20 text-yellow-400',
}

const INTEREST_ICONS: Record<string, string> = {
  information: '\u{1f52c}',
  inspiration: '\u{2728}',
  instrument: '\u{1f527}',
  ingredient: '\u{1f9f1}',
  idea: '\u{1f4a1}',
}

const TYPE_OPTIONS = ['tweet', 'link', 'article', 'repo', 'note', 'image', 'video', 'pdf']
const INTEREST_OPTIONS = ['information', 'inspiration', 'instrument', 'ingredient', 'idea']
const TEMPORAL_OPTIONS = ['now', 'soon', 'later', 'ever']

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

function parseTags(raw: string): string[] {
  try { return JSON.parse(raw) } catch { return [] }
}

function parseMediaUrls(raw: string): string[] {
  try { return JSON.parse(raw) } catch { return [] }
}

// --- Sub-components ---

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

function InterestBadge({ interest }: { interest: string }) {
  const icon = INTEREST_ICONS[interest] || ''

  // Map interest colors to Badge variants
  const variantMap: Record<string, 'info' | 'success' | 'warning' | 'secondary'> = {
    information: 'info',
    inspiration: 'secondary',
    instrument: 'success',
    ingredient: 'warning',
    idea: 'warning',
  }

  const variant = variantMap[interest] || 'secondary'

  return (
    <Badge variant={variant} size="sm">
      {icon} {interest}
    </Badge>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="secondary" size="sm">
      {type}
    </Badge>
  )
}

// --- Card View ---

function GardenCard({ item, onClick, focused, itemRef }: { item: GardenItem; onClick: () => void; focused?: boolean; itemRef?: (el: HTMLButtonElement | null) => void }) {
  const tags = parseTags(item.tags)
  const mediaUrls = parseMediaUrls(item.media_urls)

  return (
    <button
      ref={itemRef}
      onClick={onClick}
      className={`w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors space-y-2.5 ${focused ? 'ring-2 ring-primary/50' : ''}`}
    >
      {mediaUrls.length > 0 && (
        <img
          src={mediaUrls[0]}
          alt=""
          className="w-full h-24 rounded object-cover border border-border"
          loading="lazy"
        />
      )}

      <p className="text-sm text-foreground leading-relaxed line-clamp-3">{item.content}</p>

      <div className="flex items-center gap-1.5 flex-wrap">
        <TypeBadge type={item.type} />
        <InterestBadge interest={item.interest} />
        {item.enriched ? (
          <span className="text-green-400 text-[10px]">{'\u2713'}</span>
        ) : (
          <span className="text-muted-foreground/30 text-[10px]">{'\u25CB'}</span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
              {t}
            </span>
          ))}
        </div>
      )}

      {item.original_source && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
          {'\u2197\uFE0F'} {item.original_source}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        {relativeTime(item.saved_at)}
      </p>
    </button>
  )
}

// --- List View ---

function GardenListRow({ item, onClick, focused, itemRef }: { item: GardenItem; onClick: () => void; focused?: boolean; itemRef?: (el: HTMLButtonElement | null) => void }) {
  return (
    <button
      ref={itemRef}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-lg hover:border-primary/30 transition-colors w-full text-left ${focused ? 'ring-2 ring-primary/50' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{item.content}</p>
      </div>
      <TypeBadge type={item.type} />
      <InterestBadge interest={item.interest} />
      {item.original_source && (
        <span className="text-muted-foreground text-xs shrink-0">{'\u2197\uFE0F'}</span>
      )}
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {relativeTime(item.saved_at)}
      </span>
    </button>
  )
}

// --- Detail Sheet ---

function DetailSheet({
  item,
  onClose,
  onUpdate,
  onDelete,
}: {
  item: GardenItem
  onClose: () => void
  onUpdate: () => void
  onDelete: () => void
}) {
  const [content, setContent] = useState(item.content)
  const [itemType, setItemType] = useState(item.type)
  const [interest, setInterest] = useState(item.interest)
  const [temporal, setTemporal] = useState(item.temporal)
  const [note, setNote] = useState(item.note || '')
  const [sourceUrl, setSourceUrl] = useState(item.original_source || '')
  const [tags, setTags] = useState<string[]>(() => parseTags(item.tags))
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const mediaUrls = parseMediaUrls(item.media_urls)
  let metadata: Record<string, unknown> = {}
  try { metadata = JSON.parse(item.metadata) } catch {}

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`/api/garden/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          type: itemType,
          interest,
          temporal,
          note,
          original_source: sourceUrl || null,
          tags: JSON.stringify(tags),
        }),
      })
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await fetch(`/api/garden/${item.id}`, { method: 'DELETE' })
      onDelete()
    } catch {
      setDeleting(false)
    }
  }

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault()
      const t = tagInput.trim().toLowerCase()
      if (!tags.includes(t)) setTags([...tags, t])
      setTagInput('')
    }
  }

  return (
    <div className="w-[420px] border-l border-border bg-card h-full overflow-y-auto shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
        <span className="text-xs text-muted-foreground font-mono">{item.id.slice(0, 8)}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close detail sheet">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Content */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full text-sm bg-secondary border border-border rounded px-2 py-1.5 text-foreground resize-y"
          />
        </div>

        {/* Type + Interest + Temporal grid */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Type</label>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value)}
              className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Interest</label>
            <select
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground"
            >
              {INTEREST_OPTIONS.map((i) => (
                <option key={i} value={i}>{INTEREST_ICONS[i]} {i}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Temporal</label>
            <select
              value={temporal}
              onChange={(e) => setTemporal(e.target.value)}
              className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground"
            >
              {TEMPORAL_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Tags</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {tags.map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-secondary border border-border text-foreground flex items-center gap-1">
                {t}
                <button onClick={() => setTags(tags.filter((x) => x !== t))} className="text-muted-foreground hover:text-red-400" aria-label={`Remove tag ${t}`}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder="Type + Enter"
            className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground"
          />
        </div>

        {/* Note */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground resize-y"
          />
        </div>

        {/* Source URL */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Source URL</label>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground"
          />
        </div>

        {/* Media gallery */}
        {mediaUrls.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Media</label>
            <div className="flex gap-2 flex-wrap">
              {mediaUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                  <img src={url} alt="" className="h-16 w-auto rounded border border-border object-cover hover:border-primary/50 transition-colors" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        {Object.keys(metadata).length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Metadata</label>
            <pre className="text-[10px] bg-secondary border border-border rounded p-2 text-muted-foreground overflow-x-auto">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </div>
        )}

        {/* Save + Delete */}
        <div className="flex gap-2 pt-2 border-t border-border">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-xs py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
            aria-label="Delete item"
          >
            {'\uD83D\uDDD1\uFE0F'}
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Main Panel ---

export function GardenPanel() {
  const [items, setItems] = useState<GardenItem[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<GardenStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<GardenItem | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Filters
  const [typeFilter, setTypeFilter] = useState('')
  const [interestFilter, setInterestFilter] = useState('')
  const [search, setSearch] = useState('')
  const searchTimeoutRef = useRef<NodeJS.Timeout>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (typeFilter) params.set('type', typeFilter)
      if (interestFilter) params.set('interest', interestFilter)
      if (search) params.set('search', search)
      params.set('limit', '200')

      const res = await fetch(`/api/garden?${params}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setItems(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load garden')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, interestFilter, search])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/garden/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchItems()
    fetchStats()
  }, [fetchItems, fetchStats])

  // Reset focused index when items change (new filter/search)
  useEffect(() => {
    setFocusedIndex(null)
  }, [items])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex !== null && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire when detail sheet is open
      if (selectedItem) return

      // Don't fire when input/textarea/contenteditable is focused
      const active = document.activeElement
      if (active) {
        const tag = active.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return
        if ((active as HTMLElement).isContentEditable) return
      }

      const len = items.length
      if (len === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          if (prev === null) return 0
          return Math.min(prev + 1, len - 1)
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          if (prev === null) return 0
          return Math.max(prev - 1, 0)
        })
      } else if (e.key === 'Enter' && focusedIndex !== null) {
        e.preventDefault()
        const item = items[focusedIndex]
        if (item) setSelectedItem(item)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setFocusedIndex(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, selectedItem, focusedIndex])

  const handleSearchInput = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearch(value), 300)
  }

  const handleUpdate = () => {
    fetchItems()
    fetchStats()
  }

  const handleDelete = () => {
    setSelectedItem(null)
    fetchItems()
    fetchStats()
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-1.5">
                {'\uD83C\uDF31'} Garden
              </h2>
              {total > 0 && (
                <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {total}
                </span>
              )}

              {/* Stats pills */}
              {stats && (
                <div className="flex gap-1.5">
                  {Object.entries(stats.byInterest).map(([key, count]) => (
                    <button
                      key={key}
                      onClick={() => setInterestFilter(interestFilter === key ? '' : key)}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
                        interestFilter === key
                          ? INTEREST_COLORS[key] + ' ring-1 ring-current'
                          : INTEREST_COLORS[key] || 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      {INTEREST_ICONS[key]} {count}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* View toggle */}
            <div className="flex gap-0.5 bg-secondary border border-border rounded p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1 rounded transition-colors ${viewMode === 'grid' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                aria-label="Grid view"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                  <rect x="1" y="1" width="6" height="6" rx="1" />
                  <rect x="9" y="1" width="6" height="6" rx="1" />
                  <rect x="1" y="9" width="6" height="6" rx="1" />
                  <rect x="9" y="9" width="6" height="6" rx="1" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded transition-colors ${viewMode === 'list' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                aria-label="List view"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                  <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect
              value={interestFilter}
              onChange={setInterestFilter}
              placeholder="All Interests"
              options={INTEREST_OPTIONS.map((i) => ({
                value: i,
                label: `${INTEREST_ICONS[i]} ${i}`,
              }))}
            />
            <FilterSelect
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder="All Types"
              options={TYPE_OPTIONS.map((t) => ({ value: t, label: t }))}
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
              Failed to load garden: {error}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="text-muted-foreground text-sm text-center py-12">
              Your garden is empty. Save items from X Feed to get started.
            </div>
          )}

          {!loading && items.length > 0 && viewMode === 'grid' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item, i) => (
                <GardenCard
                  key={item.id}
                  item={item}
                  onClick={() => setSelectedItem(item)}
                  focused={focusedIndex === i}
                  itemRef={(el) => { itemRefs.current[i] = el }}
                />
              ))}
            </div>
          )}

          {!loading && items.length > 0 && viewMode === 'list' && (
            <div className="space-y-1.5 max-w-4xl">
              {items.map((item, i) => (
                <GardenListRow
                  key={item.id}
                  item={item}
                  onClick={() => setSelectedItem(item)}
                  focused={focusedIndex === i}
                  itemRef={(el) => { itemRefs.current[i] = el }}
                />
              ))}
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

      {/* Detail sheet */}
      {selectedItem && (
        <DetailSheet
          key={selectedItem.id}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
