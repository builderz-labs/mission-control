'use client'

import React from 'react'
import type { MemoryFile } from './types'

interface FileTreeProps {
  files: MemoryFile[]
  selectedFile: string | null
  expandedFolders: Set<string>
  isLoading: boolean
  activeTab: 'daily' | 'knowledge' | 'all'
  onToggleFolder: (folderPath: string) => void
  onSelectFile: (filePath: string) => void
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function FileTreeNode({
  file,
  level,
  selectedFile,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
}: {
  file: MemoryFile
  level: number
  selectedFile: string | null
  expandedFolders: Set<string>
  onToggleFolder: (folderPath: string) => void
  onSelectFile: (filePath: string) => void
}) {
  if (file.type === 'directory') {
    return (
      <div style={{ marginLeft: `${level * 16}px` }}>
        <div>
          <div
            className="flex items-center space-x-2 py-1 px-2 hover:bg-secondary rounded cursor-pointer"
            onClick={() => onToggleFolder(file.path)}
          >
            <span className="text-blue-400">
              {expandedFolders.has(file.path) ? '\uD83D\uDCC2' : '\uD83D\uDCC1'}
            </span>
            <span className="text-foreground">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              ({file.children?.length || 0} items)
            </span>
          </div>
          {expandedFolders.has(file.path) && file.children && (
            <div>
              {file.children.map((child) => (
                <FileTreeNode
                  key={child.path}
                  file={child}
                  level={level + 1}
                  selectedFile={selectedFile}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginLeft: `${level * 16}px` }}>
      <div
        className={`flex items-center space-x-2 py-1 px-2 hover:bg-secondary rounded cursor-pointer ${
          selectedFile === file.path ? 'bg-primary/20 border border-primary/30' : ''
        }`}
        onClick={() => onSelectFile(file.path)}
      >
        <span className="text-muted-foreground">
          {file.name.endsWith('.md') ? '\uD83D\uDCC4' :
           file.name.endsWith('.txt') ? '\uD83D\uDCDD' :
           file.name.endsWith('.json') ? '\uD83D\uDCCB' : '\uD83D\uDCC4'}
        </span>
        <span className="text-foreground flex-1">{file.name}</span>
        <div className="flex flex-col text-xs text-muted-foreground text-right">
          {file.size && <span>{formatFileSize(file.size)}</span>}
          {file.modified && <span>{new Date(file.modified).toLocaleDateString()}</span>}
        </div>
      </div>
    </div>
  )
}

export function FileTree({
  files,
  selectedFile,
  expandedFolders,
  isLoading,
  activeTab,
  onToggleFolder,
  onSelectFile,
}: FileTreeProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Memory Structure</h2>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          <span className="ml-3 text-muted-foreground">Loading...</span>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto text-sm">
          {files.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {activeTab === 'all' ? 'No memory files found' :
               activeTab === 'daily' ? 'No daily logs found' :
               'No knowledge files found'}
            </div>
          ) : (
            files.map((file) => (
              <FileTreeNode
                key={file.path}
                file={file}
                level={0}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
