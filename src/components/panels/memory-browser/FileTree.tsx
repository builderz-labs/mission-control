'use client'

import React from 'react'
import type { MemoryFile } from './types'
import { fileIcon, formatFileSize } from './utils'

interface FileTreeProps {
  files: MemoryFile[]
  selectedPath: string
  expandedFolders: Set<string>
  onSelectFile: (path: string) => void
  onToggleFolder: (path: string, needsChildren: boolean) => void
}

export function FileTree({ files, selectedPath, expandedFolders, onSelectFile, onToggleFolder }: FileTreeProps) {
  return <>{renderTree(files, 0, selectedPath, expandedFolders, onSelectFile, onToggleFolder)}</>
}

function renderTree(
  files: MemoryFile[],
  depth: number,
  selectedPath: string,
  expandedFolders: Set<string>,
  onSelectFile: (path: string) => void,
  onToggleFolder: (path: string, needsChildren: boolean) => void
): React.ReactElement[] {
  return files.map((file) => {
    const isDir = file.type === 'directory'
    const isExpanded = expandedFolders.has(file.path)
    const isSelected = selectedPath === file.path
    return (
      <div key={file.path}>
        <div
          className={`flex items-center gap-1 py-[3px] pr-2 cursor-pointer text-[13px] font-mono hover:bg-[hsl(var(--surface-2))] rounded-sm transition-colors duration-75 ${isSelected ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground'}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => void (isDir ? onToggleFolder(file.path, file.children === undefined) : onSelectFile(file.path))}
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
        {isDir && isExpanded && file.children && (
          <div>{renderTree(file.children, depth + 1, selectedPath, expandedFolders, onSelectFile, onToggleFolder)}</div>
        )}
      </div>
    )
  })
}
