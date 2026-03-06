'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface DocsTreeNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: DocsTreeNode[]
}

interface DocsTreeResponse {
  roots: string[]
  tree: DocsTreeNode[]
  error?: string
}

interface DocsContentResponse {
  path: string
  content: string
  size: number
  modified: number
  error?: string
}

interface DocsSearchResult {
  path: string
  name: string
  matches: number
}

interface DocsSearchResponse {
  results: DocsSearchResult[]
  error?: string
}

function collectFilePaths(nodes: DocsTreeNode[]): string[] {
  const filePaths: string[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      filePaths.push(node.path)
      continue
    }
    if (node.children && node.children.length > 0) {
      filePaths.push(...collectFilePaths(node.children))
    }
  }
  return filePaths
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString()
}

export function DocumentsPanel() {
  const [tree, setTree] = useState<DocsTreeNode[]>([])
  const [roots, setRoots] = useState<string[]>([])
  const [loadingTree, setLoadingTree] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [docContent, setDocContent] = useState<string>('')
  const [docMeta, setDocMeta] = useState<{ size: number; modified: number } | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DocsSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const loadTree = useCallback(async () => {
    setLoadingTree(true)
    setTreeError(null)
    try {
      const res = await fetch('/api/docs/tree')
      const data = (await res.json()) as DocsTreeResponse
      if (!res.ok) throw new Error(data.error || 'Failed to load documents')

      setTree(data.tree || [])
      setRoots(data.roots || [])
      const defaultExpanded = new Set<string>((data.roots || []).filter(Boolean))
      setExpandedDirs(defaultExpanded)
    } catch (error) {
      setTree([])
      setRoots([])
      setTreeError((error as Error).message || 'Failed to load documents')
    } finally {
      setLoadingTree(false)
    }
  }, [])

  const loadDoc = useCallback(async (path: string) => {
    setLoadingDoc(true)
    setDocError(null)
    setSelectedPath(path)
    try {
      const res = await fetch(`/api/docs/content?path=${encodeURIComponent(path)}`)
      const data = (await res.json()) as DocsContentResponse
      if (!res.ok) throw new Error(data.error || 'Failed to load document')
      setDocContent(data.content || '')
      setDocMeta({ size: data.size, modified: data.modified })
    } catch (error) {
      setDocContent('')
      setDocMeta(null)
      setDocError((error as Error).message || 'Failed to load document')
    } finally {
      setLoadingDoc(false)
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  const filePaths = useMemo(() => collectFilePaths(tree), [tree])

  useEffect(() => {
    if (selectedPath) return
    if (filePaths.length === 0) return
    void loadDoc(filePaths[0])
  }, [filePaths, loadDoc, selectedPath])

  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setSearchResults([])
      setSearchError(null)
      setSearching(false)
      return
    }

    const handle = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const res = await fetch(`/api/docs/search?q=${encodeURIComponent(query)}&limit=100`)
        const data = (await res.json()) as DocsSearchResponse
        if (!res.ok) throw new Error(data.error || 'Failed to search docs')
        setSearchResults(data.results || [])
      } catch (error) {
        setSearchResults([])
        setSearchError((error as Error).message || 'Failed to search docs')
      } finally {
        setSearching(false)
      }
    }, 250)

    return () => clearTimeout(handle)
  }, [searchQuery])

  const isShowingSearch = searchQuery.trim().length >= 2

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNode = (node: DocsTreeNode, depth = 0) => {
    if (node.type === 'directory') {
      const isOpen = expandedDirs.has(node.path)
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleDir(node.path)}
            className="w-full flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-secondary text-left"
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <span className="text-xs text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
            <span className="text-sm text-foreground">{node.name}</span>
          </button>
          {isOpen && node.children && (
            <div>
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      )
    }

    const active = selectedPath === node.path
    return (
      <button
        key={node.path}
        onClick={() => void loadDoc(node.path)}
        className={`w-full text-left py-1.5 px-2 rounded-md text-sm ${
          active ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-secondary'
        }`}
        style={{ paddingLeft: `${depth * 16 + 26}px` }}
      >
        {node.name}
      </button>
    )
  }

  return (
    <div className="h-full p-4 md:p-6">
      <div className="h-full min-h-[600px] rounded-xl border border-border bg-card overflow-hidden grid grid-cols-1 lg:grid-cols-[340px_1fr]">
        <aside className="border-r border-border p-4 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Documents</h2>
            <button
              onClick={() => void loadTree()}
              className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-1">
            <label htmlFor="docs-search" className="text-xs text-muted-foreground">Search docs</label>
            <input
              id="docs-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Type at least 2 characters..."
              className="w-full h-9 px-3 rounded-md bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {roots.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Roots: {roots.join(', ')}
            </div>
          )}

          {loadingTree && (
            <div className="text-sm text-muted-foreground">Loading documents...</div>
          )}

          {treeError && (
            <div className="text-sm text-red-400">{treeError}</div>
          )}

          {!loadingTree && !treeError && isShowingSearch && (
            <div className="space-y-1">
              {searching && <div className="text-sm text-muted-foreground">Searching...</div>}
              {searchError && <div className="text-sm text-red-400">{searchError}</div>}
              {!searching && !searchError && searchResults.length === 0 && (
                <div className="text-sm text-muted-foreground">No matches.</div>
              )}
              {!searching && !searchError && searchResults.map((result) => (
                <button
                  key={result.path}
                  onClick={() => void loadDoc(result.path)}
                  className={`w-full text-left p-2 rounded-md border ${
                    selectedPath === result.path
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-border hover:bg-secondary'
                  }`}
                >
                  <div className="text-sm text-foreground truncate">{result.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{result.path}</div>
                  <div className="text-2xs text-muted-foreground mt-0.5">{result.matches} matches</div>
                </button>
              ))}
            </div>
          )}

          {!loadingTree && !treeError && !isShowingSearch && (
            <div className="space-y-1">
              {tree.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No supported docs roots found. Add one of: <code className="font-mono">docs</code>, <code className="font-mono">knowledge-base</code>, <code className="font-mono">knowledge</code>, <code className="font-mono">memory</code>.
                </div>
              )}
              {tree.map((node) => renderNode(node))}
            </div>
          )}
        </aside>

        <section className="p-4 md:p-6 overflow-y-auto">
          <div className="mb-4">
            <h3 className="text-base md:text-lg font-semibold text-foreground">Document Viewer</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Browse and inspect workspace docs from allowed roots.
            </p>
          </div>

          {!selectedPath && (
            <div className="text-sm text-muted-foreground">Select a file to view its contents.</div>
          )}

          {selectedPath && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div className="text-sm text-foreground font-medium break-all">{selectedPath}</div>
                {docMeta && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(docMeta.size)} • Updated {formatTime(docMeta.modified)}
                  </div>
                )}
              </div>

              {loadingDoc && <div className="text-sm text-muted-foreground">Loading document...</div>}
              {docError && <div className="text-sm text-red-400">{docError}</div>}

              {!loadingDoc && !docError && (
                <div className="rounded-md border border-border bg-background p-4">
                  <MarkdownRenderer content={docContent} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
