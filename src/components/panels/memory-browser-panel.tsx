'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { MemoryGraph } from './memory-graph'
import { mergeDirectoryChildren, formatFileSize, countFiles, totalSize } from './memory-browser/utils'
import { HealthView } from './memory-browser/HealthView'
import { PipelineView } from './memory-browser/PipelineView'
import { HermesMemoryView } from './memory-browser/HermesMemoryView'
import { LinksSidebar } from './memory-browser/LinksSidebar'
import { FileTree } from './memory-browser/FileTree'
import { MarkdownRenderer } from './memory-browser/MarkdownRenderer'
import { CreateFileModal, DeleteConfirmModal } from './memory-browser/FileModals'
import type { HealthReport, MOCGroup, ProcessingResult, HermesMemoryData, FileLinks } from './memory-browser/types'

const log = createClientLogger('MemoryBrowser')

export function MemoryBrowserPanel() {
  const t = useTranslations('memoryBrowser')
  const {
    memoryFiles,
    selectedMemoryFile,
    memoryContent,
    memoryFileLinks,
    dashboardMode,
    setMemoryFiles,
    setSelectedMemoryFile,
    setMemoryContent,
    setMemoryFileLinks,
    setMemoryHealth
  } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const [hermesMemory, setHermesMemory] = useState<HermesMemoryData | null>(null)
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
    const response = await fetch(`/api/memory?${params.toString()}`, { signal: AbortSignal.timeout(8000) })
    return response.json()
  }, [])

  const loadFileTree = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchTree({ depth: 1 })
      setMemoryFiles(data.tree || [])
      setExpandedFolders(new Set(['daily', 'knowledge', 'memory', 'knowledge-base']))
      setIsHydratingTree(true)
      void fetchTree()
        .then((fullData) => {
          setMemoryFiles(fullData.tree || [])
        })
        .catch((err) => {
          log.error('Failed to hydrate full file tree:', err)
        })
        .finally(() => {
          setIsHydratingTree(false)
        })
    } catch (err) {
      log.error('Failed to load file tree:', err)
      setError('Failed to load memory files. Please try again.')
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
      const response = await fetch(`/api/memory?action=content&path=${encodeURIComponent(filePath)}`, { signal: AbortSignal.timeout(8000) })
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
    } catch (err) {
      log.error('Failed to load file content:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const searchFiles = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const response = await fetch(`/api/memory?action=search&query=${encodeURIComponent(searchQuery)}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setSearchResults(data.results || [])
    } catch (err) {
      log.error('Search failed:', err)
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
      } catch (err) {
        log.error('Failed to load folder children:', err)
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
        body: JSON.stringify({ action: 'save', path: selectedMemoryFile, content: editedContent }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json()
      if (data.success) {
        setMemoryContent(editedContent)
        setIsEditing(false)
        setEditedContent('')
        setSchemaWarnings(data.schemaWarnings || [])
        loadFileTree()
      }
    } catch (err) {
      log.error('Failed to save file:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const createNewFile = async (filePath: string, content: string = '') => {
    try {
      const response = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', path: filePath, content }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json()
      if (data.success) {
        loadFileTree()
        loadFileContent(filePath)
      }
    } catch (err) {
      log.error('Failed to create file:', err)
    }
  }

  const deleteFile = async () => {
    if (!selectedMemoryFile) return
    try {
      const response = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path: selectedMemoryFile }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json()
      if (data.success) {
        setSelectedMemoryFile('')
        setMemoryContent('')
        setMemoryFileLinks(null)
        setShowDeleteConfirm(false)
        loadFileTree()
      }
    } catch (err) {
      log.error('Failed to delete file:', err)
    }
  }

  const loadHealth = useCallback(async () => {
    setIsLoadingHealth(true)
    try {
      const response = await fetch('/api/memory/health', { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      if (data.categories) {
        setHealthReport(data)
        setMemoryHealth(data)
      }
    } catch (err) {
      log.error('Failed to load health:', err)
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
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json()
      if (action === 'generate-moc') {
        setMocGroups(data.groups || [])
      } else {
        setPipelineResult(data)
      }
    } catch (err) {
      log.error('Pipeline action failed:', err)
    } finally {
      setIsRunningPipeline(false)
    }
  }

  const fileCount = useMemo(() => countFiles(memoryFiles), [memoryFiles])
  const sizeTotal = useMemo(() => totalSize(memoryFiles), [memoryFiles])

  const navigateToWikiLink = (target: string) => {
    const findFile = (files: typeof memoryFiles): string | null => {
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

  const viewTabs = ['files', ...(!isLocal ? ['graph'] : []), 'health', 'pipeline', ...(hermesInstalled ? ['hermes'] : [])] as const

  const VIEW_LABELS: Record<string, string> = {
    files: 'File Tree',
    graph: 'Memory Graph',
    health: 'Health',
    pipeline: 'Pipeline',
    hermes: 'Hermes',
  }

  const VIEW_TITLES: Record<string, string> = {
    files: 'Browse memory files in a tree view',
    graph: 'Visualize memory as a knowledge graph',
    health: 'Check memory health and diagnostics',
    pipeline: 'Run processing pipelines on memory files',
    hermes: 'Explore Hermes agent memory',
  }

  // Cast store links to the typed interface used by sub-components
  const typedFileLinks = memoryFileLinks as FileLinks | null

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={() => { setError(null); loadFileTree() }} className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300">Retry</button>
        </div>
      )}
      {/* Top bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-[hsl(var(--surface-2))] text-muted-foreground text-xs font-mono"
          title={sidebarOpen ? t('hideSidebar') : t('showSidebar')}
        >|||</button>
        <div className="w-px h-4 bg-border mx-1" />
        {viewTabs.map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view as typeof activeView)}
            title={VIEW_TITLES[view]}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${activeView === view ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >{VIEW_LABELS[view] ?? view}</button>
        ))}
        <div className="flex-1" />
        {healthReport && (
          <span className={`text-[10px] font-mono tabular-nums mr-1 ${healthReport.overall === 'healthy' ? 'text-green-400' : healthReport.overall === 'warning' ? 'text-amber-400' : 'text-red-400'}`}>{healthReport.overallScore}%</span>
        )}
        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">{t('fileCountSize', { count: fileCount, size: formatFileSize(sizeTotal) })}</span>
        {isHydratingTree && <span className="ml-2 text-[10px] text-muted-foreground/35 font-mono">{t('indexing')}</span>}
        <div className="w-px h-4 bg-border mx-1" />
        <button onClick={() => setShowCreateModal(true)} className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors">{t('newFile')}</button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-60 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0">
            <div className="p-2">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchFiles()} placeholder={t('searchPlaceholder')} className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder-muted-foreground/40 focus:outline-none focus:border-primary/30" />
            </div>
            <div className="flex gap-0.5 px-2 pb-2">
              {(['all', 'daily', 'knowledge'] as const).map((f) => (
                <button key={f} onClick={() => setFileFilter(f)} className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${fileFilter === f ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}>{f}</button>
              ))}
            </div>
            {searchResults.length > 0 && (
              <div className="px-2 pb-2 border-b border-border/50">
                <div className="text-[10px] text-muted-foreground/50 font-mono mb-1">{t('searchResults', { count: searchResults.length })}</div>
                <div className="max-h-28 overflow-y-auto space-y-px">
                  {searchResults.map((r, i) => (
                    <div
                      key={i}
                      role="button"
                      tabIndex={0}
                      className="flex items-center gap-1.5 py-1 px-1.5 rounded text-xs font-mono cursor-pointer hover:bg-[hsl(var(--surface-2))] text-muted-foreground"
                      onClick={() => { loadFileContent(r.path); setSearchResults([]) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadFileContent(r.path); setSearchResults([]) } }}
                    >
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
                <div className="text-center text-muted-foreground/40 text-xs font-mono py-8">{t('noFiles')}</div>
              ) : (
                <FileTree
                  files={filteredFiles}
                  selectedPath={selectedMemoryFile ?? ''}
                  expandedFolders={expandedFolders}
                  onSelectFile={loadFileContent}
                  onToggleFolder={toggleFolder}
                />
              )}
            </div>
            <div className="p-2 border-t border-border/50">
              <button onClick={loadFileTree} disabled={isLoading} className="w-full py-1 text-[11px] font-mono text-muted-foreground/50 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-1))] transition-colors">{t('refresh')}</button>
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
                      <button onClick={() => setLinksOpen(!linksOpen)} className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${linksOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]'}`} title={t('toggleBacklinks')}>{t('links')}</button>
                      {!isEditing ? (
                        <>
                          <button onClick={() => { setIsEditing(true); setEditedContent(memoryContent ?? '') }} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">{t('edit')}</button>
                          <button onClick={() => setShowDeleteConfirm(true)} className="px-2 py-0.5 text-[11px] font-mono text-red-400/60 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors">{t('delete')}</button>
                        </>
                      ) : (
                        <>
                          <button onClick={saveFile} disabled={isSaving} className="px-2 py-0.5 text-[11px] font-mono text-green-400/80 hover:text-green-400 rounded hover:bg-green-500/10 transition-colors">{isSaving ? t('saving') : t('save')}</button>
                          <button onClick={() => { setIsEditing(false); setEditedContent('') }} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">{t('cancel')}</button>
                        </>
                      )}
                      <button onClick={() => { setSelectedMemoryFile(''); setMemoryContent(''); setMemoryFileLinks(null); setIsEditing(false); setEditedContent(''); setSchemaWarnings([]); setLinksOpen(false) }} className="px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground/40 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">x</button>
                    </div>
                  </div>
                )}
                {schemaWarnings.length > 0 && (
                  <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/15">
                    <div className="text-[11px] font-mono text-amber-400">{t('schemaWarnings')}</div>
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
                        <textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)} className="w-full min-h-[500px] p-3 bg-[hsl(var(--surface-1))] text-foreground font-mono text-sm border border-border/50 rounded-md resize-none focus:outline-none focus:border-primary/30 leading-relaxed" placeholder={t('editPlaceholder')} />
                      ) : selectedMemoryFile.endsWith('.md') ? (
                        <MarkdownRenderer content={memoryContent} onNavigate={navigateToWikiLink} />
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
                      <span className="text-sm font-mono">{t('selectFilePrompt')}</span>
                      <span className="text-xs font-mono mt-1 text-muted-foreground/20">{t('orSwitchView')}</span>
                    </div>
                  )}
                </div>
              </div>
              {linksOpen && selectedMemoryFile && typedFileLinks && (
                <LinksSidebar fileLinks={typedFileLinks} onNavigate={loadFileContent} />
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
