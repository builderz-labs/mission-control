'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface DocsTreeNode {
  path: string
  name: string
  type: 'file' | 'directory'
  modified?: number
  children?: DocsTreeNode[]
}

interface DocsTreeResponse {
  roots: string[]
  tree: DocsTreeNode[]
}

interface SearchResult {
  path: string
  name: string
  matches: number
}

// Flatten the tree into ordered groups (folder label -> files) for a simple sidebar.
function flatten(nodes: DocsTreeNode[], groupLabel = ''): { group: string; files: DocsTreeNode[] }[] {
  const groups: { group: string; files: DocsTreeNode[] }[] = []
  const rootFiles: DocsTreeNode[] = []

  for (const node of nodes) {
    if (node.type === 'file') {
      rootFiles.push(node)
    } else if (node.type === 'directory' && node.children) {
      groups.push(...flatten(node.children, node.name))
    }
  }
  if (rootFiles.length) groups.unshift({ group: groupLabel, files: rootFiles })
  return groups
}

function prettyName(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .replace(/^\d+[-_]/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const FOLDER_ICONS: Record<string, string> = {
  '': '📌',
  entities: '🏢',
  boom: '🛎️',
  orchestration: '🧭',
}

export function PlaybooksPanel() {
  const [tree, setTree] = useState<DocsTreeResponse | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)

  // Load the tree once.
  useEffect(() => {
    let active = true
    apiFetch<DocsTreeResponse>('/api/docs/tree')
      .then((data) => {
        if (!active) return
        setTree(data)
        // Default to the START-HERE file, else the first file found.
        const groups = flatten(data.tree)
        const allFiles = groups.flatMap((g) => g.files)
        const start = allFiles.find((f) => /start-here/i.test(f.name)) || allFiles[0]
        if (start) setSelected(start.path)
        setLoading(false)
      })
      .catch((e) => {
        if (!active) return
        setError(e?.message || 'Failed to load knowledge base')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Load content when selection changes.
  useEffect(() => {
    if (!selected) return
    let active = true
    setContentLoading(true)
    apiFetch<{ content: string }>(`/api/docs/content?path=${encodeURIComponent(selected)}`)
      .then((data) => {
        if (!active) return
        setContent(data.content || '')
        setContentLoading(false)
      })
      .catch((e) => {
        if (!active) return
        setContent(`Failed to load: ${e?.message || 'unknown error'}`)
        setContentLoading(false)
      })
    return () => {
      active = false
    }
  }, [selected])

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null)
      return
    }
    try {
      const data = await apiFetch<{ results: SearchResult[] }>(`/api/docs/search?q=${encodeURIComponent(q)}`)
      setResults(data.results || [])
    } catch {
      setResults([])
    }
  }, [])

  const groups = useMemo(() => (tree ? flatten(tree.tree) : []), [tree])

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading playbooks…</div>
  }

  if (error || !tree || tree.roots.length === 0) {
    return (
      <div className="p-6 max-w-lg">
        <h2 className="text-lg font-semibold mb-2">Playbooks</h2>
        <p className="text-sm text-muted-foreground">
          No knowledge base found. Add markdown files under a <code className="bg-surface-2 px-1 rounded">knowledge-base/</code>{' '}
          folder in the agent memory directory and they will appear here.
        </p>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border overflow-y-auto p-3">
        <div className="px-1 pb-3">
          <h2 className="text-sm font-semibold">📚 Playbooks</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Entities · BOOM · Orchestration rules</p>
        </div>

        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            runSearch(e.target.value)
          }}
          placeholder="Search…"
          className="w-full h-8 px-2 mb-3 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
        />

        {results ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground px-1 mb-1">
              {results.length} result{results.length === 1 ? '' : 's'}
            </div>
            {results.map((r) => (
              <button
                key={r.path}
                onClick={() => {
                  setSelected(r.path)
                  setResults(null)
                  setQuery('')
                }}
                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-surface-2 truncate"
              >
                {prettyName(r.name)} <span className="text-muted-foreground">· {r.matches}</span>
              </button>
            ))}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.group || 'root'} className="mb-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground px-1 mb-1">
                {FOLDER_ICONS[g.group] || '📁'} {g.group ? prettyName(g.group) : 'Overview'}
              </div>
              {g.files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setSelected(f.path)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                    selected === f.path ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-surface-2'
                  }`}
                >
                  {prettyName(f.name)}
                </button>
              ))}
            </div>
          ))
        )}
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 overflow-y-auto p-6">
        {contentLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <MarkdownRenderer content={content} />
        )}
      </main>
    </div>
  )
}
