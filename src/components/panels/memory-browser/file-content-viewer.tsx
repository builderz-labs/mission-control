'use client'

import React from 'react'

interface FileContentViewerProps {
  selectedFile: string | null
  memoryContent: string | null
  isLoading: boolean
  isEditing: boolean
  editedContent: string
  isSaving: boolean
  onEditedContentChange: (content: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
  onCreateNew: () => void
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*.*?\*\*|\*.*?\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const m = match[0]
    if (m.startsWith('**') && m.endsWith('**')) {
      parts.push(<strong key={key++}>{m.slice(2, -2)}</strong>)
    } else if (m.startsWith('*') && m.endsWith('*')) {
      parts.push(<em key={key++}>{m.slice(1, -1)}</em>)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

function renderMarkdown(content: string): React.ReactElement[] {
  const lines = content.split('\n')
  const elements: React.ReactElement[] = []
  let inList = false
  const seenHeaders = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    if (trimmedLine.startsWith('# ')) {
      const headerText = trimmedLine.slice(2)
      const headerId = `h1-${headerText.toLowerCase().replace(/\s+/g, '-')}`

      if (seenHeaders.has(headerId)) continue
      seenHeaders.add(headerId)

      if (inList) inList = false
      elements.push(<h1 key={`${i}-${headerId}`} className="text-2xl font-bold mt-6 mb-3 text-primary">{headerText}</h1>)
    } else if (trimmedLine.startsWith('## ')) {
      const headerText = trimmedLine.slice(3)
      const headerId = `h2-${headerText.toLowerCase().replace(/\s+/g, '-')}`

      if (seenHeaders.has(headerId)) continue
      seenHeaders.add(headerId)

      if (inList) inList = false
      elements.push(<h2 key={`${i}-${headerId}`} className="text-xl font-semibold mt-5 mb-3 text-foreground">{headerText}</h2>)
    } else if (trimmedLine.startsWith('### ')) {
      const headerText = trimmedLine.slice(4)
      const headerId = `h3-${headerText.toLowerCase().replace(/\s+/g, '-')}`

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
      elements.push(
        <p key={`${i}-p`} className="mb-2">
          {renderInlineFormatting(trimmedLine)}
        </p>
      )
    }
  }

  return elements
}

function FileContentBody({
  selectedFile,
  memoryContent,
  isEditing,
  editedContent,
  onEditedContentChange,
}: {
  selectedFile: string | null
  memoryContent: string
  isEditing: boolean
  editedContent: string
  onEditedContentChange: (content: string) => void
}) {
  if (isEditing) {
    return (
      <textarea
        value={editedContent}
        onChange={(e) => onEditedContentChange(e.target.value)}
        className="w-full min-h-[500px] p-3 bg-surface-1 text-foreground font-mono text-sm border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
        placeholder="Edit file content..."
      />
    )
  }

  if (selectedFile?.endsWith('.md')) {
    return (
      <div className="prose prose-invert max-w-none w-full">
        <div className="mb-4 text-sm text-muted-foreground">
          File: {selectedFile} | Size: {memoryContent.length} chars
        </div>
        <div className="whitespace-pre-wrap break-words">
          {renderMarkdown(memoryContent)}
        </div>
      </div>
    )
  }

  if (selectedFile?.endsWith('.json')) {
    return (
      <div>
        <div className="mb-4 text-sm text-muted-foreground">
          File: {selectedFile} | Size: {memoryContent.length} chars
        </div>
        <pre className="text-sm overflow-auto whitespace-pre-wrap break-words">
          <code>{JSON.stringify(JSON.parse(memoryContent), null, 2)}</code>
        </pre>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 text-sm text-muted-foreground">
        File: {selectedFile} | Size: {memoryContent.length} chars
      </div>
      <pre className="text-sm whitespace-pre-wrap break-words overflow-auto">
        {memoryContent}
      </pre>
    </div>
  )
}

export function FileContentViewer({
  selectedFile,
  memoryContent,
  isLoading,
  isEditing,
  editedContent,
  isSaving,
  onEditedContentChange,
  onStartEditing,
  onCancelEditing,
  onSave,
  onDelete,
  onClose,
  onCreateNew,
}: FileContentViewerProps) {
  return (
    <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          {selectedFile || 'File Content'}
        </h2>
        <div className="flex items-center gap-2">
          {selectedFile && (
            <>
              {!isEditing ? (
                <>
                  <button
                    onClick={onStartEditing}
                    className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md text-sm hover:bg-blue-500/30 transition-smooth"
                  >
                    Edit
                  </button>
                  <button
                    onClick={onDelete}
                    className="px-3 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded-md text-sm hover:bg-red-500/30 transition-smooth"
                  >
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={onSave}
                    disabled={isSaving}
                    className="px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-md text-sm hover:bg-green-500/30 disabled:opacity-50 transition-smooth"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={onCancelEditing}
                    className="px-3 py-1 bg-secondary text-muted-foreground rounded-md text-sm hover:bg-secondary/80 transition-smooth"
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </>
          )}
          <button
            onClick={onCreateNew}
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
            <FileContentBody
              selectedFile={selectedFile}
              memoryContent={memoryContent}
              isEditing={isEditing}
              editedContent={editedContent}
              onEditedContentChange={onEditedContentChange}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <span>Select a file to view its content</span>
            <button
              onClick={onCreateNew}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
            >
              Create New File
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
