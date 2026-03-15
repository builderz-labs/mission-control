'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import type { MemoryFile, ActiveTab, SearchResult } from './types'

const log = createClientLogger('MemoryBrowser')

export function useMemoryFiles() {
  const {
    memoryFiles,
    selectedMemoryFile,
    memoryContent,
    dashboardMode,
    setMemoryFiles,
    setSelectedMemoryFile,
    setMemoryContent,
  } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  const [isLoading, setIsLoading] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('all')

  const loadFileTree = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/memory?action=tree')
      const data = await response.json()
      setMemoryFiles(data.tree || [])

      // Auto-expand some common directories
      setExpandedFolders(new Set(['daily', 'knowledge', 'memory', 'knowledge-base']))
    } catch (error) {
      log.error('Failed to load file tree:', error)
    } finally {
      setIsLoading(false)
    }
  }, [setMemoryFiles])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const getFilteredFiles = useCallback((): MemoryFile[] => {
    if (activeTab === 'all') return memoryFiles

    const tabPrefixes = activeTab === 'daily'
      ? ['daily/', 'memory/']
      : ['knowledge/', 'knowledge-base/']

    return memoryFiles.filter((file) => {
      const normalizedPath = `${file.path.replace(/\\/g, '/')}/`
      return tabPrefixes.some((prefix) => normalizedPath.startsWith(prefix))
    })
  }, [activeTab, memoryFiles])

  const loadFileContent = useCallback(async (filePath: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/memory?action=content&path=${encodeURIComponent(filePath)}`)
      const data = await response.json()

      if (data.content !== undefined) {
        setSelectedMemoryFile(filePath)
        setMemoryContent(data.content)
      } else {
        alert(data.error || 'Failed to load file content')
      }
    } catch (error) {
      log.error('Failed to load file content:', error)
      alert('Network error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [setSelectedMemoryFile, setMemoryContent])

  const searchFiles = useCallback(async () => {
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
  }, [searchQuery])

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const newExpanded = new Set(prev)
      if (newExpanded.has(folderPath)) {
        newExpanded.delete(folderPath)
      } else {
        newExpanded.add(folderPath)
      }
      return newExpanded
    })
  }, [])

  const startEditing = useCallback(() => {
    setIsEditing(true)
    setEditedContent(memoryContent ?? '')
  }, [memoryContent])

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setEditedContent('')
  }, [])

  const saveFile = useCallback(async () => {
    if (!selectedMemoryFile) return

    setIsSaving(true)
    try {
      const response = await fetch(`/api/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          path: selectedMemoryFile,
          content: editedContent,
        }),
      })

      const data = await response.json()
      if (data.success) {
        setMemoryContent(editedContent)
        setIsEditing(false)
        setEditedContent('')
        // Refresh file tree to update file sizes
        loadFileTree()
      } else {
        alert(data.error || 'Failed to save file')
      }
    } catch (error) {
      log.error('Failed to save file:', error)
      alert('Network error occurred')
    } finally {
      setIsSaving(false)
    }
  }, [selectedMemoryFile, editedContent, setMemoryContent, loadFileTree])

  const createNewFile = useCallback(async (filePath: string, content: string = '') => {
    try {
      const response = await fetch(`/api/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          path: filePath,
          content,
        }),
      })

      const data = await response.json()
      if (data.success) {
        loadFileTree()
        loadFileContent(filePath)
      } else {
        alert(data.error || 'Failed to create file')
      }
    } catch (error) {
      log.error('Failed to create file:', error)
      alert('Network error occurred')
    }
  }, [loadFileTree, loadFileContent])

  const deleteFile = useCallback(async () => {
    if (!selectedMemoryFile) return

    try {
      const response = await fetch(`/api/memory`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          path: selectedMemoryFile,
        }),
      })

      const data = await response.json()
      if (data.success) {
        setSelectedMemoryFile('')
        setMemoryContent('')
        setShowDeleteConfirm(false)
        loadFileTree()
      } else {
        alert(data.error || 'Failed to delete file')
      }
    } catch (error) {
      log.error('Failed to delete file:', error)
      alert('Network error occurred')
    }
  }, [selectedMemoryFile, setSelectedMemoryFile, setMemoryContent, loadFileTree])

  const closeFile = useCallback(() => {
    setSelectedMemoryFile('')
    setMemoryContent('')
    setIsEditing(false)
    setEditedContent('')
  }, [setSelectedMemoryFile, setMemoryContent])

  return {
    // Store state
    memoryFiles,
    selectedMemoryFile,
    memoryContent,
    isLocal,

    // Local state
    isLoading,
    expandedFolders,
    searchResults,
    searchQuery,
    isSearching,
    isEditing,
    editedContent,
    showCreateModal,
    showDeleteConfirm,
    isSaving,
    activeTab,

    // State setters
    setSearchQuery,
    setEditedContent,
    setShowCreateModal,
    setShowDeleteConfirm,
    setActiveTab,

    // Actions
    loadFileTree,
    loadFileContent,
    searchFiles,
    toggleFolder,
    startEditing,
    cancelEditing,
    saveFile,
    createNewFile,
    deleteFile,
    closeFile,
    getFilteredFiles,
  }
}

export type UseMemoryFilesReturn = ReturnType<typeof useMemoryFiles>
