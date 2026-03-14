'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PipelineTab } from './pipeline-tab'

interface Agent {
  id: number
  name: string
  role: string
  status: string
  session_key?: string
}

interface WorkflowTemplate {
  id: number
  name: string
  description: string | null
  model: string
  task_prompt: string
  timeout_seconds: number
  agent_role: string | null
  tags: string[]
  use_count: number
  last_used_at: number | null
}

type TemplateFormData = {
  name: string
  description: string
  model: string
  task_prompt: string
  timeout_seconds: number
  agent_role: string
  tags: string[]
}

const emptyForm: TemplateFormData = {
  name: '', description: '', model: 'sonnet', task_prompt: '',
  timeout_seconds: 300, agent_role: '', tags: []
}

export function OrchestrationBar() {
  const t = useTranslations('orchestration')
  const [agents, setAgents] = useState<Agent[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [activeTab, setActiveTab] = useState<'command' | 'templates' | 'pipelines' | 'fleet'>('command')

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

  const fetchData = useCallback(async () => {
    const [agentRes, templateRes] = await Promise.all([
      fetch('/api/agents').then(r => r.json()).catch(() => ({ agents: [] })),
      fetch('/api/workflows').then(r => r.json()).catch(() => ({ templates: [] })),
    ])
    setAgents(agentRes.agents || [])
    setTemplates(templateRes.templates || [])
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // All unique tags across templates
  const allTags = [...new Set(templates.flatMap(t => t.tags || []))].sort()

  // Filtered templates
  const filteredTemplates = filterTag
    ? templates.filter(t => t.tags?.includes(filterTag))
    : templates

  // Send message to agent
  const sendCommand = async () => {
    if (!selectedAgent || !message.trim()) return
    setSending(true)
    setCommandResult(null)

    try {
      const res = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedAgent, content: message, from: 'operator' })
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

  // Execute workflow template
  const executeTemplate = async (template: WorkflowTemplate) => {
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
        })
      })

      if (res.ok) {
        await fetch('/api/workflows', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: template.id })
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

  // Save template (create or update)
  const saveTemplate = async () => {
    if (!templateForm.name || !templateForm.task_prompt) return
    try {
      const isEdit = formMode === 'edit' && editingId !== null
      const res = await fetch('/api/workflows', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, ...templateForm } : templateForm)
      })
      if (res.ok) {
        closeForm()
        fetchData()
      }
    } catch {
      // ignore
    }
  }

  // Edit template
  const startEdit = (t: WorkflowTemplate) => {
    setFormMode('edit')
    setEditingId(t.id)
    setTemplateForm({
      name: t.name,
      description: t.description || '',
      model: t.model,
      task_prompt: t.task_prompt,
      timeout_seconds: t.timeout_seconds,
      agent_role: t.agent_role || '',
      tags: t.tags || [],
    })
    setTagInput('')
  }

  // Duplicate template
  const duplicateTemplate = (t: WorkflowTemplate) => {
    setFormMode('create')
    setEditingId(null)
    setTemplateForm({
      name: `${t.name} (copy)`,
      description: t.description || '',
      model: t.model,
      task_prompt: t.task_prompt,
      timeout_seconds: t.timeout_seconds,
      agent_role: t.agent_role || '',
      tags: t.tags || [],
    })
    setTagInput('')
  }

  // Close form
  const closeForm = () => {
    setFormMode('hidden')
    setEditingId(null)
    setTemplateForm({ ...emptyForm })
    setTagInput('')
  }

  // Delete template
  const deleteTemplate = async (id: number) => {
    await fetch(`/api/workflows?id=${id}`, { method: 'DELETE' })
    if (expandedId === id) setExpandedId(null)
    fetchData()
  }

  // Tag management
  const addTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !templateForm.tags.includes(tag)) {
      setTemplateForm(f => ({ ...f, tags: [...f.tags, tag] }))
    }
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    setTemplateForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  // Fleet metrics
  const onlineCount = agents.filter(a => a.status === 'idle' || a.status === 'busy').length
  const busyCount = agents.filter(a => a.status === 'busy').length
  const errorCount = agents.filter(a => a.status === 'error').length

  return (
    <div className="border-b border-border bg-card/50">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-2">
        {(['command', 'templates', 'pipelines', 'fleet'] as const).map(tab => (
          <Button
            key={tab}
            onClick={() => setActiveTab(tab)}
            variant="ghost"
            size="sm"
            className={`rounded-t-md rounded-b-none ${
              activeTab === tab
                ? 'bg-secondary text-foreground border border-border border-b-transparent'
                : ''
            }`}
          >
            {tab === 'command' ? t('tabCommand') : tab === 'templates' ? t('tabWorkflows') : tab === 'pipelines' ? t('tabPipelines') : t('tabFleet')}
            {tab === 'fleet' && (
              <span className={`ml-1.5 text-2xs ${errorCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {onlineCount}/{agents.length}
              </span>
            )}
          </Button>
        ))}

        {/* Result toast inline */}
        {commandResult && (
          <span className={`ml-auto text-xs ${commandResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {commandResult.text}
          </span>
        )}
      </div>

      {/* Command Tab */}
      {activeTab === 'command' && (
        <div className="p-4 pt-3">
          <div className="flex gap-2">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="h-9 px-2 rounded-md bg-secondary border border-border text-sm text-foreground min-w-[140px]"
            >
              <option value="">{t('selectAgent')}</option>
              {agents.length === 0 && (
                <option value="" disabled>{t('noAgentsRegistered')}</option>
              )}
              {agents.map(a => (
                <option key={a.name} value={a.name} disabled={!a.session_key} title={!a.session_key ? 'Agent has no active session' : undefined}>
                  {a.name} ({a.status}){!a.session_key ? ` — ${t('noSessionSuffix')}` : ''}
                </option>
              ))}
            </select>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
              placeholder={t('commandPlaceholder')}
              className="flex-1 h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground"
            />
            <Button
              onClick={sendCommand}
              disabled={!selectedAgent || !message.trim() || sending}
            >
              {sending ? '...' : t('send')}
            </Button>
          </div>
        </div>
      )}

      {/* Workflows Tab */}
      {activeTab === 'templates' && (
        <div className="p-4 pt-3">
          {templates.length === 0 && formMode === 'hidden' ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-2">{t('noTemplates')}</p>
              <Button
                onClick={() => { setFormMode('create'); setEditingId(null); setTemplateForm({ ...emptyForm }) }}
                variant="link"
                size="sm"
              >
                {t('createFirstTemplate')}
              </Button>
            </div>
          ) : (
            <>
              {/* Header + tag filter */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {filteredTemplates.length}{filterTag ? ` / ${templates.length}` : ''} templates
                  </span>
                  {allTags.length > 0 && (
                    <div className="flex items-center gap-1">
                      {filterTag && (
                        <Button
                          onClick={() => setFilterTag(null)}
                          variant="ghost"
                          size="xs"
                          className="text-2xs h-auto px-1.5 py-0.5 bg-primary/20 text-primary hover:bg-primary/30"
                        >
                          {filterTag} x
                        </Button>
                      )}
                      {!filterTag && allTags.slice(0, 5).map(tag => (
                        <Button
                          key={tag}
                          onClick={() => setFilterTag(tag)}
                          variant="secondary"
                          size="xs"
                          className="text-2xs h-auto px-1.5 py-0.5"
                        >
                          {tag}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => {
                    if (formMode !== 'hidden') closeForm()
                    else { setFormMode('create'); setTemplateForm({ ...emptyForm }) }
                  }}
                  variant="link"
                  size="xs"
                >
                  {formMode !== 'hidden' ? t('cancel') : t('new')}
                </Button>
              </div>

              {/* Create/Edit Form */}
              {formMode !== 'hidden' && (
                <div className="mb-3 p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground">
                      {formMode === 'edit' ? t('editTemplate') : t('newTemplate')}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={t('templateName')}
                      className="h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
                    />
                    <select
                      value={templateForm.model}
                      onChange={(e) => setTemplateForm(f => ({ ...f, model: e.target.value }))}
                      className="h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
                    >
                      <option value="haiku">Haiku</option>
                      <option value="sonnet">Sonnet</option>
                      <option value="opus">Opus</option>
                    </select>
                  </div>
                  <input
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('templateDescription')}
                    className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
                  />
                  <textarea
                    value={templateForm.task_prompt}
                    onChange={(e) => setTemplateForm(f => ({ ...f, task_prompt: e.target.value }))}
                    placeholder={t('taskPromptPlaceholder')}
                    rows={3}
                    className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-sm text-foreground resize-none"
                  />
                  {/* Tags */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 flex-wrap flex-1">
                      {templateForm.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                          {tag}
                          <Button variant="ghost" size="xs" onClick={() => removeTag(tag)} className="hover:text-primary/70 h-auto p-0 min-w-0">x</Button>
                        </span>
                      ))}
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
                        onBlur={addTag}
                        placeholder={templateForm.tags.length === 0 ? 'Tags (comma-separated)' : 'Add tag...'}
                        className="h-6 px-1 bg-transparent border-none text-xs text-foreground placeholder:text-muted-foreground outline-none min-w-[80px] flex-1"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-2xs text-muted-foreground">{t('timeout')}</label>
                      <select
                        value={templateForm.timeout_seconds}
                        onChange={(e) => setTemplateForm(f => ({ ...f, timeout_seconds: parseInt(e.target.value) }))}
                        className="h-6 px-1 rounded bg-secondary border border-border text-2xs text-foreground"
                      >
                        <option value={60}>1 min</option>
                        <option value={120}>2 min</option>
                        <option value={300}>5 min</option>
                        <option value={600}>10 min</option>
                        <option value={1800}>30 min</option>
                        <option value={3600}>1 hour</option>
                      </select>
                    </div>
                    <Button
                      onClick={saveTemplate}
                      disabled={!templateForm.name || !templateForm.task_prompt}
                      size="xs"
                    >
                      {formMode === 'edit' ? t('update') : t('save')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Template list */}
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {filteredTemplates.map(tmpl => (
                  <div key={tmpl.id} className="rounded-md bg-secondary/30 hover:bg-secondary/50 transition-smooth group">
                    <div className="flex items-center gap-2 p-2">
                      <Button
                        variant="ghost"
                        onClick={() => setExpandedId(expandedId === tmpl.id ? null : tmpl.id)}
                        className="flex-1 min-w-0 text-left h-auto p-0 rounded-none"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{tmpl.name}</span>
                          <span className="text-2xs text-muted-foreground font-mono">{tmpl.model}</span>
                          {tmpl.use_count > 0 && (
                            <span className="text-2xs text-muted-foreground">{tmpl.use_count}x</span>
                          )}
                          {(tmpl.tags || []).map(tag => (
                            <span key={tag} className="text-2xs px-1 py-0.5 rounded bg-secondary text-muted-foreground">{tag}</span>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{tmpl.description || tmpl.task_prompt}</p>
                      </Button>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
                        <Button
                          onClick={() => executeTemplate(tmpl)}
                          disabled={spawning === tmpl.id}
                          size="xs"
                          title="Run"
                        >
                          {spawning === tmpl.id ? '...' : 'Run'}
                        </Button>
                        <Button
                          onClick={() => startEdit(tmpl)}
                          variant="secondary"
                          size="icon-xs"
                          title="Edit"
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                            <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Button>
                        <Button
                          onClick={() => duplicateTemplate(tmpl)}
                          variant="secondary"
                          size="icon-xs"
                          title="Duplicate"
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                            <rect x="5" y="5" width="9" height="9" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M3 11V3a1 1 0 011-1h8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Button>
                        <Button
                          onClick={() => deleteTemplate(tmpl.id)}
                          variant="destructive"
                          size="icon-xs"
                          title="Delete"
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                          </svg>
                        </Button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {expandedId === tmpl.id && (
                      <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-2">
                        <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono bg-secondary/50 rounded p-2 max-h-32 overflow-y-auto">
                          {tmpl.task_prompt}
                        </pre>
                        <div className="flex items-center gap-3 mt-2 text-2xs text-muted-foreground">
                          <span>{t('timeout')}: {tmpl.timeout_seconds < 60 ? `${tmpl.timeout_seconds}s` : `${Math.round(tmpl.timeout_seconds / 60)}m`}</span>
                          {tmpl.agent_role && <span>{t('role')}: {tmpl.agent_role}</span>}
                          {tmpl.last_used_at && (
                            <span>{t('lastRun')}: {new Date(tmpl.last_used_at * 1000).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Pipelines Tab */}
      {activeTab === 'pipelines' && (
        <div className="p-4 pt-3">
          <PipelineTab />
        </div>
      )}

      {/* Fleet Tab */}
      {activeTab === 'fleet' && (
        <div className="p-4 pt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FleetCard label={t('totalAgents')} value={agents.length} />
            <FleetCard label={t('online')} value={onlineCount} color="green" />
            <FleetCard label={t('busy')} value={busyCount} color="amber" />
            <FleetCard label={t('errors')} value={errorCount} color={errorCount > 0 ? 'red' : undefined} />
          </div>
          {agents.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {agents.map(a => (
                <div
                  key={a.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 text-xs"
                  title={`${a.name} - ${a.role} - ${a.status}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    a.status === 'busy' ? 'bg-amber-500' :
                    a.status === 'idle' ? 'bg-green-500' :
                    a.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                  }`} />
                  <span className="text-foreground font-medium">{a.name}</span>
                  <span className="text-muted-foreground">{a.role}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FleetCard({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorClass = color === 'green' ? 'text-green-400' :
    color === 'amber' ? 'text-amber-400' :
    color === 'red' ? 'text-red-400' : 'text-foreground'

  return (
    <div className="p-2.5 rounded-lg bg-secondary/50 border border-border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono-tight ${colorClass}`}>{value}</div>
    </div>
  )
}
