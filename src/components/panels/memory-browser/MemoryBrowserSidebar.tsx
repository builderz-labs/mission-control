'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Loader } from '@/components/ui/loader'
import { FileTree } from './FileTree'
import type { FileFilter, SearchResultItem } from './use-memory-browser'

interface MemoryBrowserSidebarProps {
  isLoading: boolean
  searchQuery: string
  searchResults: SearchResultItem[]
  fileFilter: FileFilter
  filteredFiles: Parameters<typeof FileTree>[0]['files']
  selectedPath: string
  expandedFolders: Set<string>
  onSearchQueryChange: (query: string) => void
  onSearch: () => void
  onFileFilterChange: (filter: FileFilter) => void
  onSelectFile: (path: string) => void
  onToggleFolder: (path: string, needsChildren: boolean) => void
  onClearSearchResults: () => void
  onRefresh: () => void
}

export function MemoryBrowserSidebar({
  isLoading,
  searchQuery,
  searchResults,
  fileFilter,
  filteredFiles,
  selectedPath,
  expandedFolders,
  onSearchQueryChange,
  onSearch,
  onFileFilterChange,
  onSelectFile,
  onToggleFolder,
  onClearSearchResults,
  onRefresh,
}: MemoryBrowserSidebarProps): React.ReactElement {
  const t = useTranslations('memoryBrowser')

  return (
    <div className="w-60 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0">
      <div className="p-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder={t('searchPlaceholder')}
          className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder-muted-foreground/40 focus:outline-none focus:border-primary/30"
        />
      </div>
      <FileFilterTabs fileFilter={fileFilter} onFileFilterChange={onFileFilterChange} />
      {searchResults.length > 0 && (
        <SearchResultsList
          searchResults={searchResults}
          onSelectFile={(path) => { onSelectFile(path); onClearSearchResults() }}
        />
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-20"><Loader variant="inline" /></div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center text-muted-foreground/40 text-xs font-mono py-8">{t('noFiles')}</div>
        ) : (
          <FileTree
            files={filteredFiles}
            selectedPath={selectedPath}
            expandedFolders={expandedFolders}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
          />
        )}
      </div>
      <div className="p-2 border-t border-border/50">
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="w-full py-1 text-[11px] font-mono text-muted-foreground/50 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-1))] transition-colors"
        >{t('refresh')}</button>
      </div>
    </div>
  )
}

interface FileFilterTabsProps {
  fileFilter: FileFilter
  onFileFilterChange: (filter: FileFilter) => void
}

function FileFilterTabs({ fileFilter, onFileFilterChange }: FileFilterTabsProps): React.ReactElement {
  return (
    <div className="flex gap-0.5 px-2 pb-2">
      {(['all', 'daily', 'knowledge'] as const).map((f) => (
        <button
          key={f}
          onClick={() => onFileFilterChange(f)}
          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${fileFilter === f ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
        >{f}</button>
      ))}
    </div>
  )
}

interface SearchResultsListProps {
  searchResults: SearchResultItem[]
  onSelectFile: (path: string) => void
}

function SearchResultsList({ searchResults, onSelectFile }: SearchResultsListProps): React.ReactElement {
  const t = useTranslations('memoryBrowser')

  return (
    <div className="px-2 pb-2 border-b border-border/50">
      <div className="text-[10px] text-muted-foreground/50 font-mono mb-1">
        {t('searchResults', { count: searchResults.length })}
      </div>
      <div className="max-h-28 overflow-y-auto space-y-px">
        {searchResults.map((r, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            className="flex items-center gap-1.5 py-1 px-1.5 rounded text-xs font-mono cursor-pointer hover:bg-[hsl(var(--surface-2))] text-muted-foreground"
            onClick={() => onSelectFile(r.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectFile(r.path)
              }
            }}
          >
            <span className="truncate flex-1">{r.name}</span>
            <span className="text-[10px] text-muted-foreground/40">{r.matches}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
