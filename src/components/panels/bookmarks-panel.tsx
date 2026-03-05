'use client'

import { useState, useEffect, useCallback } from 'react'

interface Bookmark {
  id: number
  date: string
  time: string
  type: string
  url: string
  title: string
  summary: string
  tags: string[]
  action?: string
}

export function BookmarksPanel() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [total, setTotal] = useState(0)

  // Add bookmark form
  const [showAdd, setShowAdd] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState('link')
  const [newSummary, setNewSummary] = useState('')
  const [newTags, setNewTags] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchBookmarks = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (typeFilter) params.set('type', typeFilter)
      if (tagFilter) params.set('tag', tagFilter)

      const res = await fetch(`/api/bookmarks?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setBookmarks(data.bookmarks || [])
      setTotal(data.total || 0)
      setTypes(data.types || [])
      setAllTags(data.allTags || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, tagFilter])

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => fetchBookmarks(), 300)
    return () => clearTimeout(timer)
  }, [fetchBookmarks])

  const handleAdd = async () => {
    if (!newUrl || !newTitle) return
    setSaving(true)
    try {
      const tags = newTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const res = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newUrl,
          title: newTitle,
          type: newType,
          summary: newSummary,
          tags,
        }),
      })
      if (res.ok) {
        setNewUrl('')
        setNewTitle('')
        setNewType('link')
        setNewSummary('')
        setNewTags('')
        setShowAdd(false)
        fetchBookmarks()
      }
    } finally {
      setSaving(false)
    }
  }

  const typeColors: Record<string, string> = {
    tweet: 'bg-sky-500/15 text-sky-400',
    article: 'bg-emerald-500/15 text-emerald-400',
    video: 'bg-red-500/15 text-red-400',
    tool: 'bg-purple-500/15 text-purple-400',
    repo: 'bg-orange-500/15 text-orange-400',
    post: 'bg-blue-500/15 text-blue-400',
    link: 'bg-gray-500/15 text-gray-400',
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Bookmarks</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} saved link{total !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="url"
              placeholder="URL *"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="text"
              placeholder="Title *"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="link">link</option>
              <option value="tweet">tweet</option>
              <option value="article">article</option>
              <option value="video">video</option>
              <option value="tool">tool</option>
              <option value="repo">repo</option>
              <option value="post">post</option>
            </select>
            <input
              type="text"
              placeholder="Tags (comma-separated)"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <textarea
            placeholder="Summary"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newUrl || !newTitle}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Bookmark'}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search bookmarks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
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
        {(search || typeFilter || tagFilter) && (
          <button
            onClick={() => {
              setSearch('')
              setTypeFilter('')
              setTagFilter('')
            }}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Bookmarks list */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading bookmarks...</div>
      ) : bookmarks.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {search || typeFilter || tagFilter ? 'No bookmarks match your filters.' : 'No bookmarks yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {bookmarks.map((b) => (
            <div key={`${b.date}-${b.id}`} className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`px-2 py-0.5 text-2xs font-medium rounded-full ${typeColors[b.type] || typeColors.link}`}
                    >
                      {b.type}
                    </span>
                    <span className="text-2xs text-muted-foreground">
                      {b.date}
                      {b.time ? ` ${b.time}` : ''}
                    </span>
                  </div>
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {b.title}
                  </a>
                  {b.summary && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{b.summary}</p>
                  )}
                  {b.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {b.tags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setTagFilter(tag)}
                          className="px-1.5 py-0.5 text-2xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 transition-colors"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                  {b.action && (
                    <p className="text-2xs text-muted-foreground/70 mt-1 italic">{b.action}</p>
                  )}
                </div>
                <a
                  href={b.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Open link"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M6 3H3v10h10v-3" />
                    <path d="M9 2h5v5" />
                    <path d="M14 2L7 9" />
                  </svg>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
