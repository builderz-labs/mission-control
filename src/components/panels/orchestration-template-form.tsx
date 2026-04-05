'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { TemplateFormData } from './orchestration-bar.types'

interface TemplateFormProps {
  formMode: 'create' | 'edit'
  templateForm: TemplateFormData
  tagInput: string
  onFormChange: (field: keyof TemplateFormData, value: string | number | string[]) => void
  onTagInputChange: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
  onSave: () => void
}

export function TemplateForm({
  formMode,
  templateForm,
  tagInput,
  onFormChange,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  onSave,
}: TemplateFormProps): React.ReactElement {
  const t = useTranslations('orchestration')

  return (
    <div className="mb-3 p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-foreground">
          {formMode === 'edit' ? t('editTemplate') : t('newTemplate')}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={templateForm.name}
          onChange={(e) => onFormChange('name', e.target.value)}
          placeholder={t('templateName')}
          className="h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
        />
        <select
          value={templateForm.model}
          onChange={(e) => onFormChange('model', e.target.value)}
          className="h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
        >
          <option value="haiku">Haiku</option>
          <option value="sonnet">Sonnet</option>
          <option value="opus">Opus</option>
        </select>
      </div>
      <input
        value={templateForm.description}
        onChange={(e) => onFormChange('description', e.target.value)}
        placeholder={t('templateDescription')}
        className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
      />
      <textarea
        value={templateForm.task_prompt}
        onChange={(e) => onFormChange('task_prompt', e.target.value)}
        placeholder={t('taskPromptPlaceholder')}
        rows={3}
        className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-sm text-foreground resize-none"
      />
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap flex-1">
          {templateForm.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded bg-primary/20 text-primary">
              {tag}
              <Button variant="ghost" size="xs" onClick={() => onRemoveTag(tag)} className="hover:text-primary/70 h-auto p-0 min-w-0">x</Button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => onTagInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); onAddTag() } }}
            onBlur={onAddTag}
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
            onChange={(e) => onFormChange('timeout_seconds', parseInt(e.target.value))}
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
          onClick={onSave}
          disabled={!templateForm.name || !templateForm.task_prompt}
          size="xs"
        >
          {formMode === 'edit' ? t('update') : t('save')}
        </Button>
      </div>
    </div>
  )
}
