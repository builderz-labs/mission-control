'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type ViewMode, type SortField } from './types'
import { IconUpload, IconSearch, IconGrid, IconList, IconBrain, IconLoader } from './icons'

interface PanelHeaderProps {
  uploading: boolean
  search: string
  viewMode: ViewMode
  sortField: SortField
  onRefresh: () => void
  onUpload: () => void
  onSearchChange: (q: string) => void
  onViewModeChange: (m: ViewMode) => void
  onSortChange: (s: SortField) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function PanelHeader({
  uploading, search, viewMode, sortField,
  onRefresh, onUpload, onSearchChange, onViewModeChange, onSortChange,
  fileInputRef, onFileSelected,
}: PanelHeaderProps): React.JSX.Element {
  return (
    <>
      {/* Title row */}
      <div className="flex-shrink-0 border-b border-border px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2.5">
              <IconBrain className="text-[hsl(var(--void-violet))]" />
              Knowledge Base
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Neural document repository — indexed for semantic retrieval by Jarvis
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".txt,.md,.json,.csv,.pdf,.py,.js,.ts,.tsx,.html,.xml,.yaml,.yml,.log,.sql,.sh,.css"
              onChange={onFileSelected}
            />
            <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh documents">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
              </svg>
            </Button>
            <Button onClick={onUpload} disabled={uploading}>
              {uploading ? <IconLoader /> : <IconUpload />}
              {uploading ? 'Indexing...' : 'Upload Document'}
            </Button>
          </div>
        </div>
      </div>

      {/* Search + view toggle toolbar */}
      <div className="flex items-center gap-3 px-6 pt-4">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search documents..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--void-cyan))]/30 placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => onViewModeChange('grid')}
            className={cn('p-2 transition-colors', viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            <IconGrid />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={cn('p-2 transition-colors', viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            <IconList />
          </button>
        </div>
        <select
          value={sortField}
          onChange={e => onSortChange(e.target.value as SortField)}
          className="h-9 px-2 rounded-lg border border-border bg-card text-foreground text-xs focus:outline-none"
        >
          <option value="created_at">Newest</option>
          <option value="filename">Name</option>
          <option value="domain">Domain</option>
          <option value="file_size">Size</option>
        </select>
      </div>
    </>
  )
}
