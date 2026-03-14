'use client'

import { useState, useEffect } from 'react'

const TEMPLATES = [
  { type: 'orchestrator', label: 'Orchestrator', emoji: '\ud83e\udded', description: 'Primary coordinator with full tool access', modelTier: 'opus' as const, toolCount: 23, theme: 'operator strategist' },
  { type: 'developer', label: 'Developer', emoji: '\ud83d\udee0\ufe0f', description: 'Full-stack builder with Docker bridge', modelTier: 'sonnet' as const, toolCount: 21, theme: 'builder engineer' },
  { type: 'specialist-dev', label: 'Specialist Dev', emoji: '\u2699\ufe0f', description: 'Focused developer for specific domains', modelTier: 'sonnet' as const, toolCount: 15, theme: 'specialist developer' },
  { type: 'reviewer', label: 'Reviewer / QA', emoji: '\ud83d\udd2c', description: 'Read-only code review and quality gates', modelTier: 'haiku' as const, toolCount: 7, theme: 'quality reviewer' },
  { type: 'researcher', label: 'Researcher', emoji: '\ud83d\udd0d', description: 'Browser and web access for research', modelTier: 'sonnet' as const, toolCount: 8, theme: 'research analyst' },
  { type: 'content-creator', label: 'Content Creator', emoji: '\u270f\ufe0f', description: 'Write and edit for content generation', modelTier: 'haiku' as const, toolCount: 9, theme: 'content creator' },
  { type: 'security-auditor', label: 'Security Auditor', emoji: '\ud83d\udee1\ufe0f', description: 'Read-only + bash for security scanning', modelTier: 'sonnet' as const, toolCount: 10, theme: 'security auditor' },
]

const MODEL_TIER_COLORS: Record<string, string> = {
  opus: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  sonnet: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  haiku: 'bg-green-500/20 text-green-400 border-green-500/30',
}

const MODEL_TIER_LABELS: Record<string, string> = {
  opus: 'Opus $$$',
  sonnet: 'Sonnet $$',
  haiku: 'Haiku $',
}

const DEFAULT_MODEL_BY_TIER: Record<'opus' | 'sonnet' | 'haiku', string> = {
  opus: 'anthropic/claude-opus-4-5',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'anthropic/claude-haiku-4-5',
}

export function CreateAgentModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [formData, setFormData] = useState({
    name: '',
    id: '',
    role: '',
    emoji: '',
    modelTier: 'sonnet' as 'opus' | 'sonnet' | 'haiku',
    modelPrimary: DEFAULT_MODEL_BY_TIER.sonnet,
    workspaceAccess: 'rw' as 'rw' | 'ro' | 'none',
    sandboxMode: 'all' as 'all' | 'non-main',
    dockerNetwork: 'none' as 'none' | 'bridge',
    session_key: '',
    write_to_gateway: true,
    provision_openclaw_workspace: true,
  })
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTemplateData = TEMPLATES.find(t => t.type === selectedTemplate)

  const updateName = (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setFormData(prev => ({ ...prev, name, id }))
  }

  useEffect(() => {
    const loadAvailableModels = async () => {
      try {
        const response = await fetch('/api/status?action=models')
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((model: any) => String(model.name || model.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Keep modal usable without model suggestions.
      }
    }
    loadAvailableModels()
  }, [])

  const selectTemplate = (type: string | null) => {
    setSelectedTemplate(type)
    if (type) {
      const tmpl = TEMPLATES.find(t => t.type === type)
      if (tmpl) {
        setFormData(prev => ({
          ...prev,
          role: tmpl.theme,
          emoji: tmpl.emoji,
          modelTier: tmpl.modelTier,
          modelPrimary: DEFAULT_MODEL_BY_TIER[tmpl.modelTier],
          workspaceAccess: type === 'researcher' || type === 'content-creator' ? 'none' : type === 'reviewer' || type === 'security-auditor' ? 'ro' : 'rw',
          sandboxMode: type === 'orchestrator' ? 'non-main' : 'all',
          dockerNetwork: type === 'developer' || type === 'specialist-dev' ? 'bridge' : 'none',
        }))
      }
    }
  }

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }
    setIsCreating(true)
    setError(null)
    try {
      const primaryModel = formData.modelPrimary.trim() || DEFAULT_MODEL_BY_TIER[formData.modelTier]
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          openclaw_id: formData.id || undefined,
          role: formData.role,
          session_key: formData.session_key || undefined,
          template: selectedTemplate || undefined,
          write_to_gateway: formData.write_to_gateway,
          provision_openclaw_workspace: formData.provision_openclaw_workspace,
          gateway_config: {
            model: { primary: primaryModel },
            identity: { name: formData.name, theme: formData.role, emoji: formData.emoji },
            sandbox: {
              mode: formData.sandboxMode,
              workspaceAccess: formData.workspaceAccess,
              scope: 'agent',
              ...(formData.dockerNetwork === 'bridge' ? { docker: { network: 'bridge' } } : {}),
            },
          },
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create agent')
      }
      onCreated()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border flex-shrink-0">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold text-foreground">Create New Agent</h3>
              <div className="flex gap-3 mt-2">
                {[1, 2, 3].map(s => (
                  <div key={s} className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      step === s ? 'bg-primary text-primary-foreground' :
                      step > s ? 'bg-green-500/20 text-green-400' :
                      'bg-surface-2 text-muted-foreground'
                    }`}>
                      {step > s ? '\u2713' : s}
                    </div>
                    <span className={`text-xs ${step === s ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {s === 1 ? 'Template' : s === 2 ? 'Configure' : 'Review'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl">x</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 mb-4 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Choose Template */}
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              {TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.type}
                  onClick={() => { selectTemplate(tmpl.type); setStep(2) }}
                  className={`p-4 rounded-lg border text-left transition-smooth hover:bg-surface-1 ${
                    selectedTemplate === tmpl.type ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{tmpl.emoji}</span>
                    <span className="font-semibold text-foreground">{tmpl.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{tmpl.description}</p>
                  <div className="flex gap-2">
                    <span className={`px-2 py-0.5 text-xs rounded border ${MODEL_TIER_COLORS[tmpl.modelTier]}`}>
                      {MODEL_TIER_LABELS[tmpl.modelTier]}
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded bg-surface-2 text-muted-foreground">
                      {tmpl.toolCount} tools
                    </span>
                  </div>
                </button>
              ))}
              {/* Custom option */}
              <button
                onClick={() => { selectTemplate(null); setStep(2) }}
                className={`p-4 rounded-lg border text-left transition-smooth hover:bg-surface-1 border-dashed ${
                  selectedTemplate === null ? 'border-primary' : 'border-border'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">+</span>
                  <span className="font-semibold text-foreground">Custom</span>
                </div>
                <p className="text-xs text-muted-foreground">Start from scratch with blank config</p>
              </button>
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Display Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateName(e.target.value)}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="e.g., Frontend Dev"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Agent ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
                    placeholder="frontend-dev"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Role / Theme</label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="builder engineer"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Emoji</label>
                  <input
                    type="text"
                    value={formData.emoji}
                    onChange={(e) => setFormData(prev => ({ ...prev, emoji: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="e.g. \ud83d\udee0\ufe0f"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">Model Tier</label>
                <div className="flex gap-2">
                  {(['opus', 'sonnet', 'haiku'] as const).map(tier => (
                    <button
                      key={tier}
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        modelTier: tier,
                        modelPrimary: DEFAULT_MODEL_BY_TIER[tier],
                      }))}
                      className={`flex-1 px-3 py-2 text-sm rounded-md border transition-smooth ${
                        formData.modelTier === tier ? MODEL_TIER_COLORS[tier] + ' border' : 'bg-surface-1 text-muted-foreground border-border'
                      }`}
                    >
                      {MODEL_TIER_LABELS[tier]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">Primary Model</label>
                <input
                  type="text"
                  value={formData.modelPrimary}
                  onChange={(e) => setFormData(prev => ({ ...prev, modelPrimary: e.target.value }))}
                  list="create-agent-model-suggestions"
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono text-sm"
                  placeholder={DEFAULT_MODEL_BY_TIER[formData.modelTier]}
                />
                <datalist id="create-agent-model-suggestions">
                  {availableModels.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Workspace</label>
                  <select
                    value={formData.workspaceAccess}
                    onChange={(e) => setFormData(prev => ({ ...prev, workspaceAccess: e.target.value as typeof prev.workspaceAccess }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="rw">Read/Write</option>
                    <option value="ro">Read Only</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Sandbox</label>
                  <select
                    value={formData.sandboxMode}
                    onChange={(e) => setFormData(prev => ({ ...prev, sandboxMode: e.target.value as typeof prev.sandboxMode }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="all">All (Docker)</option>
                    <option value="non-main">Non-main</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Network</label>
                  <select
                    value={formData.dockerNetwork}
                    onChange={(e) => setFormData(prev => ({ ...prev, dockerNetwork: e.target.value as typeof prev.dockerNetwork }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="none">None (isolated)</option>
                    <option value="bridge">Bridge (internet)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">Session Key (optional)</label>
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder="OpenClaw session identifier"
                />
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-surface-1/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{formData.emoji || (selectedTemplateData?.emoji || '?')}</span>
                  <div>
                    <h4 className="text-lg font-bold text-foreground">{formData.name || 'Unnamed'}</h4>
                    <p className="text-muted-foreground text-sm">{formData.role}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{formData.id}</span></div>
                  <div><span className="text-muted-foreground">Template:</span> <span className="text-foreground">{selectedTemplateData?.label || 'Custom'}</span></div>
                  <div><span className="text-muted-foreground">Model:</span> <span className={`px-2 py-0.5 rounded text-xs ${MODEL_TIER_COLORS[formData.modelTier]}`}>{MODEL_TIER_LABELS[formData.modelTier]}</span></div>
                  <div><span className="text-muted-foreground">Tools:</span> <span className="text-foreground">{selectedTemplateData?.toolCount || 'Custom'}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Primary Model:</span> <span className="text-foreground font-mono">{formData.modelPrimary || DEFAULT_MODEL_BY_TIER[formData.modelTier]}</span></div>
                  <div><span className="text-muted-foreground">Workspace:</span> <span className="text-foreground">{formData.workspaceAccess}</span></div>
                  <div><span className="text-muted-foreground">Sandbox:</span> <span className="text-foreground">{formData.sandboxMode}</span></div>
                  <div><span className="text-muted-foreground">Network:</span> <span className="text-foreground">{formData.dockerNetwork}</span></div>
                  {formData.session_key && (
                    <div><span className="text-muted-foreground">Session:</span> <span className="text-foreground font-mono">{formData.session_key}</span></div>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.write_to_gateway}
                  onChange={(e) => setFormData(prev => ({ ...prev, write_to_gateway: e.target.checked }))}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-foreground">Add to gateway config (openclaw.json)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.provision_openclaw_workspace}
                  onChange={(e) => setFormData(prev => ({ ...prev, provision_openclaw_workspace: e.target.checked }))}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-foreground">Provision full OpenClaw workspace (`openclaw agents add`)</span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex gap-3 flex-shrink-0">
          {step > 1 && (
            <button
              onClick={() => setStep((step - 1) as 1 | 2)}
              className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth"
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as 2 | 3)}
              disabled={step === 2 && !formData.name.trim()}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={isCreating || !formData.name.trim()}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
            >
              {isCreating ? 'Creating...' : 'Create Agent'}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
