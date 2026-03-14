'use client'

import { useState, useEffect } from 'react'
import { type Agent } from '@/store'
import Link from 'next/link'

export function MemoryTab({
  agent,
  workingMemory,
  onSave
}: {
  agent: Agent
  workingMemory: string
  onSave: (content: string, append?: boolean) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(workingMemory)
  const [appendMode, setAppendMode] = useState(false)
  const [newEntry, setNewEntry] = useState('')

  useEffect(() => {
    setContent(workingMemory)
  }, [workingMemory])

  const handleSave = async () => {
    if (appendMode && newEntry.trim()) {
      await onSave(newEntry, true)
      setNewEntry('')
      setAppendMode(false)
    } else {
      await onSave(content)
    }
    setEditing(false)
  }

  const handleClear = async () => {
    if (confirm('Are you sure you want to clear all working memory?')) {
      await onSave('')
      setContent('')
      setEditing(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">Working Memory</h4>
          <p className="text-xs text-muted-foreground mt-1">
            This is <strong className="text-foreground">agent-level</strong> scratchpad memory (stored as WORKING.md in the database), not the workspace memory folder.
          </p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <button
                onClick={() => {
                  setAppendMode(true)
                  setEditing(true)
                }}
                className="px-3 py-1 text-sm bg-green-500/20 text-green-400 border border-green-500/30 rounded-md hover:bg-green-500/30 transition-smooth"
              >
                Add Entry
              </button>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
              >
                Edit Memory
              </button>
            </>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
        <strong className="text-blue-200">Agent Memory vs Workspace Memory:</strong>{' '}
        This tab edits only this agent&apos;s private working memory (a scratchpad stored in the database).
        To browse or edit all workspace memory files (daily logs, knowledge base, MEMORY.md, etc.), visit the{' '}
        <Link href="/memory" className="text-blue-400 underline hover:text-blue-300">Memory Browser</Link> page.
      </div>

      {/* Memory Content */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          Memory Content ({content.length} characters)
        </label>

        {editing && appendMode ? (
          <div className="space-y-2">
            <div className="bg-surface-1/30 rounded p-4 max-h-40 overflow-y-auto">
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            </div>
            <textarea
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              rows={5}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="Add new memory entry..."
            />
          </div>
        ) : editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={15}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
            placeholder="Working memory for temporary notes, current tasks, and session data..."
          />
        ) : (
          <div className="bg-surface-1/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-muted-foreground italic">No working memory content</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
          >
            {appendMode ? 'Add Entry' : 'Save Memory'}
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setAppendMode(false)
              setContent(workingMemory)
              setNewEntry('')
            }}
            className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
          >
            Cancel
          </button>
          {!appendMode && (
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-smooth"
            >
              Clear All
            </button>
          )}
        </div>
      )}
    </div>
  )
}
