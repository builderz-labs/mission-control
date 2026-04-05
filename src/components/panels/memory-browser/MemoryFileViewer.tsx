'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Loader } from '@/components/ui/loader'
import { MarkdownRenderer } from './MarkdownRenderer'
import { LinksSidebar } from './LinksSidebar'
import type { FileLinks } from './types'

interface MemoryFileViewerProps {
  isLoading: boolean
  selectedMemoryFile: string
  memoryContent: string | null
  isEditing: boolean
  editedContent: string
  isSaving: boolean
  schemaWarnings: string[]
  linksOpen: boolean
  typedFileLinks: FileLinks | null
  onToggleLinks: () => void
  onStartEdit: () => void
  onSave: () => void
  onCancelEdit: () => void
  onDeleteRequest: () => void
  onClose: () => void
  onEditedContentChange: (content: string) => void
  onNavigate: (target: string) => void
}

export function MemoryFileViewer({
  isLoading,
  selectedMemoryFile,
  memoryContent,
  isEditing,
  editedContent,
  isSaving,
  schemaWarnings,
  linksOpen,
  typedFileLinks,
  onToggleLinks,
  onStartEdit,
  onSave,
  onCancelEdit,
  onDeleteRequest,
  onClose,
  onEditedContentChange,
  onNavigate,
}: MemoryFileViewerProps): React.ReactElement {
  const t = useTranslations('memoryBrowser')

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        {selectedMemoryFile && (
          <FileToolbar
            selectedMemoryFile={selectedMemoryFile}
            memoryContent={memoryContent}
            isEditing={isEditing}
            isSaving={isSaving}
            linksOpen={linksOpen}
            onToggleLinks={onToggleLinks}
            onStartEdit={onStartEdit}
            onSave={onSave}
            onCancelEdit={onCancelEdit}
            onDeleteRequest={onDeleteRequest}
            onClose={onClose}
          />
        )}
        {schemaWarnings.length > 0 && (
          <SchemaWarnings warnings={schemaWarnings} t={t} />
        )}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full"><Loader variant="inline" /></div>
          ) : memoryContent != null && selectedMemoryFile ? (
            <div className="p-6 max-w-3xl">
              <FileContentDisplay
                selectedMemoryFile={selectedMemoryFile}
                memoryContent={memoryContent}
                isEditing={isEditing}
                editedContent={editedContent}
                onEditedContentChange={onEditedContentChange}
                onNavigate={onNavigate}
                t={t}
              />
            </div>
          ) : (
            <EmptyFileState t={t} />
          )}
        </div>
      </div>
      {linksOpen && selectedMemoryFile && typedFileLinks && (
        <LinksSidebar fileLinks={typedFileLinks} onNavigate={onNavigate} />
      )}
    </div>
  )
}

interface FileToolbarProps {
  selectedMemoryFile: string
  memoryContent: string | null
  isEditing: boolean
  isSaving: boolean
  linksOpen: boolean
  onToggleLinks: () => void
  onStartEdit: () => void
  onSave: () => void
  onCancelEdit: () => void
  onDeleteRequest: () => void
  onClose: () => void
}

function FileToolbar({
  selectedMemoryFile,
  memoryContent,
  isEditing,
  isSaving,
  linksOpen,
  onToggleLinks,
  onStartEdit,
  onSave,
  onCancelEdit,
  onDeleteRequest,
  onClose,
}: FileToolbarProps): React.ReactElement {
  const t = useTranslations('memoryBrowser')

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-[hsl(var(--surface-0))]">
      <span className="text-xs font-mono text-muted-foreground/60 truncate flex-1">{selectedMemoryFile}</span>
      {memoryContent != null && (
        <span className="text-[10px] font-mono text-muted-foreground/30 tabular-nums shrink-0">{memoryContent.length} chars</span>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleLinks}
          className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${linksOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]'}`}
          title={t('toggleBacklinks')}
        >{t('links')}</button>
        {!isEditing ? (
          <>
            <button onClick={onStartEdit} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">{t('edit')}</button>
            <button onClick={onDeleteRequest} className="px-2 py-0.5 text-[11px] font-mono text-red-400/60 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors">{t('delete')}</button>
          </>
        ) : (
          <>
            <button onClick={onSave} disabled={isSaving} className="px-2 py-0.5 text-[11px] font-mono text-green-400/80 hover:text-green-400 rounded hover:bg-green-500/10 transition-colors">{isSaving ? t('saving') : t('save')}</button>
            <button onClick={onCancelEdit} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">{t('cancel')}</button>
          </>
        )}
        <button onClick={onClose} className="px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground/40 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors">x</button>
      </div>
    </div>
  )
}

interface SchemaWarningsProps {
  warnings: string[]
  t: ReturnType<typeof useTranslations<'memoryBrowser'>>
}

function SchemaWarnings({ warnings, t }: SchemaWarningsProps): React.ReactElement {
  return (
    <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/15">
      <div className="text-[11px] font-mono text-amber-400">{t('schemaWarnings')}</div>
      {warnings.map((w, i) => (
        <div key={i} className="text-[11px] font-mono text-amber-400/70 ml-2">- {w}</div>
      ))}
    </div>
  )
}

interface FileContentDisplayProps {
  selectedMemoryFile: string
  memoryContent: string
  isEditing: boolean
  editedContent: string
  onEditedContentChange: (content: string) => void
  onNavigate: (target: string) => void
  t: ReturnType<typeof useTranslations<'memoryBrowser'>>
}

function FileContentDisplay({
  selectedMemoryFile,
  memoryContent,
  isEditing,
  editedContent,
  onEditedContentChange,
  onNavigate,
  t,
}: FileContentDisplayProps): React.ReactElement {
  if (isEditing) {
    return (
      <textarea
        value={editedContent}
        onChange={(e) => onEditedContentChange(e.target.value)}
        className="w-full min-h-[500px] p-3 bg-[hsl(var(--surface-1))] text-foreground font-mono text-sm border border-border/50 rounded-md resize-none focus:outline-none focus:border-primary/30 leading-relaxed"
        placeholder={t('editPlaceholder')}
      />
    )
  }
  if (selectedMemoryFile.endsWith('.md')) {
    return <MarkdownRenderer content={memoryContent} onNavigate={onNavigate} />
  }
  if (selectedMemoryFile.endsWith('.json')) {
    const formatted = (() => { try { return JSON.stringify(JSON.parse(memoryContent), null, 2) } catch { return memoryContent } })()
    return (
      <pre className="text-sm font-mono overflow-auto whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">
        <code>{formatted}</code>
      </pre>
    )
  }
  return (
    <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">{memoryContent}</pre>
  )
}

interface EmptyFileStateProps {
  t: ReturnType<typeof useTranslations<'memoryBrowser'>>
}

function EmptyFileState({ t }: EmptyFileStateProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
      <span className="text-4xl font-mono mb-3">/</span>
      <span className="text-sm font-mono">{t('selectFilePrompt')}</span>
      <span className="text-xs font-mono mt-1 text-muted-foreground/20">{t('orSwitchView')}</span>
    </div>
  )
}
