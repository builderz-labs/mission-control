'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/types/sql'
import { TEMPLATES, MODEL_TIER_COLORS, MODEL_TIER_LABELS, DEFAULT_MODEL_BY_TIER } from './agent-detail-utils'

interface CreateAgentModalProps {
  onClose: () => void
  onCreated: () => void
}

type ProgressStep = { label: string; status: 'pending' | 'active' | 'done' | 'error'; error?: string }

export function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
  const t = useTranslations('agentDetail')
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
  const [progressSteps, setProgressSteps] = useState<ProgressStep[] | null>(null)

  const selectedTemplateData = TEMPLATES.find(tmpl => tmpl.type === selectedTemplate)

  // Auto-generate kebab-case ID from name
  const updateName = (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setFormData(prev => ({ ...prev, name, id }))
  }

  useEffect(() => {
    const controller = new AbortController()
    const loadAvailableModels = async () => {
      try {
        const response = await fetch('/api/status?action=models', { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((model: Record<string, unknown>) => String(model.name || model.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Keep modal usable without model suggestions
      }
    }
    loadAvailableModels()
    return () => controller.abort()
  }, [])

  // When template is selected, pre-fill form
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

    const steps: ProgressStep[] = [
      { label: t('stepCreatingRecord'), status: 'pending' },
    ]
    if (formData.write_to_gateway) {
      steps.push({ label: t('stepWritingGateway'), status: 'pending' })
    }
    if (formData.provision_openclaw_workspace) {
      steps.push({ label: t('stepProvisioningWorkspace'), status: 'pending' })
    }
    setProgressSteps([...steps])

    // Animate steps to 'active' one-by-one with stagger
    const animateSteps = async () => {
      for (let i = 0; i < steps.length; i++) {
        await new Promise(r => setTimeout(r, 300))
        steps[i].status = 'active'
        setProgressSteps([...steps])
      }
    }

    try {
      const primaryModel = formData.modelPrimary.trim() || DEFAULT_MODEL_BY_TIER[formData.modelTier]

      // Run animation and fetch concurrently
      const [response] = await Promise.all([
        fetch('/api/agents', {
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
        }),
        animateSteps(),
      ])

      if (!response.ok) {
        const data = await response.json()
        const errMsg = data.error || 'Failed to create agent'
        const failIdx =
          /provision|openclaw/i.test(errMsg) ? steps.findIndex(s => s.label.includes('Provisioning')) :
          /gateway/i.test(errMsg) ? steps.findIndex(s => s.label.includes('gateway')) :
          0
        const idx = failIdx >= 0 ? failIdx : 0
        steps[idx].status = 'error'
        steps[idx].error = errMsg
        for (let i = idx + 1; i < steps.length; i++) steps[i].status = 'pending'
        setProgressSteps([...steps])
        return
      }

      for (const s of steps) s.status = 'done'
      setProgressSteps([...steps])
      setTimeout(() => { onCreated(); onClose() }, 1500)
    } catch (err: unknown) {
      steps[0].status = 'error'
      steps[0].error = getErrorMessage(err) || 'Unexpected error'
      for (let i = 1; i < steps.length; i++) steps[i].status = 'pending'
      setProgressSteps([...steps])
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
              <h3 className="text-xl font-bold text-foreground">{t('createNewAgent')}</h3>
              <div className="flex gap-3 mt-2">
                {[1, 2, 3].map(s => (
                  <div key={s} className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      step === s ? 'bg-primary text-primary-foreground' :
                      step > s ? 'bg-green-500/20 text-green-400' :
                      'bg-surface-2 text-muted-foreground'
                    }`}>
                      {step > s ? '✓' : s}
                    </div>
                    <span className={`text-xs ${step === s ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {s === 1 ? t('stepTemplate') : s === 2 ? t('stepConfigure') : t('stepReview')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">x</Button>
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
                <Button
                  key={tmpl.type}
                  onClick={() => { selectTemplate(tmpl.type); setStep(2) }}
                  variant="outline"
                  className={`p-4 h-auto text-left flex flex-col items-start ${
                    selectedTemplate === tmpl.type ? 'border-primary bg-primary/5' : ''
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
                      {t('toolCount', { count: tmpl.toolCount })}
                    </span>
                  </div>
                </Button>
              ))}
              {/* Custom option */}
              <Button
                onClick={() => { selectTemplate(null); setStep(2) }}
                variant="outline"
                className={`p-4 h-auto text-left flex flex-col items-start border-dashed ${
                  selectedTemplate === null ? 'border-primary' : ''
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">+</span>
                  <span className="font-semibold text-foreground">Custom</span>
                </div>
                <p className="text-xs text-muted-foreground">{t('customDesc')}</p>
              </Button>
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('displayName')}</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateName(e.target.value)}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder={t('displayNamePlaceholder')}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('agentId')}</label>
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
                  <label className="block text-sm text-muted-foreground mb-1">{t('roleTheme')}</label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="builder engineer"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('emoji')}</label>
                  <input
                    type="text"
                    value={formData.emoji}
                    onChange={(e) => setFormData(prev => ({ ...prev, emoji: e.target.value }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="e.g. 🛠️"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">{t('modelTier')}</label>
                <div className="flex gap-2">
                  {(['opus', 'sonnet', 'haiku'] as const).map(tier => (
                    <Button
                      key={tier}
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        modelTier: tier,
                        modelPrimary: DEFAULT_MODEL_BY_TIER[tier],
                      }))}
                      variant={formData.modelTier === tier ? 'outline' : 'secondary'}
                      className={`flex-1 ${
                        formData.modelTier === tier ? MODEL_TIER_COLORS[tier] : ''
                      }`}
                    >
                      {MODEL_TIER_LABELS[tier]}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">{t('primaryModel')}</label>
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
                  <label className="block text-sm text-muted-foreground mb-1">{t('workspace')}</label>
                  <select
                    value={formData.workspaceAccess}
                    onChange={(e) => setFormData(prev => ({ ...prev, workspaceAccess: e.target.value as 'rw' | 'ro' | 'none' }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="rw">{t('readWrite')}</option>
                    <option value="ro">{t('readOnly')}</option>
                    <option value="none">{t('none')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('sandbox')}</label>
                  <select
                    value={formData.sandboxMode}
                    onChange={(e) => setFormData(prev => ({ ...prev, sandboxMode: e.target.value as 'all' | 'non-main' }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="all">{t('sandboxAll')}</option>
                    <option value="non-main">{t('sandboxNonMain')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">{t('network')}</label>
                  <select
                    value={formData.dockerNetwork}
                    onChange={(e) => setFormData(prev => ({ ...prev, dockerNetwork: e.target.value as 'none' | 'bridge' }))}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="none">{t('networkIsolated')}</option>
                    <option value="bridge">{t('networkBridge')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">{t('sessionKeyOptional')}</label>
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder={t('sessionKeyPlaceholder')}
                />
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="space-y-4">
              {progressSteps ? (
                <div className="space-y-3 py-4">
                  <h4 className="text-sm font-medium text-muted-foreground mb-4">{t('settingUpAgent')}</h4>
                  {progressSteps.map((ps, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                        {ps.status === 'active' && (
                          <span className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        )}
                        {ps.status === 'done' && (
                          <span className="text-green-400 text-sm font-bold">✓</span>
                        )}
                        {ps.status === 'error' && (
                          <span className="text-red-400 text-sm font-bold">✕</span>
                        )}
                        {ps.status === 'pending' && (
                          <span className="inline-block w-3 h-3 rounded-full border border-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${
                          ps.status === 'error' ? 'text-red-400' :
                          ps.status === 'done' ? 'text-green-400' :
                          ps.status === 'active' ? 'text-foreground' :
                          'text-muted-foreground'
                        }`}>{ps.label}</span>
                        {ps.error && (
                          <p className="text-xs text-red-400/80 mt-1">{ps.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {progressSteps.every(s => s.status === 'done') && (
                    <p className="text-sm text-green-400 mt-4">{t('agentCreatedSuccess')}</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="bg-surface-1/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{formData.emoji || (selectedTemplateData?.emoji || '?')}</span>
                      <div>
                        <h4 className="text-lg font-bold text-foreground">{formData.name || 'Unnamed'}</h4>
                        <p className="text-muted-foreground text-sm">{formData.role}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground">{t('idLabel')}:</span> <span className="text-foreground font-mono">{formData.id}</span></div>
                      <div><span className="text-muted-foreground">{t('templateLabel')}:</span> <span className="text-foreground">{selectedTemplateData?.label || t('custom')}</span></div>
                      <div><span className="text-muted-foreground">{t('model')}:</span> <span className={`px-2 py-0.5 rounded text-xs ${MODEL_TIER_COLORS[formData.modelTier]}`}>{MODEL_TIER_LABELS[formData.modelTier]}</span></div>
                      <div><span className="text-muted-foreground">{t('toolsLabel')}:</span> <span className="text-foreground">{selectedTemplateData?.toolCount || t('custom')}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground">{t('primaryModel')}:</span> <span className="text-foreground font-mono">{formData.modelPrimary || DEFAULT_MODEL_BY_TIER[formData.modelTier]}</span></div>
                      <div><span className="text-muted-foreground">{t('workspace')}:</span> <span className="text-foreground">{formData.workspaceAccess}</span></div>
                      <div><span className="text-muted-foreground">{t('sandbox')}:</span> <span className="text-foreground">{formData.sandboxMode}</span></div>
                      <div><span className="text-muted-foreground">{t('network')}:</span> <span className="text-foreground">{formData.dockerNetwork}</span></div>
                      {formData.session_key && (
                        <div><span className="text-muted-foreground">{t('session')}:</span> <span className="text-foreground font-mono">{formData.session_key}</span></div>
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
                    <span className="text-sm text-foreground">{t('addToGateway')}</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.provision_openclaw_workspace}
                      onChange={(e) => setFormData(prev => ({ ...prev, provision_openclaw_workspace: e.target.checked }))}
                      className="w-4 h-4 rounded border-border"
                    />
                    <span className="text-sm text-foreground">{t('provisionWorkspace')}</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex gap-3 flex-shrink-0">
          {progressSteps ? (
            progressSteps.some(s => s.status === 'error') ? (
              <>
                <div className="flex-1" />
                <Button onClick={() => { setProgressSteps(null); handleCreate() }} size="lg">
                  {t('retry')}
                </Button>
                <Button onClick={onClose} variant="secondary">
                  {t('close')}
                </Button>
              </>
            ) : progressSteps.every(s => s.status === 'done') ? (
              <>
                <div className="flex-1" />
                <span className="text-sm text-muted-foreground self-center">{t('closing')}</span>
              </>
            ) : (
              <div className="flex-1" />
            )
          ) : (
            <>
              {step > 1 && (
                <Button
                  onClick={() => setStep((step - 1) as 1 | 2)}
                  variant="secondary"
                >
                  {t('back')}
                </Button>
              )}
              <div className="flex-1" />
              {step < 3 ? (
                <Button
                  onClick={() => setStep((step + 1) as 2 | 3)}
                  disabled={step === 2 && !formData.name.trim()}
                  size="lg"
                >
                  {t('next')}
                </Button>
              ) : (
                <Button
                  onClick={handleCreate}
                  disabled={isCreating || !formData.name.trim()}
                  size="lg"
                >
                  {t('createAgent')}
                </Button>
              )}
              <Button onClick={onClose} variant="secondary">
                {t('cancel')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
