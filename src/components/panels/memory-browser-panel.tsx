'use client'

import React from 'react'
import { MemoryGraph } from './memory-graph'
import { HealthView } from './memory-browser/HealthView'
import { PipelineView } from './memory-browser/PipelineView'
import { HermesMemoryView } from './memory-browser/HermesMemoryView'
import { CreateFileModal, DeleteConfirmModal } from './memory-browser/FileModals'
import { MemoryBrowserTopBar } from './memory-browser/MemoryBrowserTopBar'
import { MemoryBrowserSidebar } from './memory-browser/MemoryBrowserSidebar'
import { MemoryFileViewer } from './memory-browser/MemoryFileViewer'
import { useMemoryBrowser } from './memory-browser/use-memory-browser'
import { useMissionControl } from '@/store'

export function MemoryBrowserPanel(): React.ReactElement {
  const { dashboardMode } = useMissionControl()
  const isLocal = dashboardMode === 'local'
  const mb = useMemoryBrowser()

  const viewTabs = [
    'files',
    ...(!isLocal ? ['graph'] : []),
    'health',
    'pipeline',
    ...(mb.hermesInstalled ? ['hermes'] : []),
  ] as const

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      {mb.error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{mb.error}</span>
          <button
            onClick={() => { mb.setError(null); void mb.loadFileTree() }}
            className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300"
          >Retry</button>
        </div>
      )}

      <MemoryBrowserTopBar
        sidebarOpen={mb.sidebarOpen}
        activeView={mb.activeView}
        viewTabs={viewTabs}
        healthReport={mb.healthReport}
        fileCount={mb.fileCount}
        sizeTotal={mb.sizeTotal}
        isHydratingTree={mb.isHydratingTree}
        onToggleSidebar={() => mb.setSidebarOpen(!mb.sidebarOpen)}
        onChangeView={mb.setActiveView}
        onNewFile={() => mb.setShowCreateModal(true)}
      />

      <div className="flex flex-1 min-h-0">
        {mb.sidebarOpen && (
          <MemoryBrowserSidebar
            isLoading={mb.isLoading}
            searchQuery={mb.searchQuery}
            searchResults={mb.searchResults}
            fileFilter={mb.fileFilter}
            filteredFiles={mb.filteredFiles}
            selectedPath={mb.selectedMemoryFile}
            expandedFolders={mb.expandedFolders}
            onSearchQueryChange={mb.setSearchQuery}
            onSearch={() => void mb.searchFiles()}
            onFileFilterChange={mb.setFileFilter}
            onSelectFile={(path) => void mb.loadFileContent(path)}
            onToggleFolder={(path, needs) => void mb.toggleFolder(path, needs)}
            onClearSearchResults={() => mb.setSearchResults([])}
            onRefresh={() => void mb.loadFileTree()}
          />
        )}

        <div className="flex-1 min-w-0 flex flex-col bg-[hsl(var(--surface-0))]">
          <MainContent mb={mb} isLocal={isLocal} />
        </div>
      </div>

      {mb.showCreateModal && (
        <CreateFileModal
          onClose={() => mb.setShowCreateModal(false)}
          onCreate={(path, content) => void mb.createNewFile(path, content)}
        />
      )}
      {mb.showDeleteConfirm && mb.selectedMemoryFile && (
        <DeleteConfirmModal
          fileName={mb.selectedMemoryFile}
          onClose={() => mb.setShowDeleteConfirm(false)}
          onConfirm={() => void mb.deleteFile()}
        />
      )}
    </div>
  )
}

interface MainContentProps {
  mb: ReturnType<typeof useMemoryBrowser>
  isLocal: boolean
}

function MainContent({ mb, isLocal }: MainContentProps): React.ReactElement {
  if (mb.activeView === 'graph' && !isLocal) {
    return <div className="flex-1 p-4 overflow-hidden flex flex-col"><MemoryGraph /></div>
  }
  if (mb.activeView === 'health') {
    return (
      <div className="flex-1 overflow-auto p-6">
        <HealthView report={mb.healthReport} isLoading={mb.isLoadingHealth} onRefresh={() => void mb.loadHealth()} />
      </div>
    )
  }
  if (mb.activeView === 'pipeline') {
    return (
      <div className="flex-1 overflow-auto p-6">
        <PipelineView
          result={mb.pipelineResult}
          mocGroups={mb.mocGroups}
          isRunning={mb.isRunningPipeline}
          onRunAction={(action) => void mb.runPipelineAction(action)}
          onNavigate={(path) => void mb.loadFileContent(path)}
        />
      </div>
    )
  }
  if (mb.activeView === 'hermes') {
    return (
      <div className="flex-1 overflow-auto p-6">
        <HermesMemoryView
          data={mb.hermesMemory}
          isLoading={mb.isLoadingHermes}
          onRefresh={mb.refreshHermes}
        />
      </div>
    )
  }
  return (
    <MemoryFileViewer
      isLoading={mb.isLoading}
      selectedMemoryFile={mb.selectedMemoryFile}
      memoryContent={mb.memoryContent}
      isEditing={mb.isEditing}
      editedContent={mb.editedContent}
      isSaving={mb.isSaving}
      schemaWarnings={mb.schemaWarnings}
      linksOpen={mb.linksOpen}
      typedFileLinks={mb.typedFileLinks}
      onToggleLinks={() => mb.setLinksOpen(!mb.linksOpen)}
      onStartEdit={() => { mb.setIsEditing(true); mb.setEditedContent(mb.memoryContent ?? '') }}
      onSave={() => void mb.saveFile()}
      onCancelEdit={() => { mb.setIsEditing(false); mb.setEditedContent('') }}
      onDeleteRequest={() => mb.setShowDeleteConfirm(true)}
      onClose={mb.closeFile}
      onEditedContentChange={mb.setEditedContent}
      onNavigate={mb.navigateToWikiLink}
    />
  )
}
