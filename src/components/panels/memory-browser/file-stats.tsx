'use client'

import React from 'react'
import type { MemoryFile } from './types'

interface FileStatsProps {
  memoryFiles: MemoryFile[]
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function countFiles(files: MemoryFile[]): number {
  return files.reduce((acc, file) => {
    if (file.type === 'file') return acc + 1
    return acc + countFiles(file.children || [])
  }, 0)
}

function countDirs(files: MemoryFile[]): number {
  return files.reduce((acc, file) => {
    if (file.type === 'directory') return acc + 1 + countDirs(file.children || [])
    return acc
  }, 0)
}

function calculateSize(files: MemoryFile[]): number {
  return files.reduce((acc, file) => {
    if (file.type === 'file' && file.size) return acc + file.size
    return acc + calculateSize(file.children || [])
  }, 0)
}

export function FileStats({ memoryFiles }: FileStatsProps) {
  if (memoryFiles.length === 0) return null

  const totalFiles = memoryFiles.reduce((count, dir) => count + countFiles([dir]), 0)
  const totalDirs = memoryFiles.reduce((count, dir) => count + countDirs([dir]), 0)
  const totalSize = memoryFiles.reduce((size, dir) => size + calculateSize([dir]), 0)

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Memory Statistics</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-secondary rounded p-4">
          <div className="text-2xl font-bold text-foreground">{totalFiles}</div>
          <div className="text-sm text-muted-foreground">Total Files</div>
        </div>

        <div className="bg-secondary rounded p-4">
          <div className="text-2xl font-bold text-foreground">{totalDirs}</div>
          <div className="text-sm text-muted-foreground">Directories</div>
        </div>

        <div className="bg-secondary rounded p-4">
          <div className="text-2xl font-bold text-foreground">{formatFileSize(totalSize)}</div>
          <div className="text-sm text-muted-foreground">Total Size</div>
        </div>
      </div>
    </div>
  )
}
