'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PipelineTab } from './pipeline-tab'
import { CommandTab } from './orchestration-command-tab'
import { WorkflowsTab } from './orchestration-workflows-tab'
import { FleetTab } from './orchestration-fleet-tab'
import {
  type Agent,
  type WorkflowTemplate,
  type TemplateFormData,
  type ActiveTab,
  emptyForm,
} from './orchestration-bar.types'

export function OrchestrationBar(): React.ReactElement {
  const t = useTranslations('orchestration')
  const [agents, setAgents] = useState<Agent[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('command')

  // Command state
  const [selectedAgent, setSelectedAgent] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [commandResult, setCommandResult] = useState<{ ok: boolean; text: string } | null>(null)

  // Template state
  const [formMode, setFormMode] = useState<'hidden' | 'create' | 'edit'>('hidden')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [templateForm, setTemplateForm] = useState<TemplateFormData>({ ...emptyForm })
  const [tagInput, setTagInput] = useState('')
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [spawning, setSpawning] = useState<number | null>(null)

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true)
    setFetchError(null)
    try {
      const [agentRes, templateRes] = await Promise.all([
        fetch('/api/agents', { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
        fetch('/api/workflows', { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      ])
      setAgents(agentRes.agents || [])
      setTemplates(templateRes.templates || [])
    } catch {
      setFetchError('Failed to load agents and workflows')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const allTags = [...new Set(templates.flatMap(tmpl => tmpl.tags || []))].sort()
  const filteredTemplates = filterTag
    ? templates.filter(tmpl => tmpl.tags?.includes(filterTag))
    : templates

  const sendCommand = async (): Promise<void> => {
    if (!selectedAgent || !message.trim()) return
    setSending(true)
    setCommandResult(null)
    try {
      const res = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedAgent, content: message, from: 'operator' }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        setCommandResult({ ok: true, text: `Message sent to ${selectedAgent}` })
        setMessage('')
      } else {
        setCommandResult({ ok: false, text: data.error || 'Failed to send' })
      }
    } catch {
      setCommandResult({ ok: false, text: 'Network error' })
    } finally {
      setSending(false)
    }
  }

  const executeTemplate = async (template: WorkflowTemplate): Promise<void> => {
    setSpawning(template.id)
    try {
      const res = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: template.task_prompt,
          model: template.model,
          label: template.name,
          timeoutSeconds: template.timeout_seconds,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        await fetch('/api/workflows', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: template.id }),
          signal: AbortSignal.timeout(8000),
        })
        setCommandResult({ ok: true, text: `Spawned "${template.name}"` })
        fetchData()
      } else {
        const data = await res.json()
        setCommandResult({ ok: false, text: data.error || 'Spawn failed' })
      }
    } catch {
      setCommandResult({ ok: false, text: 'Network error' })
    } finally {
      setSpawning(null)
    }
  }

  const saveTemplate = async (): Promise<void> => {
    if (!templateForm.name || !templateForm.task_prompt) return
    try {
      const isEdit = formMode === 'edit' && editingId !== null
      const res = await fetch('/api/workflows', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, ...templateForm } : templateForm),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        closeForm()
        fetchData()
      }
    } catch {
      // network error — form stays open
    }
  }

  const startEdit = (tmpl: WorkflowTemplate): void => {
    setFormMode('edit')
    setEditingId(tmpl.id)
    setTemplateForm({
      name: tmpl.name,
      description: tmpl.description || '',
      model: tmpl.model,
      task_prompt: tmpl.task_prompt,
      timeout_seconds: tmpl.timeout_seconds,
      agent_role: tmpl.agent_role || '',
      tags: tmpl.tags || [],
    })
    setTagInput('')
  }

  const duplicateTemplate = (tmpl: WorkflowTemplate): void => {
    setFormMode('create')
    setEditingId(null)
    setTemplateForm({
      name: `${tmpl.name} (copy)`,
      description: tmpl.description || '',
      model: tmpl.model,
      task_prompt: tmpl.task_prompt,
      timeout_seconds: tmpl.timeout_seconds,
      agent_role: tmpl.agent_role || '',
      tags: tmpl.tags || [],
    })
    setTagInput('')
  }

  const closeForm = (): void => {
    setFormMode('hidden')
    setEditingId(null)
    setTemplateForm({ ...emptyForm })
    setTagInput('')
  }

  const deleteTemplate = async (id: number): Promise<void> => {
    await fetch(`/api/workflows?id=${id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
    if (expandedId === id) setExpandedId(null)
    fetchData()
  }

  const addTag = (): void => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !templateForm.tags.includes(tag)) {
      setTemplateForm(f => ({ ...f, tags: [...f.tags, tag] }))
    }
    setTagInput('')
  }

  const removeTag = (tag: string): void => {
    setTemplateForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  const handleFormChange = (field: keyof TemplateFormData, value: string | number | string[]): void => {
    setTemplateForm(f => ({ ...f, [field]: value }))
  }

  const onlineCount = agents.filter(a => a.status === 'idle' || a.status === 'busy').length
  const busyCount = agents.filter(a => a.status === 'busy').length
  const errorCount = agents.filter(a => a.status === 'error').length

  if (loading) {
    return (
      <div className="border-b border-border bg-card/50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="animate-pulse">Loading orchestration data...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-border bg-card/50">
      {fetchError && <div className="text-xs text-red-400 px-4 py-2">{fetchError}</div>}
      <TabBar
        activeTab={activeTab}
        onSetActiveTab={setActiveTab}
        agents={agents}
        onlineCount={onlineCount}
        errorCount={errorCount}
        commandResult={commandResult}
        t={t}
      />
      {activeTab === 'command' && (
        <CommandTab
          agents={agents}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          message={message}
          onMessageChange={setMessage}
          onSend={sendCommand}
          sending={sending}
        />
      )}
      {activeTab === 'templates' && (
        <WorkflowsTab
          templates={templates}
          filteredTemplates={filteredTemplates}
          allTags={allTags}
          filterTag={filterTag}
          onSetFilterTag={setFilterTag}
          formMode={formMode}
          templateForm={templateForm}
          tagInput={tagInput}
          expandedId={expandedId}
          spawning={spawning}
          onOpenCreate={() => { setFormMode('create'); setTemplateForm({ ...emptyForm }) }}
          onCloseForm={closeForm}
          onFormChange={handleFormChange}
          onTagInputChange={setTagInput}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          onSaveTemplate={saveTemplate}
          onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
          onExecuteTemplate={executeTemplate}
          onEditTemplate={startEdit}
          onDuplicateTemplate={duplicateTemplate}
          onDeleteTemplate={deleteTemplate}
        />
      )}
      {activeTab === 'pipelines' && (
        <div className="p-4 pt-3">
          <PipelineTab />
        </div>
      )}
      {activeTab === 'fleet' && (
        <FleetTab
          agents={agents}
          onlineCount={onlineCount}
          busyCount={busyCount}
          errorCount={errorCount}
        />
      )}
    </div>
  )
}

interface TabBarProps {
  activeTab: ActiveTab
  onSetActiveTab: (tab: ActiveTab) => void
  agents: Agent[]
  onlineCount: number
  errorCount: number
  commandResult: { ok: boolean; text: string } | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: string) => string
}

function TabBar({
  activeTab,
  onSetActiveTab,
  agents,
  onlineCount,
  errorCount,
  commandResult,
  t,
}: TabBarProps): React.ReactElement {
  const tabs: ActiveTab[] = ['command', 'templates', 'pipelines', 'fleet']
  const tabLabel = (tab: ActiveTab): string => {
    if (tab === 'command') return t('tabCommand')
    if (tab === 'templates') return t('tabWorkflows')
    if (tab === 'pipelines') return t('tabPipelines')
    return t('tabFleet')
  }

  return (
    <div className="flex items-center gap-1 px-4 pt-2">
      {tabs.map(tab => (
        <Button
          key={tab}
          onClick={() => onSetActiveTab(tab)}
          variant="ghost"
          size="sm"
          className={`rounded-t-md rounded-b-none ${
            activeTab === tab
              ? 'bg-secondary text-foreground border border-border border-b-transparent'
              : ''
          }`}
        >
          {tabLabel(tab)}
          {tab === 'fleet' && (
            <span className={`ml-1.5 text-2xs ${errorCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {onlineCount}/{agents.length}
            </span>
          )}
        </Button>
      ))}
      {commandResult && (
        <span className={`ml-auto text-xs ${commandResult.ok ? 'text-green-400' : 'text-red-400'}`}>
          {commandResult.text}
        </span>
      )}
    </div>
  )
}
