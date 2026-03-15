'use client'

import React from 'react'
import { useMemoryFiles } from './memory-browser/use-memory-files'
import { FileTree } from './memory-browser/file-tree'
import { FileContentViewer } from './memory-browser/file-content-viewer'
import { SearchBar } from './memory-browser/search-bar'
import { FileStats } from './memory-browser/file-stats'
import { CreateFileModal } from './memory-browser/create-file-modal'
import { DeleteConfirmModal } from './memory-browser/delete-confirm-modal'

export function MemoryBrowserPanel() {
  const state = useMemoryFiles()

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">Memory Browser</h1>
        <p className="text-muted-foreground mt-2">
          {state.isLocal
            ? 'Browse and manage local knowledge files and memory'
            : 'Explore knowledge files and memory structure'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          This page shows all workspace memory files. The agent profile Memory tab only edits that single agent&apos;s working memory.
        </p>

        {/* Tab Navigation */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => state.setActiveTab('all')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              state.activeTab === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            {'\uD83D\uDCC1'} All Files
          </button>
          <button
            onClick={() => state.setActiveTab('daily')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              state.activeTab === 'daily'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            {'\uD83D\uDCC5'} Daily Logs
          </button>
          <button
            onClick={() => state.setActiveTab('knowledge')}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              state.activeTab === 'knowledge'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            {'\uD83E\uDDE0'} Knowledge
          </button>
        </div>
      </div>

      <SearchBar
        searchQuery={state.searchQuery}
        isSearching={state.isSearching}
        isLoading={state.isLoading}
        searchResults={state.searchResults}
        onSearchQueryChange={state.setSearchQuery}
        onSearch={state.searchFiles}
        onRefresh={state.loadFileTree}
        onSelectResult={state.loadFileContent}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <FileTree
          files={state.getFilteredFiles()}
          selectedFile={state.selectedMemoryFile}
          expandedFolders={state.expandedFolders}
          isLoading={state.isLoading}
          activeTab={state.activeTab}
          onToggleFolder={state.toggleFolder}
          onSelectFile={state.loadFileContent}
        />

        <FileContentViewer
          selectedFile={state.selectedMemoryFile}
          memoryContent={state.memoryContent}
          isLoading={state.isLoading}
          isEditing={state.isEditing}
          editedContent={state.editedContent}
          isSaving={state.isSaving}
          onEditedContentChange={state.setEditedContent}
          onStartEditing={state.startEditing}
          onCancelEditing={state.cancelEditing}
          onSave={state.saveFile}
          onDelete={() => state.setShowDeleteConfirm(true)}
          onClose={state.closeFile}
          onCreateNew={() => state.setShowCreateModal(true)}
        />
      </div>

      <FileStats memoryFiles={state.memoryFiles} />

      {state.showCreateModal && (
        <CreateFileModal
          onClose={() => state.setShowCreateModal(false)}
          onCreate={state.createNewFile}
        />
      )}

      {state.showDeleteConfirm && state.selectedMemoryFile && (
        <DeleteConfirmModal
          fileName={state.selectedMemoryFile}
          onClose={() => state.setShowDeleteConfirm(false)}
          onConfirm={state.deleteFile}
        />
      )}
    </div>
  )
}
