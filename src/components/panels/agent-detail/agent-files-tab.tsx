'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/types/sql'
import type { Agent, FileEntry } from './agent-detail-types'

const log = createClientLogger('FilesTab')

interface FilesTabProps {
  agent: Agent
}

export function FilesTab({ agent }: FilesTabProps) {
  const t = useTranslations('agentDetail')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [workspace, setWorkspace] = useState<string | null>(null)

  const loadFiles = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/agents/${agent.id}/files`, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load files')
      }
      const data = await response.json()
      setWorkspace(data.workspace || null)
      const entries = Object.entries(data.files || {}).map(([name, value]: [string, any]) => ({
        name,
        exists: Boolean(value?.exists),
        content: String(value?.content || ''),
      }))
      setFiles(entries)
    } catch (err: unknown) {
      log.error('Failed to load files:', err)
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFiles() }, [agent.id])

  const activeEntry = activeFile ? files.find(f => f.name === activeFile) : null
  const baseContent = activeEntry?.content || ''
  const isDirty = activeFile ? draft !== baseContent : false

  const selectFile = (name: string) => {
    const entry = files.find(f => f.name === name)
    setActiveFile(name)
    setDraft(entry?.content || '')
  }

  const handleSave = async () => {
    if (!activeFile) return
    setSaving(true)
    try {
      const response = await fetch(`/api/agents/${agent.id}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: activeFile, content: draft }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save file')
      }
      setFiles(prev => prev.map(f =>
        f.name === activeFile ? { ...f, exists: true, content: draft } : f
      ))
    } catch (err: unknown) {
      log.error('Failed to save file:', err)
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading && files.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label="Loading files" />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('workspaceFiles')}</h4>
          {workspace && (
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{workspace}</p>
          )}
        </div>
        <Button onClick={loadFiles} size="sm" variant="secondary" disabled={loading}>
          {loading ? '...' : t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[200px_1fr] gap-4 min-h-[400px]">
        {/* File list */}
        <div className="space-y-1 border-r border-border pr-3">
          {files.map(file => (
            <button
              key={file.name}
              onClick={() => selectFile(file.name)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                activeFile === file.name
                  ? 'bg-primary/10 text-foreground border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-1/50'
              }`}
            >
              <div className="font-mono text-xs">{file.name}</div>
              <div className="text-2xs mt-0.5">
                {file.exists
                  ? t('charCount', { count: file.content.length })
                  : <span className="text-amber-400">{t('missing')}</span>
                }
              </div>
            </button>
          ))}
        </div>

        {/* Editor */}
        <div>
          {!activeEntry ? (
            <div className="text-muted-foreground text-sm flex items-center justify-center h-full">
              {t('selectFile')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-mono text-sm text-foreground">{activeEntry.name}</span>
                  {!activeEntry.exists && (
                    <span className="ml-2 px-1.5 py-0.5 text-2xs bg-amber-500/20 text-amber-400 rounded">{t('missing')}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setDraft(baseContent)}
                    size="xs"
                    variant="secondary"
                    disabled={!isDirty}
                  >
                    {t('reset')}
                  </Button>
                  <Button
                    onClick={handleSave}
                    size="xs"
                    disabled={saving || !isDirty}
                  >
                    {saving ? t('saving') : t('save')}
                  </Button>
                </div>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={20}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
                placeholder={activeEntry.exists ? '' : t('fileNotExistYet')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
