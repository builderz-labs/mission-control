'use client'

import { useState, useEffect, useCallback } from 'react'

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

export function OrchestrationBar() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [activeTab, setActiveTab] = useState<'command' | 'templates' | 'fleet'>('command')

  // Command state
  const [selectedAgent, setSelectedAgent] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [commandResult, setCommandResult] = useState<{ ok: boolean; text: string } | null>(null)

  // Template state
  const [showCreateTemplate, setShowCreateTemplate] = useState(false)
  const [templateForm, setTemplateForm] = useState({
    name: '', description: '', model: 'sonnet', task_prompt: '', timeout_seconds: 300, agent_role: ''
  })
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
        // Increment use count
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

  // Save template
  const saveTemplate = async () => {
    if (!templateForm.name || !templateForm.task_prompt) return
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateForm)
      })
      if (res.ok) {
        setShowCreateTemplate(false)
        setTemplateForm({ name: '', description: '', model: 'sonnet', task_prompt: '', timeout_seconds: 300, agent_role: '' })
        fetchData()
      }
    } catch {
      // ignore
    }
  }

  // Delete template
  const deleteTemplate = async (id: number) => {
    await fetch(`/api/workflows?id=${id}`, { method: 'DELETE' })
    fetchData()
  }

  // Fleet metrics
  const onlineCount = agents.filter(a => a.status === 'idle' || a.status === 'busy').length
  const busyCount = agents.filter(a => a.status === 'busy').length
  const errorCount = agents.filter(a => a.status === 'error').length

  return (
    <div className="border-b border-border bg-card/50">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-2">
        {(['command', 'templates', 'fleet'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-smooth ${
              activeTab === tab
                ? 'bg-secondary text-foreground border border-border border-b-transparent'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'command' ? 'Command' : tab === 'templates' ? 'Workflows' : 'Fleet'}
            {tab === 'fleet' && (
              <span className={`ml-1.5 text-2xs ${errorCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {onlineCount}/{agents.length}
              </span>
            )}
          </button>
        ))}
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
              <option value="">Select agent...</option>
              {agents.filter(a => a.session_key).map(a => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.status})
                </option>
              ))}
            </select>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
              placeholder="Send command or message to agent..."
              className="flex-1 h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground"
            />
            <button
              onClick={sendCommand}
              disabled={!selectedAgent || !message.trim() || sending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-smooth"
            >
              {sending ? '...' : 'Send'}
            </button>
          </div>
          {commandResult && (
            <div className={`mt-2 text-xs ${commandResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {commandResult.text}
            </div>
          )}
        </div>
      )}

      {/* Workflows Tab */}
      {activeTab === 'templates' && (
        <div className="p-4 pt-3">
          {templates.length === 0 && !showCreateTemplate ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-2">No workflow templates yet</p>
              <button
                onClick={() => setShowCreateTemplate(true)}
                className="text-sm text-primary hover:underline"
              >
                Create your first template
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">{templates.length} templates</span>
                <button
                  onClick={() => setShowCreateTemplate(!showCreateTemplate)}
                  className="text-xs text-primary hover:underline"
                >
                  {showCreateTemplate ? 'Cancel' : '+ New'}
                </button>
              </div>

              {showCreateTemplate && (
                <div className="mb-3 p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Template name"
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
                  <textarea
                    value={templateForm.task_prompt}
                    onChange={(e) => setTemplateForm(f => ({ ...f, task_prompt: e.target.value }))}
                    placeholder="Task prompt for the agent..."
                    rows={2}
                    className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-sm text-foreground resize-none"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={saveTemplate}
                      disabled={!templateForm.name || !templateForm.task_prompt}
                      className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                    >
                      Save Template
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center gap-2 p-2 rounded-md bg-secondary/30 hover:bg-secondary/50 transition-smooth group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
                        <span className="text-2xs text-muted-foreground font-mono">{t.model}</span>
                        {t.use_count > 0 && (
                          <span className="text-2xs text-muted-foreground">{t.use_count}x</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{t.task_prompt}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth">
                      <button
                        onClick={() => executeTemplate(t)}
                        disabled={spawning === t.id}
                        className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                      >
                        {spawning === t.id ? '...' : 'Run'}
                      </button>
                      <button
                        onClick={() => deleteTemplate(t.id)}
                        className="h-7 px-2 rounded-md bg-destructive/20 text-destructive text-xs hover:bg-destructive/30"
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Fleet Tab */}
      {activeTab === 'fleet' && (
        <div className="p-4 pt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FleetCard label="Total Agents" value={agents.length} />
            <FleetCard label="Online" value={onlineCount} color="green" />
            <FleetCard label="Busy" value={busyCount} color="amber" />
            <FleetCard label="Errors" value={errorCount} color={errorCount > 0 ? 'red' : undefined} />
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
