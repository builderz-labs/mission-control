'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useMissionControl, type MemoryFile } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { mergeDirectoryChildren, countFiles, totalSize } from './utils'
import type {
  HealthReport, MOCGroup, ProcessingResult, HermesMemoryData, FileLinks,
  ActiveView, FileFilter, SearchResultItem, UseMemoryBrowserReturn,
} from './types'

const log = createClientLogger('MemoryBrowser')

// Re-export types for sibling components that import from this module
export type {
  HealthReport, MOCGroup, ProcessingResult, HermesMemoryData, FileLinks,
  ActiveView, FileFilter, SearchResultItem, UseMemoryBrowserReturn,
}

/** Recursively searches the file tree for a matching file path by stem, name, or .md extension. */
function findFileByWikiTarget(files: MemoryFile[], target: string): string | null {
  for (const f of files) {
    if (f.type === 'file') {
      const stem = f.name.replace(/\.[^.]+$/, '')
      if (stem === target || f.name === target || f.name === `${target}.md`) return f.path
    }
    if (f.children) {
      const found = findFileByWikiTarget(f.children, target)
      if (found) return found
    }
  }
  return null
}

export function useMemoryBrowser(): UseMemoryBrowserReturn {
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
    setMemoryHealth,
  } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeView, setActiveView] = useState<ActiveView>(!isLocal ? 'graph' : 'files')
  const [hermesMemory, setHermesMemory] = useState<HermesMemoryData | null>(null)
  const [hermesInstalled, setHermesInstalled] = useState<boolean | null>(null)
  const [isLoadingHermes, setIsLoadingHermes] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [fileFilter, setFileFilter] = useState<FileFilter>('all')
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

  const loadFileTree = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchTree({ depth: 1 })
      setMemoryFiles(data.tree || [])
      setExpandedFolders(new Set(['daily', 'knowledge', 'memory', 'knowledge-base']))
      setIsHydratingTree(true)
      void fetchTree()
        .then((fullData) => { setMemoryFiles(fullData.tree || []) })
        .catch((err) => { log.error('Failed to hydrate full file tree:', err) })
        .finally(() => { setIsHydratingTree(false) })
    } catch (err) {
      log.error('Failed to load file tree:', err)
      setError('Failed to load memory files. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [fetchTree, setMemoryFiles])

  useEffect(() => { loadFileTree() }, [loadFileTree])

  const loadFileContent = useCallback(async (filePath: string): Promise<void> => {
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
          setMemoryFileLinks({ wikiLinks: data.wikiLinks, incoming: [], outgoing: [] })
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
  }, [activeView, setMemoryContent, setMemoryFileLinks, setSelectedMemoryFile])

  const searchFiles = useCallback(async (): Promise<void> => {
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
  }, [searchQuery])

  const toggleFolder = useCallback(async (folderPath: string, needsChildren: boolean): Promise<void> => {
    if (!expandedFolders.has(folderPath) && needsChildren) {
      try {
        const data = await fetchTree({ path: folderPath, depth: 1 })
        setMemoryFiles(mergeDirectoryChildren(memoryFilesRef.current, folderPath, data.tree || []))
      } catch (err) {
        log.error('Failed to load folder children:', err)
      }
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }, [expandedFolders, fetchTree, setMemoryFiles])

  const saveFile = useCallback(async (): Promise<void> => {
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
        void loadFileTree()
      }
    } catch (err) {
      log.error('Failed to save file:', err)
    } finally {
      setIsSaving(false)
    }
  }, [editedContent, loadFileTree, selectedMemoryFile, setMemoryContent])

  const createNewFile = useCallback(async (filePath: string, content: string = ''): Promise<void> => {
    try {
      const response = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', path: filePath, content }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json()
      if (data.success) {
        void loadFileTree()
        void loadFileContent(filePath)
      }
    } catch (err) {
      log.error('Failed to create file:', err)
    }
  }, [loadFileContent, loadFileTree])

  const deleteFile = useCallback(async (): Promise<void> => {
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
        void loadFileTree()
      }
    } catch (err) {
      log.error('Failed to delete file:', err)
    }
  }, [loadFileTree, selectedMemoryFile, setMemoryContent, setMemoryFileLinks, setSelectedMemoryFile])

  const loadHealth = useCallback(async (): Promise<void> => {
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
    if (activeView === 'health' && !healthReport) void loadHealth()
  }, [activeView, healthReport, loadHealth])

  useEffect(() => {
    if (hermesInstalled === null) {
      fetch('/api/hermes')
        .then(r => r.json())
        .then(d => setHermesInstalled(d.installed === true))
        .catch(() => setHermesInstalled(false))
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

  const runPipelineAction = useCallback(async (action: string): Promise<void> => {
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
      if (action === 'generate-moc') setMocGroups(data.groups || [])
      else setPipelineResult(data)
    } catch (err) {
      log.error('Pipeline action failed:', err)
    } finally {
      setIsRunningPipeline(false)
    }
  }, [])

  const filteredFiles = useMemo((): MemoryFile[] => {
    if (fileFilter === 'all') return memoryFiles
    const prefixes = fileFilter === 'daily' ? ['daily/', 'memory/'] : ['knowledge/', 'knowledge-base/']
    return memoryFiles.filter((file) => {
      const p = `${file.path.replace(/\\/g, '/')}/`
      return prefixes.some((prefix) => p.startsWith(prefix))
    })
  }, [memoryFiles, fileFilter])

  const fileCount = useMemo(() => countFiles(memoryFiles), [memoryFiles])
  const sizeTotal = useMemo(() => totalSize(memoryFiles), [memoryFiles])

  const navigateToWikiLink = useCallback((target: string): void => {
    const found = findFileByWikiTarget(memoryFiles, target)
    if (found) void loadFileContent(found)
  }, [loadFileContent, memoryFiles])

  // Clears the currently selected file from both local and store state
  const closeFile = useCallback((): void => {
    setSelectedMemoryFile('')
    setMemoryContent('')
    setMemoryFileLinks(null)
    setIsEditing(false)
    setEditedContent('')
    setSchemaWarnings([])
    setLinksOpen(false)
  }, [setMemoryContent, setMemoryFileLinks, setSelectedMemoryFile])

  // Resets hermes memory so the effect re-fetches it
  const refreshHermes = useCallback((): void => {
    setHermesMemory(null)
    setIsLoadingHermes(false)
  }, [])

  return {
    // Store-derived
    selectedMemoryFile: selectedMemoryFile ?? '',
    memoryContent: memoryContent ?? null,
    // Local state
    isLoading, error, expandedFolders, searchResults, searchQuery, isSearching,
    isEditing, editedContent, showCreateModal, showDeleteConfirm, isSaving,
    activeView, hermesMemory, hermesInstalled, isLoadingHermes, sidebarOpen,
    fileFilter, schemaWarnings, linksOpen, healthReport, isLoadingHealth,
    pipelineResult, mocGroups, isRunningPipeline, isHydratingTree,
    // Derived
    filteredFiles, fileCount, sizeTotal, typedFileLinks: memoryFileLinks as FileLinks | null,
    // Setters
    setError, setSearchQuery, setIsEditing, setEditedContent, setShowCreateModal,
    setShowDeleteConfirm, setSidebarOpen, setFileFilter, setLinksOpen, setActiveView,
    setSearchResults,
    // Async actions
    loadFileTree, loadFileContent, searchFiles, toggleFolder, saveFile,
    createNewFile, deleteFile, loadHealth, runPipelineAction, navigateToWikiLink,
    // Composite actions
    closeFile, refreshHermes,
  }
}
