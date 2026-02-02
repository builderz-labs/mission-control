'use client'

import React, { useState, useEffect } from 'react'
import { useMissionControl } from '@/store'

interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

export function MemoryBrowserPanel() {
  const { 
    memoryFiles, 
    selectedMemoryFile, 
    memoryContent,
    setMemoryFiles, 
    setSelectedMemoryFile, 
    setMemoryContent 
  } = useMissionControl()

  const [isLoading, setIsLoading] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'daily' | 'knowledge' | 'all'>('all')

  useEffect(() => {
    loadFileTree()
  }, [])

  const getFilteredFiles = () => {
    if (activeTab === 'all') return memoryFiles
    
    return memoryFiles.filter(file => {
      if (activeTab === 'daily') {
        return file.name === 'daily' || file.path.includes('daily/')
      }
      if (activeTab === 'knowledge') {
        return file.name === 'knowledge' || file.path.includes('knowledge/')
      }
      return true
    })
  }

  const loadFileTree = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/memory?action=tree')
      const data = await response.json()
      setMemoryFiles(data.tree || [])
      
      // Auto-expand some common directories
      setExpandedFolders(new Set(['daily', 'knowledge']))
    } catch (error) {
      console.error('Failed to load file tree:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadFileContent = async (filePath: string) => {
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
      console.error('Failed to load file content:', error)
      alert('Network error occurred')
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
      console.error('Search failed:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const toggleFolder = (folderPath: string) => {
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(folderPath)) {
      newExpanded.delete(folderPath)
    } else {
      newExpanded.add(folderPath)
    }
    setExpandedFolders(newExpanded)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  // Enhanced editing functionality
  const startEditing = () => {
    setIsEditing(true)
    setEditedContent(memoryContent)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditedContent('')
  }

  const saveFile = async () => {
    if (!selectedMemoryFile) return

    setIsSaving(true)
    try {
      const response = await fetch(`/api/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          path: selectedMemoryFile,
          content: editedContent
        })
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
      console.error('Failed to save file:', error)
      alert('Network error occurred')
    } finally {
      setIsSaving(false)
    }
  }

  const createNewFile = async (filePath: string, content: string = '') => {
    try {
      const response = await fetch(`/api/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          path: filePath,
          content
        })
      })

      const data = await response.json()
      if (data.success) {
        loadFileTree()
        loadFileContent(filePath)
      } else {
        alert(data.error || 'Failed to create file')
      }
    } catch (error) {
      console.error('Failed to create file:', error)
      alert('Network error occurred')
    }
  }

  const deleteFile = async () => {
    if (!selectedMemoryFile) return

    try {
      const response = await fetch(`/api/memory`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          path: selectedMemoryFile
        })
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
      console.error('Failed to delete file:', error)
      alert('Network error occurred')
    }
  }

  const renderFileTree = (files: MemoryFile[], level = 0): React.ReactElement[] => {
    return files.map((file) => (
      <div key={file.path} style={{ marginLeft: `${level * 16}px` }}>
        {file.type === 'directory' ? (
          <div>
            <div
              className="flex items-center space-x-2 py-1 px-2 hover:bg-secondary rounded cursor-pointer"
              onClick={() => toggleFolder(file.path)}
            >
              <span className="text-blue-400">
                {expandedFolders.has(file.path) ? '📂' : '📁'}
              </span>
              <span className="text-foreground">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                ({file.children?.length || 0} items)
              </span>
            </div>
            {expandedFolders.has(file.path) && file.children && (
              <div>
                {renderFileTree(file.children, level + 1)}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`flex items-center space-x-2 py-1 px-2 hover:bg-secondary rounded cursor-pointer ${
              selectedMemoryFile === file.path ? 'bg-primary/20 border border-primary/30' : ''
            }`}
            onClick={() => loadFileContent(file.path)}
          >
            <span className="text-gray-400">
              {file.name.endsWith('.md') ? '📄' : 
               file.name.endsWith('.txt') ? '📝' : 
               file.name.endsWith('.json') ? '📋' : '📄'}
            </span>
            <span className="text-foreground flex-1">{file.name}</span>
            <div className="flex flex-col text-xs text-muted-foreground text-right">
              {file.size && <span>{formatFileSize(file.size)}</span>}
              {file.modified && <span>{new Date(file.modified).toLocaleDateString()}</span>}
            </div>
          </div>
        )}
      </div>
    ))
  }

  const renderMarkdown = (content: string) => {
    // Improved markdown rendering with proper line handling
    const lines = content.split('\n')
    const elements: React.ReactElement[] = []
    let inList = false
    let seenHeaders = new Set<string>()
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()
      
      if (trimmedLine.startsWith('# ')) {
        const headerText = trimmedLine.slice(2)
        const headerId = `h1-${headerText.toLowerCase().replace(/\s+/g, '-')}`
        
        // Skip duplicate headers
        if (seenHeaders.has(headerId)) continue
        seenHeaders.add(headerId)
        
        if (inList) inList = false
        elements.push(<h1 key={`${i}-${headerId}`} className="text-2xl font-bold mt-6 mb-3 text-primary">{headerText}</h1>)
      } else if (trimmedLine.startsWith('## ')) {
        const headerText = trimmedLine.slice(3)
        const headerId = `h2-${headerText.toLowerCase().replace(/\s+/g, '-')}`
        
        // Skip duplicate headers
        if (seenHeaders.has(headerId)) continue
        seenHeaders.add(headerId)
        
        if (inList) inList = false
        elements.push(<h2 key={`${i}-${headerId}`} className="text-xl font-semibold mt-5 mb-3 text-foreground">{headerText}</h2>)
      } else if (trimmedLine.startsWith('### ')) {
        const headerText = trimmedLine.slice(4)
        const headerId = `h3-${headerText.toLowerCase().replace(/\s+/g, '-')}`
        
        // Skip duplicate headers
        if (seenHeaders.has(headerId)) continue
        seenHeaders.add(headerId)
        
        if (inList) inList = false
        elements.push(<h3 key={`${i}-${headerId}`} className="text-lg font-semibold mt-4 mb-2 text-foreground">{headerText}</h3>)
      } else if (trimmedLine.startsWith('- ')) {
        if (inList) inList = false
        elements.push(<li key={`${i}-li`} className="ml-6 mb-1 list-disc">{trimmedLine.slice(2)}</li>)
      } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**') && trimmedLine.length > 4) {
        if (inList) inList = false
        elements.push(<p key={`${i}-bold`} className="font-bold mb-2">{trimmedLine.slice(2, -2)}</p>)
      } else if (trimmedLine === '') {
        if (inList) inList = false
        elements.push(<div key={`${i}-space`} className="mb-2"></div>)
      } else if (trimmedLine.length > 0) {
        if (inList) inList = false
        // Handle inline formatting
        let content = trimmedLine
        // Simple bold formatting
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Simple italic formatting  
        content = content.replace(/\*(.*?)\*/g, '<em>$1</em>')
        
        elements.push(
          <p key={`${i}-p`} className="mb-2" dangerouslySetInnerHTML={{ __html: content }}></p>
        )
      }
    }
    
    return elements
  }

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">Memory Browser</h1>
        <p className="text-muted-foreground mt-2">
          Explore ClawdBot's knowledge files and memory structure
        </p>
        
        {/* Tab Navigation */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              activeTab === 'all' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            📁 All Files
          </button>
          <button
            onClick={() => setActiveTab('daily')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              activeTab === 'daily' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            📅 Daily Logs
          </button>
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              activeTab === 'knowledge' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            🧠 Knowledge
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex space-x-4">
          <div className="flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchFiles()}
              placeholder="Search in memory files..."
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <button
            onClick={searchFiles}
            disabled={isSearching || !searchQuery.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
          <button
            onClick={loadFileTree}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="font-medium text-foreground mb-2">Search Results ({searchResults.length})</h3>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-secondary rounded cursor-pointer hover:bg-secondary/80"
                  onClick={() => loadFileContent(result.path)}
                >
                  <div>
                    <span className="font-medium text-foreground">{result.name}</span>
                    <span className="text-sm text-muted-foreground ml-2">({result.path})</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {result.matches} matches
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* File Tree */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Memory Structure</h2>
          
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span className="ml-3 text-muted-foreground">Loading...</span>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto text-sm">
              {getFilteredFiles().length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {activeTab === 'all' ? 'No memory files found' : 
                   activeTab === 'daily' ? 'No daily logs found' : 
                   'No knowledge files found'}
                </div>
              ) : (
                renderFileTree(getFilteredFiles())
              )}
            </div>
          )}
        </div>

        {/* File Content */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              {selectedMemoryFile || 'File Content'}
            </h2>
            <div className="flex items-center gap-2">
              {selectedMemoryFile && (
                <>
                  {!isEditing ? (
                    <>
                      <button
                        onClick={startEditing}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={saveFile}
                        disabled={isSaving}
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setSelectedMemoryFile('')
                      setMemoryContent('')
                      setIsEditing(false)
                      setEditedContent('')
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Close
                  </button>
                </>
              )}
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90 transition-colors"
              >
                + New File
              </button>
            </div>
          </div>
          
          <div className="border border-border rounded-lg min-h-96 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                <span className="ml-3 text-muted-foreground">Loading file...</span>
              </div>
            ) : memoryContent !== null ? (
              <div className="p-4 w-full">
                {isEditing ? (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full min-h-[500px] p-3 bg-gray-900 text-white font-mono text-sm border border-gray-600 rounded resize-none focus:border-blue-500"
                    placeholder="Edit file content..."
                  />
                ) : selectedMemoryFile?.endsWith('.md') ? (
                  <div className="prose prose-invert max-w-none w-full">
                    <div className="mb-4 text-sm text-muted-foreground">
                      File: {selectedMemoryFile} | Size: {memoryContent.length} chars
                    </div>
                    <div className="whitespace-pre-wrap break-words">
                      {renderMarkdown(memoryContent)}
                    </div>
                  </div>
                ) : selectedMemoryFile?.endsWith('.json') ? (
                  <div>
                    <div className="mb-4 text-sm text-muted-foreground">
                      File: {selectedMemoryFile} | Size: {memoryContent.length} chars
                    </div>
                    <pre className="text-sm overflow-auto whitespace-pre-wrap break-words">
                      <code>{JSON.stringify(JSON.parse(memoryContent), null, 2)}</code>
                    </pre>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4 text-sm text-muted-foreground">
                      File: {selectedMemoryFile} | Size: {memoryContent.length} chars
                    </div>
                    <pre className="text-sm whitespace-pre-wrap break-words overflow-auto">
                      {memoryContent}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <span>Select a file to view its content</span>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                >
                  Create New File
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* File Stats */}
      {memoryFiles.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Memory Statistics</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-secondary rounded p-4">
              <div className="text-2xl font-bold text-foreground">
                {memoryFiles.reduce((count, dir) => {
                  const countFiles = (files: MemoryFile[]): number => {
                    return files.reduce((acc, file) => {
                      if (file.type === 'file') return acc + 1
                      return acc + countFiles(file.children || [])
                    }, 0)
                  }
                  return count + countFiles([dir])
                }, 0)}
              </div>
              <div className="text-sm text-muted-foreground">Total Files</div>
            </div>

            <div className="bg-secondary rounded p-4">
              <div className="text-2xl font-bold text-foreground">
                {memoryFiles.reduce((count, dir) => {
                  const countDirs = (files: MemoryFile[]): number => {
                    return files.reduce((acc, file) => {
                      if (file.type === 'directory') return acc + 1 + countDirs(file.children || [])
                      return acc
                    }, 0)
                  }
                  return count + countDirs([dir])
                }, 0)}
              </div>
              <div className="text-sm text-muted-foreground">Directories</div>
            </div>

            <div className="bg-secondary rounded p-4">
              <div className="text-2xl font-bold text-foreground">
                {formatFileSize(memoryFiles.reduce((size, dir) => {
                  const calculateSize = (files: MemoryFile[]): number => {
                    return files.reduce((acc, file) => {
                      if (file.type === 'file' && file.size) return acc + file.size
                      return acc + calculateSize(file.children || [])
                    }, 0)
                  }
                  return size + calculateSize([dir])
                }, 0))}
              </div>
              <div className="text-sm text-muted-foreground">Total Size</div>
            </div>
          </div>
        </div>
      )}

      {/* Create File Modal */}
      {showCreateModal && (
        <CreateFileModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createNewFile}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedMemoryFile && (
        <DeleteConfirmModal
          fileName={selectedMemoryFile}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={deleteFile}
        />
      )}
    </div>
  )
}

// Create File Modal Component
function CreateFileModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (path: string, content: string) => void
}) {
  const [fileName, setFileName] = useState('')
  const [filePath, setFilePath] = useState('knowledge/')
  const [initialContent, setInitialContent] = useState('')
  const [fileType, setFileType] = useState('md')

  const handleCreate = () => {
    if (!fileName.trim()) {
      alert('Please enter a file name')
      return
    }

    const fullPath = filePath + fileName + '.' + fileType
    onCreate(fullPath, initialContent)
    onClose()
  }

  const fileTypesWithTemplates = {
    md: '# New Document\n\n## Overview\n\n## Details\n\n',
    json: '{\n  "name": "",\n  "description": "",\n  "data": {}\n}',
    txt: '',
    log: `[${new Date().toISOString()}] Log entry\n`
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">Create New File</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        <div className="space-y-4">
          {/* File Path */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Directory Path
            </label>
            <select
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-blue-500"
            >
              <option value="knowledge/">knowledge/</option>
              <option value="daily/">daily/</option>
              <option value="logs/">logs/</option>
              <option value="reference/">reference/</option>
              <option value="templates/">templates/</option>
              <option value="">root/</option>
            </select>
          </div>

          {/* File Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              File Name
            </label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="my-new-file"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-blue-500"
            />
          </div>

          {/* File Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              File Type
            </label>
            <select
              value={fileType}
              onChange={(e) => {
                setFileType(e.target.value)
                setInitialContent(fileTypesWithTemplates[e.target.value as keyof typeof fileTypesWithTemplates] || '')
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-blue-500"
            >
              <option value="md">Markdown (.md)</option>
              <option value="json">JSON (.json)</option>
              <option value="txt">Text (.txt)</option>
              <option value="log">Log (.log)</option>
            </select>
          </div>

          {/* Initial Content */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Initial Content (optional)
            </label>
            <textarea
              value={initialContent}
              onChange={(e) => setInitialContent(e.target.value)}
              className="w-full h-24 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:border-blue-500 resize-none font-mono text-sm"
              placeholder="Template content will be auto-filled..."
            />
          </div>

          {/* Preview Path */}
          <div className="bg-gray-700 p-3 rounded text-sm text-gray-300">
            <strong>Full Path:</strong> {filePath}{fileName}.{fileType}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleCreate}
              disabled={!fileName.trim()}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create File
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Delete Confirmation Modal Component
function DeleteConfirmModal({
  fileName,
  onClose,
  onConfirm
}: {
  fileName: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-red-400">Confirm Deletion</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        <div className="space-y-4">
          <div className="bg-red-900/30 border border-red-600 text-red-400 p-4 rounded">
            <p className="text-sm">
              ⚠️ You are about to permanently delete:
            </p>
            <p className="font-mono text-white mt-2 bg-gray-900 p-2 rounded">
              {fileName}
            </p>
            <p className="text-xs mt-2 text-red-300">
              This action cannot be undone.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Delete Permanently
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}