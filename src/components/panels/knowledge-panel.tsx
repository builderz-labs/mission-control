'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */
interface KnowledgeDoc {
  id: number
  filename: string
  content_type: string
  domain: string
  tags: string
  summary: string | null
  file_size: number | null
  created_at: string
}

type ViewMode = 'grid' | 'list'
type SortField = 'created_at' | 'filename' | 'domain' | 'file_size'

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */
function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (['py'].includes(ext)) return 'hsl(var(--success))'
  if (['js', 'ts', 'tsx', 'jsx'].includes(ext)) return 'hsl(var(--void-amber))'
  if (['pdf'].includes(ext)) return 'hsl(var(--destructive))'
  if (['json', 'yaml', 'yml', 'xml'].includes(ext)) return 'hsl(var(--void-cyan))'
  if (['md', 'txt'].includes(ext)) return 'hsl(var(--void-violet))'
  return 'hsl(var(--info))'
}

/* ═══════════════════════════════════════════════════════════════════
   INLINE SVG ICONS
   ═══════════════════════════════════════════════════════════════════ */
function IconUpload({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  )
}
function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  )
}
function IconFile({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  )
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}
function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  )
}
function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  )
}
function IconDatabase({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />
    </svg>
  )
}
function IconBrain({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}
function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   STAT CARD
   ═══════════════════════════════════════════════════════════════════ */
function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
      <div
        className="p-2.5 rounded-lg border"
        style={{
          background: `color-mix(in srgb, ${color} 10%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 20%, transparent)`,
          color,
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-lg font-semibold text-foreground">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export function KnowledgePanel() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterDomain, setFilterDomain] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDocs = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/knowledge', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('Failed to load knowledge base')
      const data = await res.json()
      setDocs(Array.isArray(data) ? data : data.documents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    try {
      const formData = new FormData()
      Array.from(files).forEach(f => formData.append('files', f))
      const res = await fetch('/api/knowledge/upload', { method: 'POST', body: formData, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('Upload failed')
      await fetchDocs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [fetchDocs])

  const handleDelete = useCallback(async (id: number) => {
    try {
      await fetch(`/api/knowledge/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
      setDocs(prev => prev.filter(d => d.id !== id))
    } catch {}
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setDragOver(false), [])
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (!files.length) return
    setUploading(true)
    try {
      const formData = new FormData()
      Array.from(files).forEach(f => formData.append('files', f))
      const res = await fetch('/api/knowledge/upload', { method: 'POST', body: formData, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('Upload failed')
      await fetchDocs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [fetchDocs])

  // Derived data
  const domains = useMemo(() => {
    const map = new Map<string, number>()
    docs.forEach(d => map.set(d.domain, (map.get(d.domain) || 0) + 1))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [docs])

  const totalSize = useMemo(() => docs.reduce((sum, d) => sum + (d.file_size || 0), 0), [docs])

  const filtered = useMemo(() => {
    let result = docs
    if (filterDomain) result = result.filter(d => d.domain === filterDomain)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(d => d.filename.toLowerCase().includes(q) || d.domain.toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      if (sortField === 'filename') return a.filename.localeCompare(b.filename)
      if (sortField === 'domain') return a.domain.localeCompare(b.domain)
      if (sortField === 'file_size') return (b.file_size || 0) - (a.file_size || 0)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    return result
  }, [docs, filterDomain, search, sortField])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <IconLoader className="w-6 h-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-[hsl(var(--void-cyan))] bg-card p-12 text-center">
            <IconUpload className="mx-auto w-10 h-10 text-[hsl(var(--void-cyan))] mb-3" />
            <div className="text-lg font-medium text-foreground">Drop files to upload</div>
            <div className="text-sm text-muted-foreground mt-1">Documents will be indexed into the knowledge base</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2.5">
              <IconBrain className="text-[hsl(var(--void-violet))]" />
              Knowledge Base
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Neural document repository — indexed for semantic retrieval by Jarvis
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".txt,.md,.json,.csv,.pdf,.py,.js,.ts,.tsx,.html,.xml,.yaml,.yml,.log,.sql,.sh,.css"
              onChange={handleFileSelected}
            />
            <Button variant="ghost" size="icon" onClick={() => fetchDocs()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
              </svg>
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? <IconLoader /> : <IconUpload />}
              {uploading ? 'Indexing...' : 'Upload Document'}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="hover:text-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<IconDatabase />} label="Documents" value={docs.length.toLocaleString()} sub={`${domains.length} domain${domains.length !== 1 ? 's' : ''}`} color="hsl(var(--info))" />
          <StatCard icon={<IconFile />} label="Total Size" value={formatBytes(totalSize)} sub="Indexed corpus" color="hsl(var(--void-violet))" />
          <StatCard icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} label="Latest" value={docs.length > 0 ? new Date(docs[0].created_at).toLocaleDateString() : '—'} sub={docs.length > 0 ? new Date(docs[0].created_at).toLocaleTimeString() : 'No documents'} color="hsl(var(--success))" />
          <StatCard icon={<IconBrain />} label="Content Types" value={new Set(docs.map(d => d.content_type)).size.toString()} sub="File formats indexed" color="hsl(var(--void-amber))" />
        </div>

        {/* Domain filter pills */}
        {domains.length > 0 && (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">Domains</span>
            <button
              onClick={() => setFilterDomain(null)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium border transition-all',
                !filterDomain
                  ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              All ({docs.length})
            </button>
            {domains.map(([domain, count]) => (
              <button
                key={domain}
                onClick={() => setFilterDomain(filterDomain === domain ? null : domain)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium border transition-all',
                  filterDomain === domain
                    ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {domain} ({count})
              </button>
            ))}
          </div>
        )}

        {/* Search + view toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search documents..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30 placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={cn('p-2 transition-colors', viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <IconGrid />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn('p-2 transition-colors', viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <IconList />
            </button>
          </div>
        </div>

        {/* Document list/grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <IconFile className="text-muted-foreground w-6 h-6" />
            </div>
            <h3 className="text-base font-medium text-foreground mb-1">
              {docs.length === 0 ? 'No documents yet' : 'No matching documents'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {docs.length === 0
                ? 'Upload documents to build your knowledge base. Drag and drop files or click Upload.'
                : 'Try adjusting your search or filters.'}
            </p>
            {docs.length === 0 && (
              <Button variant="outline" size="sm" className="mt-4" onClick={handleUpload}>
                <IconUpload /> Upload Document
              </Button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(doc => (
              <div
                key={doc.id}
                className="group rounded-xl border border-border bg-card p-4 hover:border-[hsl(var(--void-cyan))]/20 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${getFileColor(doc.filename)} 10%, transparent)`, color: getFileColor(doc.filename) }}>
                    <IconFile />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{doc.filename}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{doc.domain} &middot; {formatBytes(doc.file_size)}</div>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                  >
                    <IconTrash />
                  </button>
                </div>
                {doc.summary && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{doc.summary}</p>
                )}
                <div className="text-[10px] text-muted-foreground/60 mt-2">
                  {new Date(doc.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map(doc => (
              <div
                key={doc.id}
                className="group flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ color: getFileColor(doc.filename) }}>
                  <IconFile />
                </div>
                <div className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{doc.filename}</div>
                <span className="text-xs text-muted-foreground shrink-0">{doc.domain}</span>
                <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">{formatBytes(doc.file_size)}</span>
                <span className="text-xs text-muted-foreground shrink-0 w-20 text-right">{new Date(doc.created_at).toLocaleDateString()}</span>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
