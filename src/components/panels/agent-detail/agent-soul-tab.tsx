'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createClientLogger } from '@/lib/client-logger'
import type { Agent, SoulTemplate } from './agent-detail-types'

const log = createClientLogger('SoulTab')

interface SoulTabProps {
  agent: Agent
  soulContent: string
  templates: SoulTemplate[]
  onSave: (content: string, templateName?: string) => Promise<void>
}

export function SoulTab({ agent, soulContent, templates, onSave }: SoulTabProps) {
  const t = useTranslations('agentDetail')
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(soulContent)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  useEffect(() => {
    setContent(soulContent)
  }, [soulContent])

  const handleSave = async () => {
    await onSave(content)
    setEditing(false)
  }

  const handleLoadTemplate = async (templateName: string) => {
    try {
      const response = await fetch(`/api/agents/${agent.name}/soul?template=${templateName}`, {
        method: 'PATCH',
        signal: AbortSignal.timeout(8000)
      })
      if (response.ok) {
        const data = await response.json()
        setContent(data.content)
        setSelectedTemplate(templateName)
      }
    } catch (error) {
      log.error('Failed to load template:', error)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-foreground">{t('soulConfiguration')}</h4>
        <div className="flex gap-2">
          {!editing && (
            <Button onClick={() => setEditing(true)} size="sm">
              {t('editSoul')}
            </Button>
          )}
        </div>
      </div>

      {/* Template Selector */}
      {editing && templates.length > 0 && (
        <div className="p-4 bg-surface-1/50 rounded-lg">
          <h5 className="text-sm font-medium text-foreground mb-2">{t('loadTemplate')}</h5>
          <div className="flex gap-2">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">{t('selectTemplate')}</option>
              {templates.map(template => (
                <option key={template.name} value={template.name}>
                  {template.description} ({t('chars', { count: template.size })})
                </option>
              ))}
            </select>
            <Button
              onClick={() => selectedTemplate && handleLoadTemplate(selectedTemplate)}
              disabled={!selectedTemplate}
              variant="success"
            >
              {t('load')}
            </Button>
          </div>
        </div>
      )}

      {/* SOUL Editor */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          {t('soulContent', { count: content.length })}
        </label>
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
            placeholder={t('soulEditorPlaceholder')}
          />
        ) : (
          <div className="bg-surface-1/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-muted-foreground italic">{t('noSoulContent')}</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing && (
        <div className="flex gap-3">
          <Button onClick={handleSave} className="flex-1">
            {t('saveSoul')}
          </Button>
          <Button
            onClick={() => {
              setEditing(false)
              setContent(soulContent)
            }}
            variant="secondary"
            className="flex-1"
          >
            {t('cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
