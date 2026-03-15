'use client'

import React, { useState } from 'react'

interface CreateFileModalProps {
  onClose: () => void
  onCreate: (path: string, content: string) => void
}

const fileTypesWithTemplates: Record<string, string> = {
  md: '# New Document\n\n## Overview\n\n## Details\n\n',
  json: '{\n  "name": "",\n  "description": "",\n  "data": {}\n}',
  txt: '',
  log: `[${new Date().toISOString()}] Log entry\n`,
}

export function CreateFileModal({ onClose, onCreate }: CreateFileModalProps) {
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full p-6 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-foreground">Create New File</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl transition-smooth">{'\u00d7'}</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Directory Path</label>
            <select
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="knowledge-base/">knowledge-base/</option>
              <option value="memory/">memory/</option>
              <option value="knowledge/">knowledge/</option>
              <option value="daily/">daily/</option>
              <option value="logs/">logs/</option>
              <option value="reference/">reference/</option>
              <option value="templates/">templates/</option>
              <option value="">root/</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">File Name</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="my-new-file"
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">File Type</label>
            <select
              value={fileType}
              onChange={(e) => {
                setFileType(e.target.value)
                setInitialContent(fileTypesWithTemplates[e.target.value] || '')
              }}
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="md">Markdown (.md)</option>
              <option value="json">JSON (.json)</option>
              <option value="txt">Text (.txt)</option>
              <option value="log">Log (.log)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Initial Content (optional)</label>
            <textarea
              value={initialContent}
              onChange={(e) => setInitialContent(e.target.value)}
              className="w-full h-24 px-3 py-2 bg-surface-1 border border-border rounded-md text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none font-mono text-sm"
              placeholder="Template content will be auto-filled..."
            />
          </div>

          <div className="bg-surface-1 p-3 rounded-md text-sm text-muted-foreground border border-border/50">
            <strong className="text-foreground">Full Path:</strong> {filePath}{fileName}.{fileType}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleCreate}
              disabled={!fileName.trim()}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
            >
              Create File
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-secondary/80 transition-smooth"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
