'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { MemoryGraph } from './memory-graph'

const log = createClientLogger('MemoryBrowser')

interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

function mergeDirectoryChildren(files: MemoryFile[], targetPath: string, children: MemoryFile[]): MemoryFile[] {
  return files.map((file) => {
    if (file.path === targetPath && file.type === 'directory') {
      return { ...file, children }
    }
    if (!file.children?.length) return file
    return { ...file, children: mergeDirectoryChildren(file.children, targetPath, children) }
  })
}

interface HealthCategory {
  name: string
  status: 'healthy' | 'warning' | 'critical'
  score: number
  issues: string[]
  suggestions: string[]
}

interface HealthReport {
  overall: 'healthy' | 'warning' | 'critical'
  overallScore: number
  categories: HealthCategory[]
  generatedAt: number
}

interface MOCGroup {
  directory: string
  entries: { title: string; path: string; linkCount: number }[]
}

interface ProcessingResult {
  action: string
  filesProcessed: number
  changes: string[]
  suggestions: string[]
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function countFiles(files: MemoryFile[]): number {
  return files.reduce((acc, f) => {
    if (f.type === 'file') return acc + 1
    return acc + countFiles(f.children || [])
  }, 0)
}

function totalSize(files: MemoryFile[]): number {
  return files.reduce((acc, f) => {
    if (f.type === 'file' && f.size) return acc + f.size
    return acc + totalSize(f.children || [])
  }, 0)
}

function fileIcon(name: string): string {
  if (name.endsWith('.md')) return '#'
  if (name.endsWith('.json') || name.endsWith('.jsonl')) return '{}'
  if (name.endsWith('.txt') || name.endsWith('.log')) return '|'
  return '~'
}

function statusColor(status: 'healthy' | 'warning' | 'critical'): string {
  if (status === 'healthy') return 'text-green-400'
  if (status === 'warning') return 'text-amber-400'
  return 'text-red-400'
}

function statusBg(status: 'healthy' | 'warning' | 'critical'): string {
  if (status === 'healthy') return 'bg-green-500'
  if (status === 'warning') return 'bg-amber-500'
  return 'bg-red-500'
}

export function MemoryBrowserPanel() {
  const {
    memoryFiles,
    selectedMemoryFile,
    memoryContent,
    memoryFileLinks,
    memoryHealth,
    dashboardMode,
    setMemoryFiles,
    setSelectedMemoryFile,
    setMemoryContent,
    setMemoryFileLinks,
    setMemoryHealth
  } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  const [isLoading, setIsLoading] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [searchResults, setSearchResults] = useState<{ path: string; name: string; matches: number }[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeView, setActiveView] = useState<'files' | 'graph' | 'health' | 'pipeline' | 'hermes'>(!isLocal ? 'graph' : 'files')
  const [hermesMemory, setHermesMemory] = useState<{ agentMemory: string | null; userMemory: string | null; agentMemorySize: number; userMemorySize: number; agentMemoryEntries: number; userMemoryEntries: number } | null>(null)
  const [hermesInstalled, setHermesInstalled] = useState<boolean | null>(null)
  const [isLoadingHermes, setIsLoadingHermes] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [fileFilter, setFileFilter] = useState<'all' | 'daily' | 'knowledge'>('all')
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([])
  const [linksOpen, setLinksOpen] = useState(false)
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null)
  const [isLoadingHealth, setIsLoadingHealth] = useState(false)
  const [pipelineResult, setPipelineResult] = useState<ProcessingResult | null>(null)
  const [mocGroups, setMocGroups] = useState<MOCGroup[]>([])
  const [isRunningPipeline, setIsRunningPipeline] = useState(false)
  const [isHydratingTree, setIsHydratingTree] = useState(false)
  const memoryFilesRef = useRef(memoryFiles)

  useEffect(() => {
    memoryFilesRef.current = memoryFiles
  }, [memoryFiles])

  const fetchTree = useCallback(async (options?: { path?: string; depth?: number }) => {
    const params = new URLSearchParams({ action: 'tree' })
    if (typeof options?.depth === 'number') params.set('depth', String(options.depth))
    if (options?.path) params.set('path', options.path)
    const response = await fetch(`/api/memory?${params.toString()}`)
    return response.json()
  }, [])

  const loadFileTree = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await fetchTree({ depth: 1 })
      setMemoryFiles(data.tree || [])
      setExpandedFolders(new Set(['daily', 'knowledge', 'memory', 'knowledge-base']))
      setIsHydratingTree(true)
      void fetchTree()
        .then((fullData) => {
          setMemoryFiles(fullData.tree || [])
        })
        .catch((error) => {
          log.error('Failed to hydrate full file tree:', error)
        })
        .finally(() => {
          setIsHydratingTree(false)
        })
    } catch (error) {
      log.error('Failed to load file tree:', error)
    } finally {
      setIsLoading(false)
    }
  }, [fetchTree, setMemoryFiles])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const filteredFiles = useMemo(() => {
    if (fileFilter === 'all') return memoryFiles
    const prefixes = fileFilter === 'daily'
      ? ['daily/', 'memory/']
      : ['knowledge/', 'knowledge-base/']
    return memoryFiles.filter((file) => {
      const p = `${file.path.replace(/\\/g, '/')}/`
      return prefixes.some((prefix) => p.startsWith(prefix))
    })
  }, [memoryFiles, fileFilter])

  const loadFileContent = async (filePath: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/memory?action=content&path=${encodeURIComponent(filePath)}`)
      const data = await response.json()
      if (data.content !== undefined) {
        setSelectedMemoryFile(filePath)
        setMemoryContent(data.content)
        setIsEditing(false)
        setEditedContent('')
        setSchemaWarnings([])
        if (data.wikiLinks) {
          setMemoryFileLinks({
            wikiLinks: data.wikiLinks,
            incoming: [],
            outgoing: [],
          })
          fetch(`/api/memory/links?file=${encodeURIComponent(filePath)}`)
            .then((r) => r.json())
            .then((linkData) => {
              setMemoryFileLinks({
                wikiLinks: linkData.wikiLinks || data.wikiLinks,
                incoming: linkData.incoming || [],
                outgoing: linkData.outgoing || [],
              })
            })
            .catch(() => {})
        }
        if (activeView === 'graph' || activeView === 'health' || activeView === 'pipeline') {
          setActiveView('files')
        }
      }
    } catch (error) {
      log.error('Failed to load file content:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const searchFiles = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const response = await fetch(`/api/memory?action=search&query=${encodeURIComponent(searchQuery)}`)
      const data = await response.json()
      setSearchResults(data.results || [])
    } catch (error) {
      log.error('Search failed:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const toggleFolder = async (folderPath: string, needsChildren: boolean) => {
    if (!expandedFolders.has(folderPath) && needsChildren) {
      try {
        const data = await fetchTree({ path: folderPath, depth: 1 })
        setMemoryFiles(mergeDirectoryChildren(memoryFilesRef.current, folderPath, data.tree || []))
      } catch (error) {
        log.error('Failed to load folder children:', error)
      }
    }
    const next = new Set(expandedFolders)
    if (next.has(folderPath)) next.delete(folderPath)
    else next.add(folderPath)
    setExpandedFolders(next)
  }

  const saveFile = async () => {
    if (!selectedMemoryFile) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', path: selectedMemoryFile, content: editedContent })
      })
      const data = await response.json()
      if (data.success) {
        setMemoryContent(editedContent)
        setIsEditing(false)
        setEditedContent('')
        setSchemaWarnings(data.schemaWarnings || [])
        loadFileTree()
      }
    } catch (error) {
      log.error('Failed to save file:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const createNewFile = async (filePath: string, content: string = '') => {
    try {
      const response = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', path: filePath, content })
      })
      const data = await response.json()
      if (data.success) {
        loadFileTree()
        loadFileContent(filePath)
      }
    } catch (error) {
      log.error('Failed to create file:', error)
    }
  }

  const deleteFile = async () => {
    if (!selectedMemoryFile) return
    try {
      const response = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path: selectedMemoryFile })
      })
      const data = await response.json()
      if (data.success) {
        setSelectedMemoryFile('')
        setMemoryContent('')
        setMemoryFileLinks(null)
        setShowDeleteConfirm(false)
        loadFileTree()
      }
    } catch (error) {
      log.error('Failed to delete file:', error)
    }
  }

  const loadHealth = useCallback(async () => {
    setIsLoadingHealth(true)
    try {
      const response = await fetch('/api/memory/health')
      const data = await response.json()
      if (data.categories) {
        setHealthReport(data)
        setMemoryHealth(data)
      }
    } catch (error) {
      log.error('Failed to load health:', error)
    } finally {
      setIsLoadingHealth(false)
    }
  }, [setMemoryHealth])

  useEffect(() => {
    if (activeView === 'health' && !healthReport) {
      loadHealth()
    }
  }, [activeView, healthReport, loadHealth])

  useEffect(() => {
    if (hermesInstalled === null) {
      fetch('/api/hermes').then(r => r.json()).then(d => setHermesInstalled(d.installed === true)).catch(() => setHermesInstalled(false))
    }
  }, [hermesInstalled])

  useEffect(() => {
    if (activeView === 'hermes' && !hermesMemory && !isLoadingHermes) {
      setIsLoadingHermes(true)
      fetch('/api/hermes/memory')
        .then(r => r.json())
        .then(d => setHermesMemory(d))
        .catch(() => {})
        .finally(() => setIsLoadingHermes(false))
    }
  }, [activeView, hermesMemory, isLoadingHermes])

  const runPipelineAction = async (action: string) => {
    setIsRunningPipeline(true)
    setPipelineResult(null)
    setMocGroups([])
    try {
      const response = await fetch('/api/memory/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await response.json()
      if (action === 'generate-moc') {
        setMocGroups(data.groups || [])
      } else {
        setPipelineResult(data)
      }
    } catch (error) {
      log.error('Pipeline action failed:', error)
    } finally {
      setIsRunningPipeline(false)
    }
  }

  const fileCount = useMemo(() => countFiles(memoryFiles), [memoryFiles])
  const sizeTotal = useMemo(() => totalSize(memoryFiles), [memoryFiles])

  const navigateToWikiLink = (target: string) => {
    const findFile = (files: MemoryFile[]): string | null => {
      for (const f of files) {
        if (f.type === 'file') {
          const stem = f.name.replace(/\.[^.]+$/, '')
          if (stem === target || f.name === target || f.name === `${target}.md`) {
            return f.path
          }
        }
        if (f.children) {
          const found = findFile(f.children)
          if (found) return found
        }
      }
      return null
    }
    const found = findFile(memoryFiles)
    if (found) {
      loadFileContent(found)
    }
  }

  const renderTree = (files: MemoryFile[], depth = 0): React.ReactElement[] => {
    return files.map((file) => {
      const isDir = file.type === 'directory'
      const isExpanded = expandedFolders.has(file.path)
      const isSelected = selectedMemoryFile === file.path
      return (
        <div key={file.path}>
          <div
            className={`flex items-center gap-1 py-[3px] pr-2 cursor-pointer text-[13px] font-mono hover:bg-[hsl(var(--surface-2))] rounded-sm transition-colors duration-75 ${isSelected ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground'}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => void (isDir ? toggleFolder(file.path, file.children === undefined) : loadFileContent(file.path))}
          >
            {isDir ? (
              <span className={`text-[10px] w-3 text-center shrink-0 transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}>&#9656;</span>
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className={`text-[11px] w-4 text-center shrink-0 ${isDir ? 'text-muted-foreground/60' : 'text-muted-foreground/40'}`}>
              {isDir ? '/' : fileIcon(file.name)}
            </span>
            <span className="truncate flex-1">{file.name}</span>
            {!isDir && file.size != null && (
              <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">{formatFileSize(file.size)}</span>
            )}
          </div>
          {isDir && isExpanded && file.children && <div>{renderTree(file.children, depth + 1)}</div>}
        </div>
      )
    })
  }

  const renderInline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = []
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    let key = 0
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
      const m = match[0]
      if (m.startsWith('[[') && m.endsWith(']]')) {
        const target = match[2]?.trim() || ''
        const display = (match[3] || match[2] || '').trim()
        parts.push(
          <button
            key={key++}
            onClick={() => navigateToWikiLink(target)}
            className="text-primary/80 hover:text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors font-mono text-[12px] cursor-pointer"
            title={`Navigate to [[${target}]]`}
          >
            {display}
          </button>
        )
      } else if (m.startsWith('`') && m.endsWith('`')) {
        parts.push(<code key={key++} className="bg-[hsl(var(--surface-2))] px-1 py-0.5 rounded text-[12px] font-mono text-primary/80">{m.slice(1, -1)}</code>)
      } else if (m.startsWith('**') && m.endsWith('**')) {
        parts.push(<strong key={key++} className="font-semibold text-foreground">{m.slice(2, -2)}</strong>)
      } else if (m.startsWith('*') && m.endsWith('*')) {
        parts.push(<em key={key++}>{m.slice(1, -1)}</em>)
      }
      lastIndex = pattern.lastIndex
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex))
    return parts
  }

  const renderMarkdown = (content: string) => {
    const lines = content.split('\n')
    const elements: React.ReactElement[] = []
    const seenHeaders = new Set<string>()
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (trimmed.startsWith('# ')) {
        const text = trimmed.slice(2)
        const id = `h1-${text.toLowerCase().replace(/\s+/g, '-')}`
        if (seenHeaders.has(id)) continue
        seenHeaders.add(id)
        elements.push(<h1 key={i} className="text-xl font-bold mt-6 mb-2 text-foreground font-mono">{renderInline(text)}</h1>)
      } else if (trimmed.startsWith('## ')) {
        const text = trimmed.slice(3)
        const id = `h2-${text.toLowerCase().replace(/\s+/g, '-')}`
        if (seenHeaders.has(id)) continue
        seenHeaders.add(id)
        elements.push(<h2 key={i} className="text-lg font-semibold mt-5 mb-2 text-foreground/90 font-mono">{renderInline(text)}</h2>)
      } else if (trimmed.startsWith('### ')) {
        const text = trimmed.slice(4)
        const id = `h3-${text.toLowerCase().replace(/\s+/g, '-')}`
        if (seenHeaders.has(id)) continue
        seenHeaders.add(id)
        elements.push(<h3 key={i} className="text-base font-semibold mt-4 mb-1.5 text-foreground/80 font-mono">{renderInline(text)}</h3>)
      } else if (trimmed.startsWith('- ')) {
        elements.push(
          <li key={i} className="ml-5 mb-0.5 list-disc text-foreground/80 text-sm leading-relaxed">{renderInline(trimmed.slice(2))}</li>
        )
      } else if (trimmed === '') {
        elements.push(<div key={i} className="h-2" />)
      } else if (trimmed.startsWith('```')) {
        const codeLang = trimmed.slice(3)
        const codeLines: string[] = []
        let j = i + 1
        while (j < lines.length && !lines[j].trim().startsWith('```')) {
          codeLines.push(lines[j])
          j++
        }
        elements.push(
          <pre key={i} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-md px-3 py-2 my-2 text-xs font-mono overflow-x-auto">
            {codeLang && <span className="text-muted-foreground/40 text-[10px] block mb-1">{codeLang}</span>}
            <code className="text-foreground/80">{codeLines.join('\n')}</code>
          </pre>
        )
        i = j
      } else {
        elements.push(
          <p key={i} className="mb-1.5 text-sm text-foreground/80 leading-relaxed">{renderInline(trimmed)}</p>
        )
      }
    }
    return elements
  }

  const viewTabs = ['files', ...(!isLocal ? ['graph'] : []), 'health', 'pipeline', ...(hermesInstalled ? ['hermes'] : [])] as const

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-[hsl(var(--surface-2))] text-muted-foreground text-xs font-mono"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >|||</button>
        <div className="w-px h-4 bg-border mx-1" />
        {viewTabs.map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view as typeof activeView)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors capitalize ${activeView === view ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >{view}</button>
        ))}
        <div className="flex-1" />
        {healthReport && (
          <span className={`text-[10px] font-mono ${statusColor(healthReport.overall)} tabular-nums mr-1`}>{healthReport.overallScore}%</span>
        )}
        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">{fileCount} files / {formatFileSize(sizeTotal)}</span>
        {isHydratingTree && <span className="ml-2 text-[10px] text-muted-foreground/35 font-mono">indexing…</span>}
        <div className="w-px h-4 bg-border mx-1" />
        <button onClick={() => setShowCreateModal(true)} className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors">+ new</button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-60 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0">
            <div className="p-2">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchFiles()} placeholder="Search files..." className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder-muted-foreground/40 focus:outline-none focus:border-primary/30" />
            </div>
            <div className="flex gap-0.5 px-2 pb-2">
              {(['all', 'daily', 'knowledge'] as const).map((f) => (
                <button key={f} onClick={() => setFileFilter(f)} className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${fileFilter === f ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}>{f}</button>
              ))}
            </div>
            {searchResults.length > 0 && (
              <div className="px-2 pb-2 border-b border-border/50">
                <div className="text-[10px] text-muted-foreground/50 font-mono mb-1">{searchResults.length} results</div>
                <div className="max-h-28 overflow-y-auto space-y-px">
                  {searchResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 py-1 px-1.5 rounded text-xs font-mono cursor-pointer hover:bg-[hsl(var(--surface-2))] text-muted-foreground" onClick={() => { loadFileContent(r.path); setSearchResults([]) }}>
                      <span className="truncate flex-1">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground/40">{r.matches}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto py-1">
              {isLoading ? (
                <div className="flex items-center justify-center h-20"><Loader variant="inline" /></div>
              ) : filteredFiles.length === 0 ? (
                <div className="text-center text-muted-foreground/40 text-xs font-mono py-8">no files</div>
              ) : renderTree(filteredFiles)}
            </div>
            <div className="p-2 border-t border-border/50">
              <button onClick={loadFileTree} disabled={isLoading} className="w-full py-1 text-[11px] font-mono text-muted-foreground/50 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-1))] transition-colors">refresh</button>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col bg-[hsl(var(--surface-0))]">
          {activeView === 'graph' && !isLocal ? (
            <div className="flex-1 p-4 overflow-hidden flex flex-col"><MemoryGraph /></div>
          ) : activeView === 'health' ? (
            <div className="flex-1 overflow-auto p-6"><HealthView report={healthReport} isLoading={isLoadingHealth} onRefresh={loadHealth} /></div>
          ) : activeView === 'pipeline' ? (
            <div className="flex-1 overflow-auto p-6"><PipelineView result={pipelineResult} mocGroups={mocGroups} isRunning={isRunningPipeline} onRunAction={runPipelineAction} onNavigate={loadFileContent} /></div>
          ) : activeView === 'hermes' ? (
            <div className="flex-1 overflow-auto p-6">
              <HermesMemoryView data={hermesMemory} isLoading={isLoadingHermes} onRefresh={() => { setHermesMemory(null); setIsLoadingHermes(false) }} />
            </div>
          ) : (
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 flex flex-col min-h-0">
                {selectedMemoryFile && (
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-[hsl(var(--surface-0))]">
                    <span className="text-xs font-mono text-muted-foreground/60 truncate flex-1">{selectedMemoryFile}</span>
                    {memoryContent != null && (
                      <span className="text-[10px] font-mono text-muted-foreground/30 tabular-nums shrink-0">{memoryContent.length} chars</span>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setLinksOpen(!linksOpen)} className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${linksOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]'}`} title="Toggle backlinks panel">links</button>
                      {!isEditing ? (
                        <>
                          <button onClick={() => { setIsEditing(true); setEditedContent(memoryContent ?? '') }} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">edit</button>
                          <button onClick={() => setShowDeleteConfirm(true)} className="px-2 py-0.5 text-[11px] font-mono text-red-400/60 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors">delete</button>
                        </>
                      ) : (
                        <>
                          <button onClick={saveFile} disabled={isSaving} className="px-2 py-0.5 text-[11px] font-mono text-green-400/80 hover:text-green-400 rounded hover:bg-green-500/10 transition-colors">{isSaving ? 'saving...' : 'save'}</button>
                          <button onClick={() => { setIsEditing(false); setEditedContent('') }} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">cancel</button>
                        </>
                      )}
                      <button onClick={() => { setSelectedMemoryFile(''); setMemoryContent(''); setMemoryFileLinks(null); setIsEditing(false); setEditedContent(''); setSchemaWarnings([]); setLinksOpen(false) }} className="px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground/40 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">x</button>
                    </div>
                  </div>
                )}
                {schemaWarnings.length > 0 && (
                  <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/15">
                    <div className="text-[11px] font-mono text-amber-400">Schema warnings:</div>
                    {schemaWarnings.map((w, i) => (
                      <div key={i} className="text-[11px] font-mono text-amber-400/70 ml-2">- {w}</div>
                    ))}
                  </div>
                )}
                <div className="flex-1 overflow-auto">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-full"><Loader variant="inline" /></div>
                  ) : memoryContent != null && selectedMemoryFile ? (
                    <div className="p-6 max-w-3xl">
                      {isEditing ? (
                        <textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)} className="w-full min-h-[500px] p-3 bg-[hsl(var(--surface-1))] text-foreground font-mono text-sm border border-border/50 rounded-md resize-none focus:outline-none focus:border-primary/30 leading-relaxed" placeholder="Edit file content..." />
                      ) : selectedMemoryFile.endsWith('.md') ? (
                        <div>{renderMarkdown(memoryContent)}</div>
                      ) : selectedMemoryFile.endsWith('.json') ? (
                        <pre className="text-sm font-mono overflow-auto whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">
                          <code>{(() => { try { return JSON.stringify(JSON.parse(memoryContent), null, 2) } catch { return memoryContent } })()}</code>
                        </pre>
                      ) : (
                        <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">{memoryContent}</pre>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
                      <span className="text-4xl font-mono mb-3">/</span>
                      <span className="text-sm font-mono">select a file to view</span>
                      <span className="text-xs font-mono mt-1 text-muted-foreground/20">or switch to health / pipeline view</span>
                    </div>
                  )}
                </div>
              </div>
              {linksOpen && selectedMemoryFile && memoryFileLinks && (
                <LinksSidebar fileLinks={memoryFileLinks} onNavigate={loadFileContent} />
              )}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && <CreateFileModal onClose={() => setShowCreateModal(false)} onCreate={createNewFile} />}
      {showDeleteConfirm && selectedMemoryFile && <DeleteConfirmModal fileName={selectedMemoryFile} onClose={() => setShowDeleteConfirm(false)} onConfirm={deleteFile} />}
    </div>
  )
}

function HermesMemoryView({ data, isLoading, onRefresh }: { data: { agentMemory: string | null; userMemory: string | null; agentMemorySize: number; userMemorySize: number; agentMemoryEntries: number; userMemoryEntries: number } | null; isLoading: boolean; onRefresh: () => void }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader variant="inline" label="Loading Hermes memory" />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
        <span className="text-sm font-mono mb-3">No Hermes memory data</span>
        <Button onClick={onRefresh} size="sm" variant="secondary">Refresh</Button>
      </div>
    )
  }

  const AGENT_CAP = 2200
  const USER_CAP = 1375
  const agentPct = Math.min(100, Math.round((data.agentMemorySize / AGENT_CAP) * 100))
  const userPct = Math.min(100, Math.round((data.userMemorySize / USER_CAP) * 100))

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono text-foreground mb-1">Hermes Memory</h2>
          <p className="text-xs text-muted-foreground font-mono">Read-only view of Hermes agent persistent memory files</p>
        </div>
        <Button onClick={onRefresh} size="sm" variant="secondary">Refresh</Button>
      </div>

      {/* MEMORY.md */}
      <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold font-mono text-foreground">MEMORY.md</span>
            <span className="text-[10px] font-mono text-purple-400">{data.agentMemoryEntries} entries</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {data.agentMemorySize}/{AGENT_CAP} chars ({agentPct}%)
          </span>
        </div>
        <div className="h-1.5 bg-[hsl(var(--surface-0))] rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all ${agentPct > 90 ? 'bg-red-500' : agentPct > 70 ? 'bg-amber-500' : 'bg-purple-500'}`}
            style={{ width: `${agentPct}%`, opacity: 0.7 }}
          />
        </div>
        {data.agentMemory ? (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed max-h-80 overflow-y-auto bg-[hsl(var(--surface-0))] rounded-md p-3 border border-border/30">{data.agentMemory}</pre>
        ) : (
          <div className="text-xs font-mono text-muted-foreground/40 py-4 text-center">No agent memory file found</div>
        )}
      </div>

      {/* USER.md */}
      <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold font-mono text-foreground">USER.md</span>
            <span className="text-[10px] font-mono text-purple-400">{data.userMemoryEntries} entries</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {data.userMemorySize}/{USER_CAP} chars ({userPct}%)
          </span>
        </div>
        <div className="h-1.5 bg-[hsl(var(--surface-0))] rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all ${userPct > 90 ? 'bg-red-500' : userPct > 70 ? 'bg-amber-500' : 'bg-purple-500'}`}
            style={{ width: `${userPct}%`, opacity: 0.7 }}
          />
        </div>
        {data.userMemory ? (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed max-h-80 overflow-y-auto bg-[hsl(var(--surface-0))] rounded-md p-3 border border-border/30">{data.userMemory}</pre>
        ) : (
          <div className="text-xs font-mono text-muted-foreground/40 py-4 text-center">No user memory file found</div>
        )}
      </div>
    </div>
  )
}

function LinksSidebar({ fileLinks, onNavigate }: { fileLinks: { wikiLinks: unknown[]; incoming: string[]; outgoing: string[] }; onNavigate: (path: string) => void }) {
  const links = fileLinks.wikiLinks as { target: string; display: string; line: number }[]
  return (
    <div className="w-56 shrink-0 border-l border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0 overflow-y-auto">
      <div className="p-3 border-b border-border/50">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">Outgoing ({fileLinks.outgoing.length})</div>
        {fileLinks.outgoing.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-0.5">
            {fileLinks.outgoing.map((path, i) => (
              <button key={i} onClick={() => onNavigate(path)} className="block w-full text-left px-1.5 py-1 rounded text-[11px] font-mono text-primary/70 hover:text-primary hover:bg-[hsl(var(--surface-2))] transition-colors truncate">
                {path.split('/').pop()?.replace(/\.[^.]+$/, '')}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-3 border-b border-border/50">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">Backlinks ({fileLinks.incoming.length})</div>
        {fileLinks.incoming.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-0.5">
            {fileLinks.incoming.map((path, i) => (
              <button key={i} onClick={() => onNavigate(path)} className="block w-full text-left px-1.5 py-1 rounded text-[11px] font-mono text-primary/70 hover:text-primary hover:bg-[hsl(var(--surface-2))] transition-colors truncate">
                {path.split('/').pop()?.replace(/\.[^.]+$/, '')}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">Wiki-links ({links.length})</div>
        {links.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-0.5">
            {links.map((link, i) => (
              <div key={i} className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                <span className="text-muted-foreground/30 tabular-nums shrink-0">L{link.line}</span>
                <span className="text-primary/60 truncate">[[{link.target}]]</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function HealthView({ report, isLoading, onRefresh }: { report: HealthReport | null; isLoading: boolean; onRefresh: () => void }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader variant="inline" label="Running diagnostics" />
      </div>
    )
  }
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
        <span className="text-sm font-mono mb-3">No health data</span>
        <Button onClick={onRefresh} size="sm" variant="secondary">Run Diagnostics</Button>
      </div>
    )
  }
  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <div className={`text-4xl font-bold font-mono tabular-nums ${statusColor(report.overall)}`}>{report.overallScore}</div>
        <div>
          <div className={`text-sm font-semibold font-mono uppercase ${statusColor(report.overall)}`}>{report.overall}</div>
          <div className="text-[11px] text-muted-foreground/50 font-mono">8 categories / {new Date(report.generatedAt).toLocaleTimeString()}</div>
        </div>
        <div className="flex-1" />
        <Button onClick={onRefresh} size="sm" variant="secondary">Refresh</Button>
      </div>
      <div className="grid gap-3">
        {report.categories.map((cat) => (
          <div key={cat.name} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-lg font-bold font-mono tabular-nums ${statusColor(cat.status)}`}>{cat.score}</span>
              <span className="text-sm font-mono text-foreground flex-1">{cat.name}</span>
              <span className={`text-[10px] font-mono uppercase ${statusColor(cat.status)}`}>{cat.status}</span>
            </div>
            <div className="h-1.5 bg-[hsl(var(--surface-0))] rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full transition-all ${statusBg(cat.status)}`} style={{ width: `${cat.score}%`, opacity: 0.7 }} />
            </div>
            {cat.issues.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {cat.issues.map((issue, i) => <div key={i} className="text-[11px] font-mono text-muted-foreground/70">- {issue}</div>)}
              </div>
            )}
            {cat.suggestions.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {cat.suggestions.map((sug, i) => <div key={i} className="text-[11px] font-mono text-primary/50">{sug}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineView({ result, mocGroups, isRunning, onRunAction, onNavigate }: { result: ProcessingResult | null; mocGroups: MOCGroup[]; isRunning: boolean; onRunAction: (action: string) => void; onNavigate: (path: string) => void }) {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold font-mono text-foreground mb-1">Processing Pipeline</h2>
        <p className="text-xs text-muted-foreground font-mono">Knowledge maintenance operations inspired by Ars Contexta&apos;s 6 Rs</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => onRunAction('reflect')} disabled={isRunning} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 text-left hover:border-primary/30 transition-colors disabled:opacity-50">
          <div className="text-sm font-semibold font-mono text-foreground mb-1">Reflect</div>
          <div className="text-[11px] text-muted-foreground font-mono">Find connection opportunities between files</div>
        </button>
        <button onClick={() => onRunAction('reweave')} disabled={isRunning} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 text-left hover:border-primary/30 transition-colors disabled:opacity-50">
          <div className="text-sm font-semibold font-mono text-foreground mb-1">Reweave</div>
          <div className="text-[11px] text-muted-foreground font-mono">Find stale files needing updates from newer linked files</div>
        </button>
        <button onClick={() => onRunAction('generate-moc')} disabled={isRunning} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 text-left hover:border-primary/30 transition-colors disabled:opacity-50">
          <div className="text-sm font-semibold font-mono text-foreground mb-1">Generate MOC</div>
          <div className="text-[11px] text-muted-foreground font-mono">Auto-generate Maps of Content from file clusters</div>
        </button>
      </div>
      {isRunning && (
        <Loader variant="inline" label="Processing" />
      )}
      {result && (
        <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold font-mono text-foreground capitalize">{result.action}</span>
            <span className="text-[10px] font-mono text-muted-foreground/50">{result.filesProcessed} files processed</span>
          </div>
          {result.suggestions.length === 0 ? (
            <div className="text-[11px] font-mono text-green-400/70">No suggestions — knowledge base looks well-connected</div>
          ) : (
            <div className="space-y-1.5">
              {result.suggestions.map((sug, i) => <div key={i} className="text-[11px] font-mono text-muted-foreground/80 leading-relaxed">{sug}</div>)}
            </div>
          )}
        </div>
      )}
      {mocGroups.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold font-mono text-foreground">Maps of Content ({mocGroups.length} groups)</div>
          {mocGroups.map((group) => (
            <div key={group.directory} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
              <div className="text-xs font-semibold font-mono text-foreground/80 mb-2">{group.directory}</div>
              <div className="space-y-0.5">
                {group.entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button onClick={() => onNavigate(entry.path)} className="text-[11px] font-mono text-primary/70 hover:text-primary truncate flex-1 text-left">{entry.title}</button>
                    {entry.linkCount > 0 && <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums shrink-0">{entry.linkCount} links</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateFileModal({ onClose, onCreate }: { onClose: () => void; onCreate: (path: string, content: string) => void }) {
  const [fileName, setFileName] = useState('')
  const [filePath, setFilePath] = useState('knowledge/')
  const [initialContent, setInitialContent] = useState('')
  const [fileType, setFileType] = useState('md')
  const templates: Record<string, string> = { md: '# New Document\n\n', json: '{\n  \n}', txt: '', log: '' }
  const handleCreate = () => {
    if (!fileName.trim()) return
    onCreate(filePath + fileName + '.' + fileType, initialContent)
    onClose()
  }
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-md w-full p-5 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-foreground font-mono">new file</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">x</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">directory</label>
            <select value={filePath} onChange={(e) => setFilePath(e.target.value)} className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30">
              <option value="knowledge-base/">knowledge-base/</option>
              <option value="memory/">memory/</option>
              <option value="knowledge/">knowledge/</option>
              <option value="daily/">daily/</option>
              <option value="logs/">logs/</option>
              <option value="">root/</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">name</label>
            <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="my-file" className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30" autoFocus />
          </div>
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">type</label>
            <select value={fileType} onChange={(e) => { setFileType(e.target.value); setInitialContent(templates[e.target.value] || '') }} className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30">
              <option value="md">.md</option>
              <option value="json">.json</option>
              <option value="txt">.txt</option>
              <option value="log">.log</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">content</label>
            <textarea value={initialContent} onChange={(e) => setInitialContent(e.target.value)} className="w-full h-20 px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30 resize-none" placeholder="optional..." />
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/40 bg-[hsl(var(--surface-0))] px-2 py-1 rounded">{filePath}{fileName || '...'}.{fileType}</div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleCreate} disabled={!fileName.trim()} size="sm" className="flex-1">Create</Button>
            <Button onClick={onClose} variant="secondary" size="sm">Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ fileName, onClose, onConfirm }: { fileName: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-sm w-full p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-red-400 font-mono mb-3">delete file</h3>
        <div className="bg-red-500/5 border border-red-500/15 rounded-md p-3 mb-4">
          <p className="text-xs text-muted-foreground font-mono">permanently delete:</p>
          <p className="text-xs font-mono text-foreground mt-1 bg-[hsl(var(--surface-0))] px-2 py-1 rounded">{fileName}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onConfirm} variant="destructive" size="sm" className="flex-1">Delete</Button>
          <Button onClick={onClose} variant="secondary" size="sm">Cancel</Button>
        </div>
      </div>
    </div>
  )
}
