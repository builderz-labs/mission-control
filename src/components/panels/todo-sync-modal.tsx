'use client'

import { useState, useCallback } from 'react'

const DEFAULT_PATH = 'D:\\01 Main Work\\Boots\\Agentic AI'
const MAX_IMPORT_ITEMS = 100

interface TodoItem {
  title: string
  source_file: string
  status: 'inbox' | 'in_progress' | 'done'
}

interface ParsedFile {
  path: string
  pending: TodoItem[]
  ongoing: TodoItem[]
  done: TodoItem[]
}

interface ScanResult {
  files: ParsedFile[]
  totals: { pending: number; ongoing: number; done: number }
}

interface TodoSyncModalProps {
  onClose: () => void
  onImported: (count: number) => void
}

export function TodoSyncModal({ onClose, onImported }: TodoSyncModalProps) {
  const [path, setPath] = useState(DEFAULT_PATH)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'pending' | 'ongoing' | 'done'>('pending')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)

  const allItems = useCallback((): TodoItem[] => {
    if (!scanResult) return []
    return scanResult.files.flatMap(f => [...f.pending, ...f.ongoing, ...f.done])
  }, [scanResult])

  const tabItems = useCallback((): TodoItem[] => {
    if (!scanResult) return []
    return scanResult.files.flatMap(f =>
      activeTab === 'pending' ? f.pending : activeTab === 'ongoing' ? f.ongoing : f.done
    )
  }, [scanResult, activeTab])

  const itemKey = (item: TodoItem) => `${item.source_file}::${item.title}`

  const handleScan = async () => {
    setScanError(null)
    setScanning(true)
    setScanResult(null)
    setSelected(new Set())
    try {
      const res = await fetch(`/api/tasks/todo-sync?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      if (!res.ok) { setScanError(data.error || 'Scan failed'); return }
      setScanResult(data)
    } catch { setScanError('Network error') }
    finally { setScanning(false) }
  }

  const toggleItem = (item: TodoItem) => {
    const key = itemKey(item)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const selectAllTab = () => {
    const items = tabItems()
    const keys = items.map(itemKey)
    const allSelected = keys.every(k => selected.has(k))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) keys.forEach(k => next.delete(k))
      else keys.forEach(k => next.add(k))
      return next
    })
  }

  const handleImport = async () => {
    const allI = allItems()
    const toImport = allI.filter(i => selected.has(itemKey(i)))
    if (toImport.length === 0) return
    if (toImport.length > MAX_IMPORT_ITEMS) {
      setImportFeedback(`Select up to ${MAX_IMPORT_ITEMS} items per import`)
      return
    }

    setImporting(true)
    try {
      const res = await fetch('/api/tasks/todo-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toImport }),
      })
      const data = await res.json()
      if (res.ok) {
        setImportFeedback(`Imported ${data.created} task${data.created === 1 ? '' : 's'}${data.skipped > 0 ? ` (${data.skipped} already existed)` : ''}`)
        onImported(data.created)
        setTimeout(onClose, 1500)
      } else setImportFeedback('Error: ' + (data.error || 'Import failed'))
    } catch { setImportFeedback('Network error') }
    finally { setImporting(false) }
  }

  const currentItems = tabItems()
  const tabKeys = currentItems.map(itemKey)
  const allTabSelected = tabKeys.length > 0 && tabKeys.every(k => selected.has(k))

  const tabCounts = scanResult ? {
    pending: scanResult.totals.pending,
    ongoing: scanResult.totals.ongoing,
    done: scanResult.totals.done,
  } : { pending: 0, ongoing: 0, done: 0 }

  const relPath = (full: string) => {
    try { return full.replace(path, '').replace(/^[\\/]+/, '') || full } catch { return full }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Sync from Todo.md</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Import tasks from markdown todo files</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>

        {/* Path picker */}
        <div className="p-4 border-b border-border shrink-0">
          <label className="text-xs text-muted-foreground mb-1 block">Folder path</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={path}
              onChange={e => setPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleScan()}
              placeholder="D:\path\to\projects"
              className="flex-1 px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none font-mono"
            />
            <button
              onClick={handleScan}
              disabled={scanning || !path.trim()}
              className="px-4 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium disabled:opacity-50 shrink-0"
            >
              {scanning ? 'Scanning...' : 'Scan'}
            </button>
          </div>
          {scanError && <p className="text-xs text-destructive mt-1">{scanError}</p>}
        </div>

        {/* Results */}
        {scanResult && (
          <>
            {/* Summary + tabs */}
            <div className="px-4 pt-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">
                  Found {scanResult.files.length} file{scanResult.files.length !== 1 ? 's' : ''} — {scanResult.totals.pending + scanResult.totals.ongoing + scanResult.totals.done} total items
                </p>
                <span className="text-xs text-primary font-medium">{selected.size}/{MAX_IMPORT_ITEMS} selected</span>
              </div>
              <div className="flex gap-1 border-b border-border">
                {(['pending', 'ongoing', 'done'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                      activeTab === tab ? 'bg-card text-foreground border border-border border-b-card -mb-px' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab === 'pending' ? 'Pending' : tab === 'ongoing' ? 'Ongoing' : 'Done'}
                    {tabCounts[tab] > 0 && (
                      <span className="ml-1.5 text-2xs text-muted-foreground">({tabCounts[tab]})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Item list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
              {currentItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No {activeTab} items found</p>
              ) : (
                <>
                  {/* Select all row */}
                  <div className="flex items-center gap-2 pb-2 mb-1 border-b border-border">
                    <input
                      type="checkbox"
                      checked={allTabSelected}
                      onChange={selectAllTab}
                      className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground">Select all {activeTab} ({currentItems.length})</span>
                    <span className="ml-auto text-2xs text-muted-foreground">Max import {MAX_IMPORT_ITEMS}</span>
                  </div>
                  {currentItems.map(item => {
                    const key = itemKey(item)
                    const isChecked = selected.has(key)
                    return (
                      <label key={key} className={`flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors ${isChecked ? 'bg-primary/8' : 'hover:bg-muted/50'}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleItem(item)}
                          className="mt-0.5 w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground leading-tight truncate">{item.title}</p>
                          <p className="text-2xs text-muted-foreground mt-0.5 truncate">{relPath(item.source_file)}</p>
                        </div>
                      </label>
                    )
                  })}
                </>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          {importFeedback ? (
            <p className="text-xs text-green-400 flex-1">{importFeedback}</p>
          ) : (
            <p className="text-xs text-muted-foreground flex-1">
              {selected.size > 0 ? `${selected.size} task${selected.size !== 1 ? 's' : ''} selected for import` : 'Select items to import'}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={selected.size === 0 || importing || selected.size > MAX_IMPORT_ITEMS}
              className="px-4 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium disabled:opacity-50 transition-colors"
            >
              {importing ? 'Importing...' : `Import ${selected.size > 0 ? selected.size : ''} Selected`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
