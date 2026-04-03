'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import type { Agent } from './agent-detail-types'

interface MemoryTabProps {
  agent: Agent
  workingMemory: string
  onSave: (content: string, append?: boolean) => Promise<void>
}

export function MemoryTab({ agent: _agent, workingMemory, onSave }: MemoryTabProps) {
  const t = useTranslations('agentDetail')
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
    if (confirm(t('confirmClearMemory'))) {
      await onSave('')
      setContent('')
      setEditing(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('workingMemory')}</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {t('workingMemoryDesc')}
          </p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <Button
                onClick={() => {
                  setAppendMode(true)
                  setEditing(true)
                }}
                variant="success"
                size="sm"
              >
                {t('addEntry')}
              </Button>
              <Button
                onClick={() => setEditing(true)}
                size="sm"
              >
                {t('editMemory')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
        <strong className="text-blue-200">{t('memoryBannerTitle')}</strong>{' '}
        {t('memoryBannerDesc')}{' '}
        <Link href="/memory" className="text-blue-400 underline hover:text-blue-300">{t('memoryBrowserLink')}</Link> {t('memoryBannerPage')}
      </div>

      {/* Memory Content */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          {t('memoryContent', { count: content.length })}
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
              placeholder={t('addMemoryEntryPlaceholder')}
            />
          </div>
        ) : editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={15}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
            placeholder={t('workingMemoryPlaceholder')}
          />
        ) : (
          <div className="bg-surface-1/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-muted-foreground italic">{t('noWorkingMemory')}</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <Button
            onClick={handleSave}
            className="flex-1"
          >
            {appendMode ? t('addEntry') : t('saveMemory')}
          </Button>
          <Button
            onClick={() => {
              setEditing(false)
              setAppendMode(false)
              setContent(workingMemory)
              setNewEntry('')
            }}
            variant="secondary"
            className="flex-1"
          >
            {t('cancel')}
          </Button>
          {!appendMode && (
            <Button
              onClick={handleClear}
              variant="destructive"
            >
              {t('clearAll')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
