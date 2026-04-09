'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/types/sql'
import { TEMPLATES, DEFAULT_MODEL_BY_TIER } from './agent-detail-utils'
import { StepTemplate } from './create-agent-step-template'
import { StepConfig } from './create-agent-step-config'
import { StepReview } from './create-agent-step-review'

interface CreateAgentModalProps {
  onClose: () => void
  onCreated: () => void
}

type ProgressStep = { label: string; status: 'pending' | 'active' | 'done' | 'error'; error?: string }

interface FormData {
  name: string
  id: string
  role: string
  emoji: string
  modelTier: 'opus' | 'sonnet' | 'haiku'
  modelPrimary: string
  workspaceAccess: 'rw' | 'ro' | 'none'
  sandboxMode: 'all' | 'non-main'
  dockerNetwork: 'none' | 'bridge'
  session_key: string
  write_to_gateway: boolean
  provision_openclaw_workspace: boolean
}

const DEFAULT_FORM_DATA: FormData = {
  name: '',
  id: '',
  role: '',
  emoji: '',
  modelTier: 'sonnet',
  modelPrimary: DEFAULT_MODEL_BY_TIER.sonnet,
  workspaceAccess: 'rw',
  sandboxMode: 'all',
  dockerNetwork: 'none',
  session_key: '',
  write_to_gateway: true,
  provision_openclaw_workspace: true,
}

export function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
  const t = useTranslations('agentDetail')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[] | null>(null)

  const selectedTemplateData = TEMPLATES.find(tmpl => tmpl.type === selectedTemplate)

  // Auto-generate kebab-case ID from name
  const updateName = (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setFormData(prev => ({ ...prev, name, id }))
  }

  const updateField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
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

  // When template is selected, pre-fill form and advance to step 2
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
    setStep(2)
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

          {step === 1 && (
            <StepTemplate selectedTemplate={selectedTemplate} onSelect={selectTemplate} />
          )}

          {step === 2 && (
            <StepConfig
              formData={formData}
              availableModels={availableModels}
              onNameChange={updateName}
              onFieldChange={updateField}
            />
          )}

          {step === 3 && (
            <StepReview
              formData={formData}
              selectedTemplateLabel={selectedTemplateData?.label}
              selectedTemplateEmoji={selectedTemplateData?.emoji}
              selectedTemplateToolCount={selectedTemplateData?.toolCount}
              progressSteps={progressSteps}
              onWriteToGatewayChange={(checked) => updateField('write_to_gateway', checked)}
              onProvisionWorkspaceChange={(checked) => updateField('provision_openclaw_workspace', checked)}
            />
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
                <Button onClick={() => setStep((step - 1) as 1 | 2)} variant="secondary">
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
