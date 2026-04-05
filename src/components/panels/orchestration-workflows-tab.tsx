'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { TemplateForm } from './orchestration-template-form'
import { TemplateList } from './orchestration-template-list'
import type { WorkflowTemplate, TemplateFormData } from './orchestration-bar.types'
import { emptyForm } from './orchestration-bar.types'

interface WorkflowsTabProps {
  templates: WorkflowTemplate[]
  filteredTemplates: WorkflowTemplate[]
  allTags: string[]
  filterTag: string | null
  onSetFilterTag: (tag: string | null) => void
  formMode: 'hidden' | 'create' | 'edit'
  templateForm: TemplateFormData
  tagInput: string
  expandedId: number | null
  spawning: number | null
  onOpenCreate: () => void
  onCloseForm: () => void
  onFormChange: (field: keyof TemplateFormData, value: string | number | string[]) => void
  onTagInputChange: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
  onSaveTemplate: () => void
  onToggleExpand: (id: number) => void
  onExecuteTemplate: (template: WorkflowTemplate) => void
  onEditTemplate: (template: WorkflowTemplate) => void
  onDuplicateTemplate: (template: WorkflowTemplate) => void
  onDeleteTemplate: (id: number) => void
}

export function WorkflowsTab({
  templates,
  filteredTemplates,
  allTags,
  filterTag,
  onSetFilterTag,
  formMode,
  templateForm,
  tagInput,
  expandedId,
  spawning,
  onOpenCreate,
  onCloseForm,
  onFormChange,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  onSaveTemplate,
  onToggleExpand,
  onExecuteTemplate,
  onEditTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
}: WorkflowsTabProps): React.ReactElement {
  const t = useTranslations('orchestration')

  if (templates.length === 0 && formMode === 'hidden') {
    return (
      <div className="p-4 pt-3">
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-2">{t('noTemplates')}</p>
          <Button
            onClick={() => onOpenCreate()}
            variant="link"
            size="sm"
          >
            {t('createFirstTemplate')}
          </Button>
        </div>
      </div>
    )
  }

  const handleToggleForm = (): void => {
    if (formMode !== 'hidden') {
      onCloseForm()
    } else {
      onOpenCreate()
    }
  }

  return (
    <div className="p-4 pt-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filteredTemplates.length}{filterTag ? ` / ${templates.length}` : ''} templates
          </span>
          {allTags.length > 0 && (
            <TagFilterBar
              allTags={allTags}
              filterTag={filterTag}
              onSetFilterTag={onSetFilterTag}
            />
          )}
        </div>
        <Button onClick={handleToggleForm} variant="link" size="xs">
          {formMode !== 'hidden' ? t('cancel') : t('new')}
        </Button>
      </div>

      {formMode !== 'hidden' && (
        <TemplateForm
          formMode={formMode as 'create' | 'edit'}
          templateForm={templateForm}
          tagInput={tagInput}
          onFormChange={onFormChange}
          onTagInputChange={onTagInputChange}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onSave={onSaveTemplate}
        />
      )}

      <TemplateList
        filteredTemplates={filteredTemplates}
        expandedId={expandedId}
        spawning={spawning}
        onToggleExpand={onToggleExpand}
        onExecute={onExecuteTemplate}
        onEdit={onEditTemplate}
        onDuplicate={onDuplicateTemplate}
        onDelete={onDeleteTemplate}
      />
    </div>
  )
}

// Re-export emptyForm so callers can use it without importing from types
export { emptyForm }

interface TagFilterBarProps {
  allTags: string[]
  filterTag: string | null
  onSetFilterTag: (tag: string | null) => void
}

function TagFilterBar({ allTags, filterTag, onSetFilterTag }: TagFilterBarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-1">
      {filterTag && (
        <Button
          onClick={() => onSetFilterTag(null)}
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
          onClick={() => onSetFilterTag(tag)}
          variant="secondary"
          size="xs"
          className="text-2xs h-auto px-1.5 py-0.5"
        >
          {tag}
        </Button>
      ))}
    </div>
  )
}
