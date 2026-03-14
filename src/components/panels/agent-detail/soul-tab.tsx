'use client'

import { useState, useEffect } from 'react'
import { type Agent } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { type SoulTemplate } from './types'

const log = createClientLogger('SoulTab')

export function SoulTab({
  agent,
  soulContent,
  templates,
  onSave
}: {
  agent: Agent
  soulContent: string
  templates: SoulTemplate[]
  onSave: (content: string, templateName?: string) => Promise<void>
}) {
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
        method: 'PATCH'
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
        <h4 className="text-lg font-medium text-foreground">SOUL Configuration</h4>
        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth"
            >
              Edit SOUL
            </button>
          )}
        </div>
      </div>

      {/* Template Selector */}
      {editing && templates.length > 0 && (
        <div className="p-4 bg-surface-1/50 rounded-lg">
          <h5 className="text-sm font-medium text-foreground mb-2">Load Template</h5>
          <div className="flex gap-2">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Select a template...</option>
              {templates.map(template => (
                <option key={template.name} value={template.name}>
                  {template.description} ({template.size} chars)
                </option>
              ))}
            </select>
            <button
              onClick={() => selectedTemplate && handleLoadTemplate(selectedTemplate)}
              disabled={!selectedTemplate}
              className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-md hover:bg-green-500/30 disabled:opacity-50 transition-smooth"
            >
              Load
            </button>
          </div>
        </div>
      )}

      {/* SOUL Editor */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          SOUL Content ({content.length} characters)
        </label>
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
            placeholder="Define the agent's personality, instructions, and behavior patterns..."
          />
        ) : (
          <div className="bg-surface-1/30 rounded p-4 max-h-96 overflow-y-auto">
            {content ? (
              <pre className="text-foreground whitespace-pre-wrap text-sm">{content}</pre>
            ) : (
              <p className="text-muted-foreground italic">No SOUL content defined</p>
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
            Save SOUL
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setContent(soulContent)
            }}
            className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
