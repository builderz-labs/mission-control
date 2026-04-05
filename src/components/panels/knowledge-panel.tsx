'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { type KnowledgeDoc, type ViewMode, type SortField } from './knowledge/types'
import { formatBytes } from './knowledge/helpers'
import { IconDatabase, IconFile, IconBrain, IconLoader } from './knowledge/icons'
import { StatCard } from './knowledge/stat-card'
import { DocGrid } from './knowledge/doc-grid'
import { DocList } from './knowledge/doc-list'
import { PanelHeader } from './knowledge/panel-header'

export function KnowledgePanel(): React.JSX.Element {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterDomain, setFilterDomain] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const fetchDocs = useCallback(async (): Promise<void> => {
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

  const handleUpload = useCallback((): void => { fileInputRef.current?.click() }, [])

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
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

  const handleDelete = useCallback(async (id: number): Promise<void> => {
    try {
      await fetch(`/api/knowledge/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
      setDocs(prev => prev.filter(d => d.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent): void => { e.preventDefault(); setDragOver(true) }, [])
  const handleDragLeave = useCallback((): void => { setDragOver(false) }, [])
  const handleDrop = useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault(); setDragOver(false)
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

  const domains = useMemo((): [string, number][] => {
    const map = new Map<string, number>()
    docs.forEach(d => map.set(d.domain, (map.get(d.domain) || 0) + 1))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [docs])

  const totalSize = useMemo((): number => docs.reduce((sum, d) => sum + (d.file_size || 0), 0), [docs])

  const filtered = useMemo((): KnowledgeDoc[] => {
    let result = docs
    if (filterDomain) result = result.filter(d => d.domain === filterDomain)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(d => d.filename.toLowerCase().includes(q) || d.domain.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      if (sortField === 'filename') return a.filename.localeCompare(b.filename)
      if (sortField === 'domain') return a.domain.localeCompare(b.domain)
      if (sortField === 'file_size') return (b.file_size || 0) - (a.file_size || 0)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [docs, filterDomain, search, sortField])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <IconLoader className="w-6 h-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-[hsl(var(--void-cyan))] bg-card p-12 text-center">
            <div className="text-lg font-medium text-foreground">Drop files to upload</div>
            <div className="text-sm text-muted-foreground mt-1">Documents will be indexed into the knowledge base</div>
          </div>
        </div>
      )}

      <PanelHeader
        uploading={uploading} search={search} viewMode={viewMode} sortField={sortField}
        onRefresh={fetchDocs} onUpload={handleUpload}
        onSearchChange={setSearch} onViewModeChange={setViewMode} onSortChange={setSortField}
        fileInputRef={fileInputRef} onFileSelected={handleFileSelected}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="hover:text-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<IconDatabase />} label="Documents" value={docs.length.toLocaleString()} sub={`${domains.length} domain${domains.length !== 1 ? 's' : ''}`} color="hsl(var(--info))" />
          <StatCard icon={<IconFile />} label="Total Size" value={formatBytes(totalSize)} sub="Indexed corpus" color="hsl(var(--void-violet))" />
          <StatCard
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            label="Latest"
            value={docs.length > 0 ? new Date(docs[0].created_at).toLocaleDateString() : '—'}
            sub={docs.length > 0 ? new Date(docs[0].created_at).toLocaleTimeString() : 'No documents'}
            color="hsl(var(--success))"
          />
          <StatCard icon={<IconBrain />} label="Content Types" value={new Set(docs.map(d => d.content_type)).size.toString()} sub="File formats indexed" color="hsl(var(--void-amber))" />
        </div>

        {domains.length > 0 && (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">Domains</span>
            <button onClick={() => setFilterDomain(null)} className={cn('px-2.5 py-1 rounded-md text-xs font-medium border transition-all', !filterDomain ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
              All ({docs.length})
            </button>
            {domains.map(([domain, count]) => (
              <button key={domain} onClick={() => setFilterDomain(filterDomain === domain ? null : domain)} className={cn('px-2.5 py-1 rounded-md text-xs font-medium border transition-all', filterDomain === domain ? 'border-[hsl(var(--void-cyan))] bg-[hsl(var(--void-cyan))]/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
                {domain} ({count})
              </button>
            ))}
          </div>
        )}

        {viewMode === 'grid' ? (
          <DocGrid docs={docs} filtered={filtered} onDelete={handleDelete} onUpload={handleUpload} />
        ) : (
          <DocList filtered={filtered} onDelete={handleDelete} />
        )}
      </div>
    </div>
  )
}
