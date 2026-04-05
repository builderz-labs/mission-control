'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { WorkflowTemplate, PipelineStep } from './pipeline-types'

interface PipelineFormProps {
  formMode: 'create' | 'edit'
  formName: string
  formDesc: string
  formSteps: PipelineStep[]
  templates: WorkflowTemplate[]
  onNameChange: (v: string) => void
  onDescChange: (v: string) => void
  onAddStep: (templateId: number) => void
  onRemoveStep: (index: number) => void
  onMoveStep: (index: number, dir: -1 | 1) => void
  onFailureChange: (index: number, value: 'stop' | 'continue') => void
  onSave: () => void
}

export function PipelineForm({
  formMode,
  formName,
  formDesc,
  formSteps,
  templates,
  onNameChange,
  onDescChange,
  onAddStep,
  onRemoveStep,
  onMoveStep,
  onFailureChange,
  onSave,
}: PipelineFormProps): React.JSX.Element {
  const t = useTranslations('pipeline')

  return (
    <div className="p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
      <span className="text-xs font-medium">{formMode === 'edit' ? t('editPipeline') : t('newPipeline')}</span>
      <input
        value={formName}
        onChange={e => onNameChange(e.target.value)}
        placeholder={t('pipelineNamePlaceholder')}
        className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
      />
      <input
        value={formDesc}
        onChange={e => onDescChange(e.target.value)}
        placeholder={t('descriptionPlaceholder')}
        className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
      />

      <div className="space-y-1">
        <span className="text-2xs text-muted-foreground">Steps ({formSteps.length})</span>
        {formSteps.map((step, i) => (
          <StepRow
            key={i}
            step={step}
            index={i}
            isFirst={i === 0}
            isLast={i === formSteps.length - 1}
            onMove={onMoveStep}
            onRemove={onRemoveStep}
            onFailureChange={onFailureChange}
            t={t}
          />
        ))}

        <select
          onChange={e => { if (e.target.value) { onAddStep(parseInt(e.target.value)); e.target.value = '' } }}
          className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-muted-foreground"
          defaultValue=""
        >
          <option value="" disabled>{t('addStepPlaceholder')}</option>
          {templates.map(tmpl => (
            <option key={tmpl.id} value={tmpl.id}>{tmpl.name} ({tmpl.model})</option>
          ))}
        </select>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={!formName || formSteps.length < 2} size="xs">
          {formMode === 'edit' ? t('update') : t('savePipeline')}
        </Button>
      </div>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFn = (key: string, values?: Record<string, any>) => string

function StepRow({
  step,
  index,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onFailureChange,
  t,
}: {
  step: PipelineStep
  index: number
  isFirst: boolean
  isLast: boolean
  onMove: (index: number, dir: -1 | 1) => void
  onRemove: (index: number) => void
  onFailureChange: (index: number, value: 'stop' | 'continue') => void
  t: TranslationFn
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 p-1.5 rounded bg-secondary/80 text-xs">
      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-2xs font-bold flex items-center justify-center shrink-0">
        {index + 1}
      </span>
      <span className="flex-1 truncate text-foreground">{step.template_name || `Template #${step.template_id}`}</span>
      <select
        value={step.on_failure}
        onChange={e => onFailureChange(index, e.target.value as 'stop' | 'continue')}
        className="h-5 px-1 text-2xs rounded bg-secondary border border-border text-foreground"
      >
        <option value="stop">{t('stopOnFail')}</option>
        <option value="continue">{t('continueOnFail')}</option>
      </select>
      <Button onClick={() => onMove(index, -1)} variant="ghost" size="icon-xs" className="w-5 h-5" title="Move up" disabled={isFirst}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 3v10M4 7l4-4 4 4" /></svg>
      </Button>
      <Button onClick={() => onMove(index, 1)} variant="ghost" size="icon-xs" className="w-5 h-5" title="Move down" disabled={isLast}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 13V3M4 9l4 4 4-4" /></svg>
      </Button>
      <Button onClick={() => onRemove(index)} variant="ghost" size="icon-xs" className="w-5 h-5 text-red-400 hover:text-red-300">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
      </Button>
    </div>
  )
}
